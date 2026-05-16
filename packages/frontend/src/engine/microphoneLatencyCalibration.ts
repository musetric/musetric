import {
  createMicrophoneAudioConstraints,
  createRecordingLatencyCalibrationClick,
  createRecordingLatencyCalibrationSchedule,
  getRecordingLatencyCalibrationFrameCounts,
  getRecordingLatencyFrameCount,
  microphoneCalibrationProcessorName,
  type RecordingLatencyCalibrationPeak,
  recordingLatencyCalibrationTimeoutSeconds,
} from '@musetric/audio/recording';
import microphoneCalibrationWorkletUrl from './microphoneCalibration.worklet.ts?worker&url';

export type RunMicrophoneLatencyCalibrationOptions = {
  context: AudioContext;
  deviceId?: string;
  stream?: MediaStream;
};

export type MicrophoneLatencyCalibrationResult = {
  latencyFrameCount: number;
  measuredLatencyFrameCounts: number[];
};

type CalibrationResult = {
  peaks: RecordingLatencyCalibrationPeak[];
};

let calibrationWorkletPromise: Promise<void> | undefined = undefined;

const stopStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

const loadCalibrationWorklet = async (context: AudioContext) => {
  calibrationWorkletPromise ??= context.audioWorklet
    .addModule(microphoneCalibrationWorkletUrl)
    .catch((error: unknown) => {
      calibrationWorkletPromise = undefined;
      throw error;
    });

  return calibrationWorkletPromise;
};

const waitForCalibrationResult = async (node: AudioWorkletNode) =>
  new Promise<CalibrationResult | undefined>((resolve) => {
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

    node.port.onmessage = (
      event: MessageEvent<{
        type: string;
        peaks?: RecordingLatencyCalibrationPeak[];
      }>,
    ) => {
      if (
        event.data.type !== 'done' ||
        settled ||
        !Array.isArray(event.data.peaks)
      ) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      resolve({
        peaks: event.data.peaks,
      });
    };
  });

export const runMicrophoneLatencyCalibration = async (
  options: RunMicrophoneLatencyCalibrationOptions,
): Promise<MicrophoneLatencyCalibrationResult | undefined> => {
  const { context, deviceId } = options;
  let stream: MediaStream | undefined = undefined;
  let source: MediaStreamAudioSourceNode | undefined = undefined;
  let calibrationNode: AudioWorkletNode | undefined = undefined;
  let silentGain: GainNode | undefined = undefined;
  const clickSources: AudioBufferSourceNode[] = [];

  try {
    await loadCalibrationWorklet(context);
    stream =
      options.stream ??
      (await navigator.mediaDevices.getUserMedia({
        audio: createMicrophoneAudioConstraints({
          deviceId,
          sampleRate: context.sampleRate,
        }),
      }));
    const calibrationSchedule = createRecordingLatencyCalibrationSchedule({
      context,
    });

    source = context.createMediaStreamSource(stream);
    calibrationNode = new AudioWorkletNode(
      context,
      microphoneCalibrationProcessorName,
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      },
    );
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(calibrationNode);
    calibrationNode.connect(silentGain);
    silentGain.connect(context.destination);
    const calibrationResultPromise = waitForCalibrationResult(calibrationNode);

    calibrationNode.port.postMessage({
      type: 'start',
      clickFrames: calibrationSchedule.clickFrames,
      endFrame: calibrationSchedule.endFrame,
    });
    for (const clickFrame of calibrationSchedule.clickFrames) {
      const clickSource = context.createBufferSource();
      clickSource.buffer = createRecordingLatencyCalibrationClick(context);
      clickSource.connect(context.destination);
      clickSource.start(clickFrame / context.sampleRate);
      clickSources.push(clickSource);
    }

    const calibrationResult = await calibrationResultPromise;
    const measuredLatencyFrameCounts =
      calibrationResult === undefined
        ? []
        : getRecordingLatencyCalibrationFrameCounts(calibrationResult.peaks);
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
