import { expect, test } from 'vitest';
import { startJobExecutor } from '../browserExecutor.js';
import { registerBrowserApi } from '../browserShared.js';
import { serveUnits } from '../browserUnitServing.js';
import { readSocketUrl, startFakeHost } from './jobHarness.js';

const attempt = 'attempt-1';

const serving = {
  attemptId: attempt,
  attemptUrl: '',
  outputs: ['separated'],
  run: async (input: Uint8Array) => {
    const values = new Float32Array(input.slice().buffer);
    const output = Float32Array.from(values, (value) => value * 2);
    return Promise.resolve(new Uint8Array(output.buffer));
  },
};

const floatBytes = (values: number[]): Buffer =>
  Buffer.from(Float32Array.from(values).buffer);

const readFloats = (buffer: Buffer): number[] => [
  ...new Float32Array(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
  ),
];

test('the unit serving fetches every window, uploads the output and confirms the unit', async () => {
  const host = await startFakeHost();
  host.windows.set(`${attempt}/0`, floatBytes([0.5, -0.5, 0.25, 0.25]));
  host.windows.set(`${attempt}/1`, floatBytes([1, -1, 2, -2]));
  serving.attemptUrl = `${host.pageUrl.split('/?')[0]}/attempt/${attempt}`;
  registerBrowserApi('musetricAiServeUnitsTest', async () => {
    await serveUnits(serving);
  });

  try {
    startJobExecutor(readSocketUrl(host.pageUrl));
    await host.ready;
    const answered = host.run('musetricAiServeUnitsTest', {});
    host.sendUnit(attempt, 0, 2);
    host.sendUnit(attempt, 1, 2);
    host.sendUnitClose(attempt);

    await answered;

    expect(
      readFloats(host.outputs.get(`${attempt}/0/separated`) ?? Buffer.alloc(0)),
    ).toEqual([1, -1, 0.5, 0.5]);
    expect(
      readFloats(host.outputs.get(`${attempt}/1/separated`) ?? Buffer.alloc(0)),
    ).toEqual([2, -2, 4, -4]);
    expect(host.unitDone).toEqual([
      { attemptId: attempt, unit: 0 },
      { attemptId: attempt, unit: 1 },
    ]);
  } finally {
    await host.close();
  }
});
