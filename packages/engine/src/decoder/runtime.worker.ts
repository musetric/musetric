import { assertNever } from '@musetric/utils';
import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { type Playhead } from '../player/playhead.cross.js';
import { type playerDataChannel } from '../player/protocol.cross.js';
import { recordingStreamChannel } from '../player/recordingStream.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { type AudioDecode, createAudioDecode } from './audioDecode.worker.js';
import { createPlayerFrameIndexStream } from './playerFrameIndexStream.worker.js';
import { type engineDecoderChannel } from './protocol.cross.js';
import {
  createProjectRealtime,
  type ProjectRealtime,
} from './realtime.worker.js';
import {
  createRecordingPacket,
  createRecordingStream,
  recordingPacketHeaderByteLength,
  type RecordingStream,
} from './recordingStream.worker.js';

export type CreateDecoderWorkerRuntimeOptions = {
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
  playerPort: ReturnType<typeof playerDataChannel.outbound<MessagePort>>;
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
  playhead: Playhead;
};

type RecordingController = {
  clearRecordingStream: () => void;
  failRecordingStream: (error: unknown) => void;
  finishCurrentRecordingStream: (stream: RecordingStream) => Promise<void>;
};

type RecordingControllerDeps = {
  getRecordingStream: () => RecordingStream | undefined;
  setRecordingStream: (stream: RecordingStream | undefined) => void;
  getRecordingReady: () => boolean;
  setRecordingReady: (ready: boolean) => void;
  realtime: ProjectRealtime;
  port: CreateDecoderWorkerRuntimeOptions['port'];
};

const sanitizeLogMessage = (message: string) =>
  message
    .split('\r')
    .join(' ')
    .split('\n')
    .join(' ')
    .split('\u2028')
    .join(' ')
    .split('\u2029')
    .join(' ');

const getErrorMessage = (error: unknown): string =>
  sanitizeLogMessage(error instanceof Error ? error.message : String(error));

const waitWithTimeout = async (
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> =>
  await Promise.race([
    promise.then(() => true),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }).then(() => false),
  ]);

const handleRealtimePacket = (audioDecode: AudioDecode, data: ArrayBuffer) => {
  if (data.byteLength < recordingPacketHeaderByteLength) {
    throw new Error('Project realtime packet is missing a header');
  }
  const view = new DataView(data);
  const frameIndex = view.getUint32(0, true);
  const frameCount = view.getUint32(4, true);
  const byteLength = frameCount * Float32Array.BYTES_PER_ELEMENT;
  if (data.byteLength !== recordingPacketHeaderByteLength + byteLength) {
    throw new Error('Project realtime packet has invalid byte length');
  }
  audioDecode.patchRecordingSamples({
    frameIndex,
    samples: new Float32Array(
      data,
      recordingPacketHeaderByteLength,
      frameCount,
    ),
  });
};

const createRecordingController = (
  deps: RecordingControllerDeps,
): RecordingController => {
  const finishCurrentRecordingStream = async (
    stream: RecordingStream,
  ): Promise<void> => {
    await waitWithTimeout(deps.realtime.ready(), 1000);
    const started = await waitWithTimeout(stream.start, 3000);
    if (!started) {
      throw new Error('Recording stream was not accepted by the backend');
    }
    deps.realtime.flush();
    deps.realtime.sendJson({ type: 'recording.finish' });
    await waitWithTimeout(stream.finish, 5000);
  };

  const clearRecordingStream = (): void => {
    deps.getRecordingStream()?.close();
    deps.setRecordingStream(undefined);
    deps.setRecordingReady(false);
  };

  const failRecordingStream = (error: unknown): void => {
    const errorMessage = getErrorMessage(error);
    console.error('Recording stream failed', errorMessage);
    const stream = deps.getRecordingStream();
    if (stream) {
      void finishCurrentRecordingStream(stream).catch((finishError) => {
        console.error(
          'Failed to finish interrupted recording stream',
          finishError,
        );
      });
    }
    clearRecordingStream();
    deps.port.methods.recordingStreamFailed({ error: errorMessage });
  };

  return {
    clearRecordingStream,
    failRecordingStream,
    finishCurrentRecordingStream,
  };
};

