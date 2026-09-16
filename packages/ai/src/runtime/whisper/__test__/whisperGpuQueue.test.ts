import { describe, expect, it, vi } from 'vitest';
import { createWhisperGpuQueue } from '../whisperGpuQueue.js';

const fixture = () => {
  const calls: string[] = [];
  const fences: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const lost =
    Promise.withResolvers<Pick<GPUDeviceLostInfo, 'reason' | 'message'>>();
  const writes: number[][] = [];
  const buffer = {
    mapAsync: vi.fn(async () => {
      calls.push('map');
      return Promise.resolve();
    }),
    destroy: vi.fn(() => {
      calls.push('destroy');
    }),
  };
  const nativeSubmit = vi.fn(() => {
    calls.push('submit');
  });
  const device = {
    addEventListener:
      vi.fn<
        (type: string, listener: (event: { error: Error }) => void) => void
      >(),
    removeEventListener: vi.fn(),
    queue: {
      submit: nativeSubmit,
      writeBuffer: vi.fn((_buffer, _offset, data: Uint8Array) => {
        calls.push('write');
        writes.push(Array.from(data));
      }),
      onSubmittedWorkDone: vi.fn(async () => {
        const fence = Promise.withResolvers<void>();
        fences.push(fence);
        return fence.promise;
      }),
    },
    createBuffer: vi.fn(() => buffer),
    lost: lost.promise,
  };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const gpu = device as unknown as GPUDevice;
  const gate = createWhisperGpuQueue(gpu);
  return {
    gpu,
    gate,
    calls,
    fences,
    lost,
    writes,
    nativeSubmit,
    addEventListener: device.addEventListener,
  };
};

const tick = async () => {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
};

describe('Whisper encoder GPU queue', () => {
  it('leaves decoder submissions immediate and does not wait after each token', async () => {
    const state = fixture();
    state.gpu.queue.submit([]);
    state.gpu.queue.submit([]);
    expect(state.calls).toEqual(['submit', 'submit']);
    expect(state.fences).toHaveLength(0);
    await state.gate.release();
  });

  it('preserves submit/write/destroy order and copies typed write ranges at call time', async () => {
    const state = fixture();
    const buffer = state.gpu.createBuffer({ size: 8, usage: 8 });
    const input = new Uint16Array([11, 22, 33, 44]);
    const run = state.gate.runEncoder(async () => {
      state.gpu.queue.submit([]);
      state.gpu.queue.writeBuffer(buffer, 0, input, 1, 2);
      input.fill(99);
      state.gpu.queue.submit([]);
      buffer.destroy();
      return Promise.resolve('encoded');
    });
    expect(state.calls).toEqual(['submit']);
    state.fences[0].resolve();
    await tick();
    expect(state.calls).toEqual(['submit', 'write', 'submit']);
    expect(state.writes).toEqual([[22, 0, 33, 0]]);
    state.fences[1].resolve();
    expect(await run).toBe('encoded');
    expect(state.calls).toEqual(['submit', 'write', 'submit', 'destroy']);
    state.gpu.queue.submit([]);
    expect(state.fences).toHaveLength(2);
    await state.gate.release();
  });

  it('drains all deferred work before a readback can map', async () => {
    const state = fixture();
    const buffer = state.gpu.createBuffer({ size: 8, usage: 8 });
    const run = state.gate.runEncoder(async () => {
      state.gpu.queue.submit([]);
      state.gpu.queue.submit([]);
      await buffer.mapAsync(1);
    });
    state.fences[0].resolve();
    await tick();
    expect(state.calls).toEqual(['submit', 'submit']);
    state.fences[1].resolve();
    await run;
    expect(state.calls).toEqual(['submit', 'submit', 'map']);
    await state.gate.release();
  });

  it('rejects a failed fence and releases waiters instead of hanging the phase', async () => {
    const state = fixture();
    const run = state.gate.runEncoder(async () => {
      state.gpu.queue.submit([]);
      state.gpu.queue.submit([]);
      return Promise.resolve();
    });
    const result = expect(run).rejects.toThrow('fence failed');
    state.fences[0].reject(new Error('fence failed'));
    await result;
    expect(state.nativeSubmit).toHaveBeenCalledTimes(1);
    await expect(state.gate.release()).rejects.toThrow('fence failed');
    await state.gate.release();
  });

  it('settles even when device loss leaves a fence pending forever', async () => {
    const state = fixture();
    const run = state.gate.runEncoder(async () => {
      state.gpu.queue.submit([]);
      state.gpu.queue.submit([]);
      return Promise.resolve();
    });
    const result = expect(run).rejects.toThrow('device lost');
    state.lost.resolve({ reason: 'unknown', message: 'driver reset' });
    await result;
    expect(state.nativeSubmit).toHaveBeenCalledTimes(1);
    await expect(state.gate.release()).rejects.toThrow('driver reset');
  });

  it('drains an aborted encoder and restores immediate submission for the next phase', async () => {
    const state = fixture();
    const run = state.gate.runEncoder(async () => {
      state.gpu.queue.submit([]);
      return Promise.reject(new Error('cancelled'));
    });
    const result = expect(run).rejects.toThrow('cancelled');
    await expect(
      state.gate.runEncoder(async () => Promise.resolve()),
    ).rejects.toThrow('overlap');
    state.fences[0].resolve();
    await result;
    state.gpu.queue.submit([]);
    expect(state.fences).toHaveLength(1);
    await state.gate.release();
  });

  it('rejects a deferred GPU validation error before waiting for the next phase', async () => {
    const state = fixture();
    const run = state.gate.runEncoder(async () => {
      state.gpu.queue.submit([]);
      state.gpu.queue.submit([]);
      return Promise.resolve();
    });
    const result = expect(run).rejects.toThrow('invalid GPU command');
    state.addEventListener.mock.calls[0][1]({
      error: new Error('invalid GPU command'),
    });
    await result;
    expect(state.nativeSubmit).toHaveBeenCalledTimes(1);
    await expect(state.gate.release()).rejects.toThrow('invalid GPU command');
  });
});
