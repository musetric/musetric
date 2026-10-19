import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type RecordingLatencyCalibrationPeak = {
  clickFrame: number;
  onsetFrame: number;
  peakValue: number;
  noiseValue: number;
};

export type RecordingLatencyCalibrationStart = {
  clickFrames: number[];
  endFrame: number;
  clickFrequency: number;
  sampleRate: number;
};

export type RecordingLatencyCalibrationInboundMethods = {
  progress: (message: { clickCount: number }) => void;
  done: (message: { peaks: RecordingLatencyCalibrationPeak[] }) => void;
};

export type RecordingLatencyCalibrationOutboundMethods = {
  start: (message: RecordingLatencyCalibrationStart) => void;
};

export const microphoneCalibrationChannel = createMessageChannel<
  RecordingLatencyCalibrationInboundMethods,
  RecordingLatencyCalibrationOutboundMethods
>({
  inbound: {
    keys: ['progress', 'done'],
  },
  outbound: {
    keys: ['start'],
  },
});

export const microphoneCalibrationProcessorName =
  'microphone-calibration-processor';
