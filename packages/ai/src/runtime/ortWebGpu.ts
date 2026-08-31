import * as ort from 'onnxruntime-web/webgpu';

const getOrigin = (): string => {
  const location: unknown = Reflect.get(globalThis, 'location');
  if (typeof location !== 'object' || !location) {
    return '';
  }
  const origin: unknown = Reflect.get(location, 'origin');
  return typeof origin === 'string' ? origin : '';
};

export const configureOrtWebGpu = (): void => {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = `${getOrigin()}/onnxruntime/`;
};
