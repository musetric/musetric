export type GpuPacer = {
  pace: <T>(operation: () => Promise<T>) => Promise<T>;
  release: () => Promise<void>;
};

export type GpuPacerOptions = {
  budgetMs?: number;
};

type QueueWork = {
  submit: boolean;
  execute: () => void;
};

export const createGpuPacer = (
  device: GPUDevice,
  options: GpuPacerOptions = {},
): GpuPacer => {
  const { budgetMs } = options;
  const { queue } = device;
  const submit = queue.submit.bind(queue);
  const writeBuffer = queue.writeBuffer.bind(queue);
  const onSubmittedWorkDone = queue.onSubmittedWorkDone.bind(queue);
  const createBuffer = device.createBuffer.bind(device);
  const bufferRestorers = new Map<GPUBuffer, () => void>();
  const fenceWaiters = new Set<(reason: Error) => void>();
  let failure: Error | undefined = undefined;
  let active = false;
  let released = false;
  let pending: QueueWork[] = [];
  let pumping: Promise<void> | undefined = undefined;

  const fail = (reason: unknown): void => {
    failure ??= reason instanceof Error ? reason : new Error(String(reason));
    pending = [];
    for (const reject of fenceWaiters) {
      reject(failure);
    }
    fenceWaiters.clear();
  };

  const onUncapturedError = (event: GPUUncapturedErrorEvent): void => {
    fail(new Error(`GPU error: ${event.error.message}`));
  };
  device.addEventListener('uncapturederror', onUncapturedError);

  void device.lost.then((info) => {
    if (!released) {
      fail(new Error(`GPU device lost: ${info.message}`));
    }
  });

  const assertHealthy = (): void => {
    if (failure) {
      throw failure;
    }
    if (released) {
      throw new Error('GPU pacer has been released');
    }
  };

  const complete = async (): Promise<void> => {
    assertHealthy();
    const completion = Promise.withResolvers<void>();
    fenceWaiters.add(completion.reject);
    try {
      void onSubmittedWorkDone().then(completion.resolve, completion.reject);
      await completion.promise;
    } finally {
      fenceWaiters.delete(completion.reject);
    }
  };

  let perSubmission = 4;
  let sinceWait = 0;
  let spendingFrom = 0;

  const flush = async (): Promise<void> => {
    while (pending.length > 0) {
      const work = pending.shift();
      if (!work) {
        continue;
      }
      if (work.submit && sinceWait === 0) {
        spendingFrom = performance.now();
      }
      work.execute();
      if (!work.submit) {
        continue;
      }
      sinceWait += 1;
      if (
        budgetMs !== undefined &&
        (sinceWait + 1) * perSubmission <= budgetMs
      ) {
        continue;
      }
      await complete();
      perSubmission =
        (perSubmission + (performance.now() - spendingFrom) / sinceWait) / 2;
      sinceWait = 0;
    }
  };

  const pump = (): void => {
    pumping ??= flush()
      .catch(fail)
      .finally(() => {
        pumping = undefined;
        if (pending.length > 0 && !failure) {
          pump();
        }
      });
  };

  const enqueue = (work: QueueWork): void => {
    assertHealthy();
    pending.push(work);
    pump();
  };

  const drain = async (): Promise<void> => {
    while (pumping) {
      await pumping;
    }
    assertHealthy();
  };

  queue.submit = (buffers) => {
    assertHealthy();
    if (!active) {
      submit(buffers);
      return;
    }
    const commands = Array.from(buffers);
    enqueue({ submit: true, execute: () => submit(commands) });
  };

  // eslint-disable-next-line max-params -- WebGPU defines five positional parameters.
  queue.writeBuffer = (buffer, offset, data, rawDataOffset, rawSize) => {
    assertHealthy();
    if (!active) {
      writeBuffer(buffer, offset, data, rawDataOffset, rawSize);
      return;
    }
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    const perElement: unknown =
      'BYTES_PER_ELEMENT' in data ? data.BYTES_PER_ELEMENT : undefined;
    const elementSize = typeof perElement === 'number' ? perElement : 1;
    const rawStart = (rawDataOffset ?? 0) * elementSize;
    const rawLength =
      rawSize === undefined
        ? bytes.byteLength - rawStart
        : rawSize * elementSize;
    if (
      rawStart < 0 ||
      rawLength < 0 ||
      rawStart + rawLength > bytes.byteLength
    ) {
      throw new RangeError('writeBuffer source range is invalid');
    }
    const copy = bytes.slice(rawStart, rawStart + rawLength);
    enqueue({
      submit: false,
      execute: () => writeBuffer(buffer, offset, copy),
    });
  };

  queue.onSubmittedWorkDone = async () => {
    await drain();
    await complete();
  };

  device.createBuffer = (descriptor) => {
    const buffer = createBuffer(descriptor);
    const mapAsync = buffer.mapAsync.bind(buffer);
    const destroy = buffer.destroy.bind(buffer);
    bufferRestorers.set(buffer, () => {
      buffer.mapAsync = mapAsync;
      buffer.destroy = destroy;
    });
    buffer.mapAsync = async (mode, offset, size) => {
      await drain();
      await mapAsync(mode, offset, size);
    };
    buffer.destroy = () => {
      const release = () => {
        bufferRestorers.delete(buffer);
        destroy();
      };
      if (active && !failure && !released) {
        enqueue({ submit: false, execute: release });
      } else {
        release();
      }
    };
    return buffer;
  };

  const pace = async <T>(operation: () => Promise<T>): Promise<T> => {
    assertHealthy();
    if (active) {
      throw new Error('Paced runs must not overlap');
    }
    active = true;
    try {
      const output = await operation();
      await drain();
      return output;
    } finally {
      try {
        await drain();
      } finally {
        active = false;
      }
    }
  };

  const release = async (): Promise<void> => {
    if (released) {
      return;
    }
    try {
      await drain();
    } finally {
      released = true;
      device.removeEventListener('uncapturederror', onUncapturedError);
      queue.submit = submit;
      queue.writeBuffer = writeBuffer;
      queue.onSubmittedWorkDone = onSubmittedWorkDone;
      device.createBuffer = createBuffer;
      for (const restore of bufferRestorers.values()) {
        restore();
      }
      bufferRestorers.clear();
    }
  };

  return { pace, release };
};
