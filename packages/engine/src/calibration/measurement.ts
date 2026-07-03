import {
  createRecordingLatencyCalibrationClick,
  createRecordingLatencyCalibrationSchedule,
  getRecordingLatencyCalibrationFrameCounts,
  getRecordingLatencyFrameCount,
  recordingLatencyCalibrationTimeoutSeconds,
} from '@musetric/audio/calibration';
import { createMicrophoneAudioConstraints } from '@musetric/audio/recording';
import { microphoneCalibrationChannel } from './protocol.cross.js';

const workletPromises = new Map<string, Promise<void>>();

const stopStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

const loadWorklet = async (
  context: AudioContext,
  workletUrl: string | URL,
): Promise<void> => {
  const key = workletUrl.toString();
  let promise = workletPromises.get(key);
  if (!promise) {
    promise = context.audioWorklet
      .addModule(workletUrl)
      .catch((error: unknown) => {
        workletPromises.delete(key);
        throw error;
      });
    workletPromises.set(key, promise);
  }
  return promise;
};

type WorkletResult = {
  peaks: { clickFrame: number; peakFrame: number; peakValue: number }[];
};

const waitForResult = async (
  port: ReturnType<typeof microphoneCalibrationChannel.outbound<MessagePort>>,
): Promise<WorkletResult | undefined> =>
  new Promise<WorkletResult | undefined>((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(
      () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(undefined);
      },
      Math.round(recordingLatencyCalibrationTimeoutSeconds * 1000),
    );

    port.bindHandlers({
      done: (message) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve({ peaks: message.peaks });
      },
    });
  });

export type CalibrationMeasurementOptions = {
  context: AudioContext;
  outputNode: AudioNode;
  playOutput: () => Promise<void>;
  workletUrl: string | URL;
  processorName: string;
  deviceId?: string;
  stream?: MediaStream;
};

export type CalibrationMeasurementResult = {
  latencyFrameCount: number;
  measuredLatencyFrameCounts: number[];
};

export const measureRecordingLatency = async (
  options: CalibrationMeasurementOptions,
): Promise<CalibrationMeasurementResult | undefined> => {
  const {
    context,
    outputNode,
    playOutput,
    workletUrl,
    processorName,
    deviceId,
  } = options;
  let stream: MediaStream | undefined = undefined;
  let source: MediaStreamAudioSourceNode | undefined = undefined;
  let calibrationNode: AudioWorkletNode | undefined = undefined;
  let silentGain: GainNode | undefined = undefined;
  const clickSources: AudioBufferSourceNode[] = [];

  try {
    await playOutput();
    await loadWorklet(context, workletUrl);
    stream =
      options.stream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: createMicrophoneAudioConstraints({
          deviceId,
          sampleRate: context.sampleRate,
        }),
      }));

    const schedule = createRecordingLatencyCalibrationSchedule({ context });
    source = context.createMediaStreamSource(stream);
    calibrationNode = new AudioWorkletNode(context, processorName, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(calibrationNode);
    calibrationNode.connect(silentGain);
    silentGain.connect(outputNode);

    const port = microphoneCalibrationChannel.outbound(calibrationNode.port);
    const resultPromise = waitForResult(port);
    port.methods.start({
      clickFrames: schedule.clickFrames,
      endFrame: schedule.endFrame,
    });
    for (const clickFrame of schedule.clickFrames) {
      const clickSource = context.createBufferSource();
      clickSource.buffer = createRecordingLatencyCalibrationClick(context);
      clickSource.connect(outputNode);
      clickSource.start(clickFrame / context.sampleRate);
      clickSources.push(clickSource);
    }

    const workletResult = await resultPromise;
    const measuredLatencyFrameCounts =
      workletResult === undefined
        ? []
        : getRecordingLatencyCalibrationFrameCounts(workletResult.peaks);

    if (measuredLatencyFrameCounts.length < 3) {
      return undefined;
    }

    return {
      latencyFrameCount: getRecordingLatencyFrameCount({
        measuredLatencyFrameCounts,
        sampleRate: context.sampleRate,
      }),
      measuredLatencyFrameCounts,
    };
  } finally {
    for (const clickSource of clickSources) {
      clickSource.disconnect();
    }
    source?.disconnect();
    calibrationNode?.disconnect();
    calibrationNode?.port.close();
    silentGain?.disconnect();
    if (stream && !options.stream) {
      stopStream(stream);
    }
  }
};
