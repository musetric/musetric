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

export type RecordingLatencyCalibrationLevel = {
  clickIndex: number;
  level: number;
  quiet: number;
};

export type RecordingLatencyCalibrationClickPeak = {
  clickIndex: number;
  peak: RecordingLatencyCalibrationPeak;
};

export type RecordingLatencyCalibrationInboundMethods = {
  level: (message: RecordingLatencyCalibrationLevel) => void;
  heard: (message: RecordingLatencyCalibrationClickPeak) => void;
  closed: (message: RecordingLatencyCalibrationClickPeak) => void;
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
    keys: ['level', 'heard', 'closed', 'done'],
  },
  outbound: {
    keys: ['start'],
  },
});

export const microphoneCalibrationProcessorName =
  'microphone-calibration-processor';
