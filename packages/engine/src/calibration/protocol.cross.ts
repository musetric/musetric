import { createMessageChannel } from '@musetric/utils/cross/messageChannel';

export type RecordingLatencyCalibrationPeak = {
  clickFrame: number;
  peakFrame: number;
  peakValue: number;
};

export type RecordingLatencyCalibrationInboundMethods = {
  done: (message: { peaks: RecordingLatencyCalibrationPeak[] }) => void;
};

export type RecordingLatencyCalibrationOutboundMethods = {
  start: (message: { clickFrames: number[]; endFrame: number }) => void;
};

export const microphoneCalibrationChannel = createMessageChannel<
  RecordingLatencyCalibrationInboundMethods,
  RecordingLatencyCalibrationOutboundMethods
>({
  inbound: {
    keys: ['done'],
  },
  outbound: {
    keys: ['start'],
  },
});

export const microphoneCalibrationProcessorName =
  'microphone-calibration-processor';
