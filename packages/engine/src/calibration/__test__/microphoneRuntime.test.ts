import { describe, expect, it } from 'vitest';
import { createMicrophoneCalibrationRuntime } from '../microphoneRuntime.worklet.js';
import {
  microphoneCalibrationChannel,
  type RecordingLatencyCalibrationPeak,
} from '../protocol.cross.js';

const rate = 48000;
const blockSize = 128;
const clickFrames = [0.25, 1.25, 2.25].map((seconds) => seconds * rate);
const endFrame = clickFrames[clickFrames.length - 1] + 1.1 * rate;
const frequency = 1800;
const swellFrames = 0.004 * rate;
const decayFrames = 0.06 * rate;

const settle = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

const heardClick = (frame: number) => {
  const swell = 0.6 + 0.4 * Math.min(1, frame / swellFrames);
  const decay = Math.exp(-Math.max(0, frame - swellFrames) / decayFrames);
  return Math.sin((2 * Math.PI * frequency * frame) / rate) * swell * decay;
};

const measure = async (latencyFrameCount: number) => {
  const channel = new MessageChannel();
  let peaks: RecordingLatencyCalibrationPeak[] = [];
  const clickCounts: number[] = [];
  microphoneCalibrationChannel.outbound(channel.port2).bindHandlers({
    progress: (message) => {
      clickCounts.push(message.clickCount);
    },
    done: (message) => {
      peaks = message.peaks;
    },
  });
  const runtime = createMicrophoneCalibrationRuntime({
    port: microphoneCalibrationChannel.inbound(channel.port1),
  });
  runtime.handleStart({ clickFrames, endFrame });
  const signal = new Float32Array(endFrame + blockSize);
  for (const clickFrame of clickFrames) {
    for (let frame = 0; frame < 0.08 * rate; frame += 1) {
      signal[clickFrame + latencyFrameCount + frame] = heardClick(frame);
    }
  }
  for (let frame = 0; frame < endFrame + blockSize; frame += blockSize) {
    runtime.process(
      [[signal.subarray(frame, frame + blockSize)]],
      [[new Float32Array(blockSize)]],
      frame,
    );
  }
  await settle();
  channel.port1.close();
  channel.port2.close();
  return { peaks, clickCounts };
};

describe('microphone calibration runtime', () => {
  it('times each click by its start rather than its loudest sample', async () => {
    const latencyFrameCount = Math.round(0.3 * rate);
    const { peaks } = await measure(latencyFrameCount);
    expect(peaks).toHaveLength(clickFrames.length);
    for (const peak of peaks) {
      const delay = peak.onsetFrame - peak.clickFrame - latencyFrameCount;
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(0.0005 * rate);
    }
  });

  it('reports each click once its window has been heard', async () => {
    const { clickCounts } = await measure(Math.round(0.3 * rate));
    expect(clickCounts).toEqual([1, 2, 3]);
  });
});
