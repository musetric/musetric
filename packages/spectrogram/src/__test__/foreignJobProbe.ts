import { type ForeignProbeReport } from './pitchPerf.es.js';

const probeIntervalMs = 100;
const probeShader = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;
@compute @workgroup_size(1) fn main() {
  data[0] = data[0] + 1.0;
}
`;

const report = (message: ForeignProbeReport): void => {
  postMessage(message);
};

type OnWait = (submittedAt: number, ms: number) => void;

const createProbe = async (): Promise<(onWait: OnWait) => Promise<void>> => {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('no GPU adapter for the foreign job');
  }
  const device = await adapter.requestDevice();
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ code: probeShader }),
      entryPoint: 'main',
    },
  });
  const buffer = device.createBuffer({
    size: Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.STORAGE,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer } }],
  });
  return async (onWait) => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    const started = performance.now();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    onWait(performance.timeOrigin + started, performance.now() - started);
  };
};

const reportWait: OnWait = (submittedAt, ms) => {
  report({ kind: 'wait', submittedAt, ms });
};

const reportFailure = (error: unknown): void => {
  report({ kind: 'failed', message: String(error) });
};

const start = async (): Promise<void> => {
  const probe = await createProbe();
  await probe(() => undefined);
  report({ kind: 'started' });
  setInterval(() => {
    probe(reportWait).catch(reportFailure);
  }, probeIntervalMs);
};

start().catch(reportFailure);
