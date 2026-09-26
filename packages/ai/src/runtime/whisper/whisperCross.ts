import * as ort from 'onnxruntime-web/webgpu';

const encoderStates = 'encoder_hidden_states';

const elementBytes = { float16: 2, float32: 4 } as const;

type StackedType = keyof typeof elementBytes;

const isStackedType = (type: string): type is StackedType =>
  type in elementBytes;

type WindowStack = {
  buffer: GPUBuffer;
  windowBytes: number;
  tensor: ort.Tensor;
};

const createStack = (
  device: GPUDevice,
  window: ort.Tensor,
  windows: number,
): WindowStack => {
  const { type } = window;
  if (!isStackedType(type)) {
    throw new Error(`whisper cross: cannot stack ${type} outputs`);
  }
  const [, ...rest] = window.dims;
  const windowBytes = rest.reduce(
    (product, size) => product * size,
    elementBytes[type],
  );
  const buffer = device.createBuffer({
    size: windows * windowBytes,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST,
  });
  const tensor = ort.Tensor.fromGpuBuffer(buffer, {
    dataType: type,
    dims: [windows, ...rest],
    dispose: () => {
      buffer.destroy();
    },
  });
  return { buffer, windowBytes, tensor };
};

type CrossOutputs = Record<string, ort.Tensor>;

export type CrossProjection = {
  cross: ort.InferenceSession;
  device: GPUDevice;
};

export const projectCrossByWindow = async (
  projection: CrossProjection,
  states: ort.Tensor,
): Promise<CrossOutputs> => {
  const { cross, device } = projection;
  const [windows, positions, width] = states.dims;
  if (windows === 1) {
    return cross.run({ [encoderStates]: states });
  }
  if (!(states.data instanceof Float32Array)) {
    throw new Error('whisper cross: encoder states are not float32');
  }
  const windowSize = positions * width;
  const stacks = new Map<string, WindowStack>();
  for (let window = 0; window < windows; window++) {
    const outputs = await cross.run({
      [encoderStates]: new ort.Tensor(
        'float32',
        states.data.subarray(window * windowSize, (window + 1) * windowSize),
        [1, positions, width],
      ),
    });
    const encoder = device.createCommandEncoder();
    for (const [name, tensor] of Object.entries(outputs)) {
      const stack = stacks.get(name) ?? createStack(device, tensor, windows);
      stacks.set(name, stack);
      encoder.copyBufferToBuffer(
        tensor.gpuBuffer,
        0,
        stack.buffer,
        window * stack.windowBytes,
        stack.windowBytes,
      );
    }
    device.queue.submit([encoder.finish()]);
    for (const tensor of Object.values(outputs)) {
      tensor.dispose();
    }
  }
  return Object.fromEntries(
    [...stacks].map((entry) => [entry[0], entry[1].tensor]),
  );
};
