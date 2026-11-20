import captureWasmUrl from '@musetric/dsp/capture.wasm?url';

export const compileCapture = async (): Promise<WebAssembly.Module> =>
  fetch(captureWasmUrl)
    .then(async (response) => response.arrayBuffer())
    .then(WebAssembly.compile);