export const createDecoderWorkerRuntime = (
  options: CreateDecoderWorkerRuntimeOptions,
): void => {
  const { port, playerPort, spectrogramPort, playhead } = options;

  const audioDecode = createAudioDecode({ playerPort, spectrogramPort });

  let recordingStream: RecordingStream | undefined = undefined;
  let recordingReady = false;
  let backendRevision = 0;

  let recordingController: RecordingController | undefined = undefined;

  const realtime = createProjectRealtime({
    isRecordingReady: () => recordingReady,
    onOpen: () => {
      port.methods.setRealtimeState({ status: 'success' });
    },
    onEvent: (event) => {
      if (event.type === 'recording.peaksChanged') {
        port.methods.recordingPeaksChanged({
          startPeakIndex: event.startPeakIndex,
          peaks: new Float32Array(event.peaks),
        });
        return;
      }
      if (event.type === 'recording.finished') {
        recordingStream?.notifyFinished();
        recordingReady = false;
        return;
      }
      if (event.type === 'recording.started') {
        recordingReady = true;
        recordingStream?.notifyStarted();
        realtime.flush();
        return;
      }
      if (event.type === 'player.play') {
        port.methods.playerPlayRequested();
        return;
      }
      if (event.type === 'player.record') {
        port.methods.playerRecordRequested();
        return;
      }
      if (event.type === 'player.stop') {
        port.methods.playerStopRequested();
        return;
      }
      if (event.type === 'player.frameIndex') {
        backendRevision = event.revision;
        port.methods.playerFrameIndexChanged({
          frameIndex: event.frameIndex,
          frozen: event.frozen,
          revision: event.revision,
          source: event.source,
        });
        return;
      }
      if (event.type === 'player.revision') {
        backendRevision = event.revision;
        port.methods.playerRevisionChanged({ revision: event.revision });
        return;
      }
      if (event.type === 'player.sync.state') {
        backendRevision = event.revision;
        port.methods.playerSyncState({
          isSlave: event.active,
          playing: event.active,
          recording: event.recording,
          frozen: event.frozen,
          frameIndex: event.frameIndex,
          revision: event.revision,
        });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (event.type === 'error') {
        recordingController?.failRecordingStream(event.error);
        return;
      }
      assertNever(event, 'Unhandled project realtime event');
    },
    onPacket: (data) => {
      handleRealtimePacket(audioDecode, data);
    },
    onClose: (error) => {
      port.methods.setRealtimeState({ status: 'error' });
      console.error('Project realtime socket failed', error);
      if (recordingStream) {
        recordingController?.failRecordingStream(error);
      }
    },
  });

  recordingController = createRecordingController({
    getRecordingStream: () => recordingStream,
    setRecordingStream: (stream) => {
      recordingStream = stream;
    },
    getRecordingReady: () => recordingReady,
    setRecordingReady: (ready) => {
      recordingReady = ready;
    },
    realtime,
    port,
  });

  const frameIndexStream = createPlayerFrameIndexStream({
    playhead,
    onFrameIndex: (message) => {
      realtime.sendJson({
        type: 'player.frameIndex',
        frameIndex: message.frameIndex,
        frozen: false,
        revision: backendRevision,
        source: 'playback',
      });
    },
  });

  port.bindHandlers({
    mount: async (message) => {
      try {
        realtime.open(message.projectId);
        const mounted = await audioDecode.mount(message);
        port.methods.mounted({ frameCount: mounted.frameCount });
        realtime.sendJson({ type: 'player.sync.request' });
      } catch (error) {
        console.error('Failed to load and decode project audio track', error);
        port.methods.setState({ status: 'error' });
      }
    },
    unmount: () => {
      frameIndexStream.stop();
      recordingController.clearRecordingStream();
      realtime.close();
      audioDecode.unmount();
      port.methods.unmounted();
    },
    startRecordingStream: (message) => {
      realtime.open(message.projectId);
      recordingController.clearRecordingStream();
      recordingStream = createRecordingStream({
        port: recordingStreamChannel.outbound(message.port),
        samples: message.samples,
        metadata: message.metadata,
        onChunk: (chunk) => {
          audioDecode.patchRecordingSamples(chunk);
          realtime.sendBinary(
            createRecordingPacket(chunk.frameIndex, chunk.samples),
          );
        },
        onError: recordingController.failRecordingStream,
      });
      realtime.sendJson({
        type: 'recording.start',
        sampleRate: message.sampleRate,
        frameCount: message.frameCount,
        latencyFrameCount: message.latencyFrameCount,
      });
    },
    finishRecordingStream: (message) => {
      const stream = recordingStream;
      if (!stream) {
        port.methods.recordingStreamFinished();
        return;
      }
      void stream
        .waitForFlush(message.sequence)
        .then(async () =>
          recordingController.finishCurrentRecordingStream(stream),
        )
        .then(() => {
          if (recordingStream === stream) {
            recordingController.clearRecordingStream();
          }
          port.methods.recordingStreamFinished();
        })
        .catch(recordingController.failRecordingStream);
    },
    sendPlayerPlay: () => {
      realtime.sendJson({ type: 'player.play' });
      frameIndexStream.start();
    },
    sendPlayerRecord: () => {
      realtime.sendJson({ type: 'player.record' });
      frameIndexStream.start();
    },
    sendPlayerStop: () => {
      frameIndexStream.stop();
      realtime.sendJson({ type: 'player.stop' });
    },
    sendPlayerFrameIndex: (message) => {
      realtime.sendJson({
        type: 'player.frameIndex',
        frameIndex: message.frameIndex,
        frozen: message.frozen,
        revision: message.revision,
        source: message.source,
      });
    },
    sendPlayerSyncRequest: () => {
      realtime.sendJson({ type: 'player.sync.request' });
    },
  });
};
