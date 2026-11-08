import * as ort from 'onnxruntime-web/webgpu';

const errorSeverityLevel = 3;

ort.env.logLevel = 'error';

export const createOrtSession = async (
  model: Uint8Array,
  options: ort.InferenceSession.SessionOptions,
): Promise<ort.InferenceSession> =>
  ort.InferenceSession.create(model, {
    ...options,
    logSeverityLevel: errorSeverityLevel,
  });
