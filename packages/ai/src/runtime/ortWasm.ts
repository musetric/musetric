import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import * as ort from 'onnxruntime-web/webgpu';

export const serveOrtWasmFromBundle = (): void => {
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
};
