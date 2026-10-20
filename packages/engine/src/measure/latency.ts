import {
  classifyAudioOutputDevice,
  resolveAudioInputDevice,
  resolveAudioOutputDevice,
} from '@musetric/audio/recording';
import { type Engine } from '../engine.js';
import {
  getOutputLatencyFrameCount,
  getRecordingLatencyFrameCount,
} from '../state.js';
import { wait } from './samples.js';

const previewSettleMs = 3000;
const calibrationSettleMs = 1500;

export type MeasureLatency = {
  sampleRate: number;
  latencySource: string;
  latencyDevicePairKey?: string;
  reportedOutputFrameCount: number;
  outputFrameCount: number;
  recordingFrameCount: number;
  timedRoundTripFrameCount?: number;
  inputLabel?: string;
  outputLabel?: string;
  outputKind: string;
};

export const readMeasureLatency = (engine: Engine): MeasureLatency => {
  const state = engine.store.get();
  const input = resolveAudioInputDevice(state.audioDevices, {
    explicitDeviceId: state.microphoneDeviceId,
  });
  const output = resolveAudioOutputDevice(state.audioDevices, {
    explicitDeviceId: state.audioOutputDeviceId,
  });
  return {
    sampleRate: engine.context.sampleRate,
    latencySource: state.latencySource,
    latencyDevicePairKey: state.latencyDevicePairKey,
    reportedOutputFrameCount: state.outputLatencyFrameCount,
    outputFrameCount: getOutputLatencyFrameCount(state),
    recordingFrameCount: getRecordingLatencyFrameCount(state),
    timedRoundTripFrameCount: state.timedRoundTripFrameCount,
    inputLabel: input?.label,
    outputLabel: output?.label,
    outputKind: output ? classifyAudioOutputDevice(output) : 'unknown',
  };
};

export type MeasureCalibration = {
  calibrated: boolean;
  error?: string;
  latency: MeasureLatency;
};

export const calibrate = async (
  engine: Engine,
): Promise<MeasureCalibration> => {
  if (engine.store.get().playing) {
    await engine.player.stop();
  }
  const closePreview = engine.calibration.openPreview();
  try {
    await wait(previewSettleMs);
    const calibrated = await engine.calibration.calibrate();
    await wait(calibrationSettleMs);
    return {
      calibrated,
      error: engine.store.get().calibrationError,
      latency: readMeasureLatency(engine),
    };
  } finally {
    closePreview();
  }
};
