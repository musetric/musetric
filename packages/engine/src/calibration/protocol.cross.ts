export type RecordingLatencyCalibrationPeak = {
  clickFrame: number;
  peakFrame: number;
  peakValue: number;
};

export type RecordingLatencyCalibrationStartMessage = {
  type: 'start';
  clickFrames: number[];
  endFrame: number;
};

export type RecordingLatencyCalibrationDoneMessage = {
  type: 'done';
  peaks: RecordingLatencyCalibrationPeak[];
};

export const microphoneCalibrationProcessorName =
  'microphone-calibration-processor';
