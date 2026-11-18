import {
  createRecordingLatencyCalibrationClick,
  createRecordingLatencyCalibrationSchedule,
  getRecordingLatencyCalibrationClickVerdicts,
  getRecordingLatencyCalibrationOutcome,
  getRecordingLatencyFrameCount,
  recordingLatencyCalibrationClickFrequencyHz,
  type RecordingLatencyCalibrationClickVerdict,
  recordingLatencyCalibrationTimeoutSeconds,
} from '@musetric/audio/calibration';
import {
  type EngineAudioSession,
  type EngineMicrophone,
} from '../audioSession/engineAudioSession.js';
import {
  microphoneCalibrationChannel,
  type RecordingLatencyCalibrationClickPeak,
  type RecordingLatencyCalibrationLevel,
  type RecordingLatencyCalibrationPeak,
} from './protocol.cross.js';

const searchLeadSeconds = 0.05;

const workletPromises = new Map<string, Promise<void>>();

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
  peaks: RecordingLatencyCalibrationPeak[];
};

export type CalibrationMeasurementListeners = {
  onLevel?: (message: RecordingLatencyCalibrationLevel) => void;
  onHeard?: (message: RecordingLatencyCalibrationClickPeak) => void;
  onClosed?: (message: RecordingLatencyCalibrationClickPeak) => void;
};

const waitForResult = async (
  port: ReturnType<typeof microphoneCalibrationChannel.outbound<MessagePort>>,
  listeners: CalibrationMeasurementListeners,
  timeoutSeconds: number,
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
      Math.round(timeoutSeconds * 1000),
    );

    port.bindHandlers({
      level: (message) => {
        if (!settled) {
          listeners.onLevel?.(message);
        }
      },
      heard: (message) => {
        if (!settled) {
          listeners.onHeard?.(message);
        }
      },
      closed: (message) => {
        if (!settled) {
          listeners.onClosed?.(message);
        }
      },
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

export type CalibrationMeasurementOptions = CalibrationMeasurementListeners & {
  context: AudioContext;
  audioSession: EngineAudioSession;
  outputNode: AudioNode;
  playOutput: () => Promise<void>;
  workletUrl: string | URL;
  processorName: string;
  deviceId?: string;
  microphone?: EngineMicrophone;
};

export type CalibrationMeasurementResult = (
  | {
      kind: 'measured';
      latencyFrameCount: number;
      measuredLatencyFrameCounts: number[];
    }
  | { kind: 'noisy' }
  | { kind: 'quiet' }
  | { kind: 'unsteady' }
  | { kind: 'silent' }
) & { verdicts: RecordingLatencyCalibrationClickVerdict[] };

export const measureRecordingLatency = async (
  options: CalibrationMeasurementOptions,
): Promise<CalibrationMeasurementResult> => {
  const {
    context,
    audioSession,
    outputNode,
    playOutput,
    workletUrl,
    processorName,
    deviceId,
  } = options;
  let microphone: EngineMicrophone | undefined = undefined;
  let source: AudioNode | undefined = undefined;
  let calibrationNode: AudioWorkletNode | undefined = undefined;
  let silentGain: GainNode | undefined = undefined;
  const clickSources: AudioBufferSourceNode[] = [];

  try {
    await playOutput();
    await loadWorklet(context, workletUrl);
    microphone =
      options.microphone ?? (await audioSession.openMicrophone({ deviceId }));

    const schedule = createRecordingLatencyCalibrationSchedule({ context });
    const searchOffsetSeconds =
      microphone.exactRoundTripLatency === undefined
        ? 0
        : Math.max(0, microphone.exactRoundTripLatency - searchLeadSeconds);
    const searchOffsetFrameCount = Math.round(
      searchOffsetSeconds * context.sampleRate,
    );
    source = microphone.createSource();
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
    const resultPromise = waitForResult(
      port,
      options,
      recordingLatencyCalibrationTimeoutSeconds + searchOffsetSeconds,
    );
    port.methods.start({
      clickFrames: schedule.clickFrames.map(
        (clickFrame) => clickFrame + searchOffsetFrameCount,
      ),
      endFrame: schedule.endFrame + searchOffsetFrameCount,
      clickFrequency: recordingLatencyCalibrationClickFrequencyHz,
      sampleRate: context.sampleRate,
    });
    for (const clickFrame of schedule.clickFrames) {
      const clickSource = context.createBufferSource();
      clickSource.buffer = createRecordingLatencyCalibrationClick(context);
      clickSource.connect(outputNode);
      clickSource.start(clickFrame / context.sampleRate);
      clickSources.push(clickSource);
    }

    const workletResult = await resultPromise;
    const peaks = (workletResult?.peaks ?? []).map((peak) => ({
      ...peak,
      clickFrame: peak.clickFrame - searchOffsetFrameCount,
    }));
    const outcome = getRecordingLatencyCalibrationOutcome(
      peaks,
      context.sampleRate,
    );
    const verdicts = getRecordingLatencyCalibrationClickVerdicts(
      peaks,
      context.sampleRate,
    );
    if (outcome.kind !== 'measured') {
      return { ...outcome, verdicts };
    }

    return {
      kind: 'measured',
      verdicts,
      latencyFrameCount: getRecordingLatencyFrameCount({
        measuredLatencyFrameCounts: outcome.measuredLatencyFrameCounts,
        sampleRate: context.sampleRate,
      }),
      measuredLatencyFrameCounts: outcome.measuredLatencyFrameCounts,
    };
  } finally {
    for (const clickSource of clickSources) {
      clickSource.disconnect();
    }
    source?.disconnect();
    calibrationNode?.disconnect();
    calibrationNode?.port.close();
    silentGain?.disconnect();
    if (microphone && !options.microphone) {
      audioSession.closeMicrophone(microphone);
    }
  }
};
