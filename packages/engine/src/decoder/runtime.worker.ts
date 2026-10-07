import { type api } from '@musetric/api';
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
  createRecordingController,
  type RecordingController,
  waitWithTimeout,
} from './recordingController.worker.js';
import { createRecordingHistory } from './recordingHistory.worker.js';
import {
  createRecordingPacket,
  createRecordingStream,
  recordingPacketHeaderByteLength,
  type RecordingStream,
} from './recordingStream.worker.js';

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
  audioDecode.patchLiveTake({
    frameIndex,
    samples: new Float32Array(
      data,
      recordingPacketHeaderByteLength,
      frameCount,
    ),
  });
};

const takeFinishTimeoutMs = 10000;

type TakeEvent = Extract<
  api.project.realtime.Event,
  { type: 'recording.started' | 'recording.finished' }
>;

export type CreateDecoderWorkerRuntimeOptions = {
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
  playerPort: ReturnType<typeof playerDataChannel.outbound<MessagePort>>;
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
  playhead: Playhead;
};

export const createDecoderWorkerRuntime = (
  options: CreateDecoderWorkerRuntimeOptions,
): void => {
  const { port, playerPort, spectrogramPort, playhead } = options;

  const audioDecode = createAudioDecode({ playerPort, spectrogramPort });

  let recordingStream: RecordingStream | undefined = undefined;
  let recordingSessionId: string | undefined = undefined;
  let recordingReady = false;
  let backendRevision = 0;
  let finishedTakeId: string | undefined = undefined;

  let recordingController: RecordingController | undefined = undefined;

  const applyTakeEvent = (event: TakeEvent, connection: ProjectRealtime) => {
    const own = event.sessionId === recordingSessionId;
    if (event.type === 'recording.finished') {
      finishedTakeId = event.sessionId;
      audioDecode.reloadRecording(event.sessionId).catch((error: unknown) => {
        console.error('Failed to reload the recording', error);
      });
      if (own) {
        recordingReady = false;
        recordingStream?.notifyFinished();
      }
      return;
    }
    if (!own) {
      audioDecode.beginLiveTake({
        takeId: event.sessionId,
        tempo: event.tempo,
        startFrame: event.startFrame,
      });
      return;
    }
    recordingReady = true;
    recordingStream?.notifyStarted();
    connection.flush();
  };

  const recordingHistory = createRecordingHistory({
    port,
    reload: async () => audioDecode.reloadRecording(finishedTakeId),
  });

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
      if (event.type === 'recording.changed') {
        recordingHistory.apply(event);
        return;
      }
      if (
        event.type === 'recording.started' ||
        event.type === 'recording.finished'
      ) {
        applyTakeEvent(event, realtime);
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
        void recordingHistory.load(message.projectId);
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
      recordingSessionId = crypto.randomUUID();
      audioDecode.beginLiveTake({
        takeId: recordingSessionId,
        tempo: message.tempo,
      });
      recordingStream = createRecordingStream({
        port: recordingStreamChannel.outbound(message.port),
        onChunk: (chunk) => {
          audioDecode.patchLiveTake(chunk);
          realtime.sendBinary(
            createRecordingPacket(chunk.frameIndex, chunk.samples),
          );
        },
      });
      realtime.sendJson({
        type: 'recording.start',
        sessionId: recordingSessionId,
        sampleRate: message.sampleRate,
        frameCount: message.frameCount,
        latencyFrameCount: message.latencyFrameCount,
        tempo: message.tempo,
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
    exportRecording: async () => {
      try {
        if (recordingStream) {
          await waitWithTimeout(recordingStream.finish, takeFinishTimeoutMs);
        }
        const samples = await audioDecode.exportRecording();
        port.methods.recordingExported({ samples });
      } catch (error) {
        console.error('Failed to export the recording', error);
        port.methods.recordingExportFailed();
      }
    },
    sendRecordingUndo: () => {
      realtime.sendJson({ type: 'recording.undo' });
    },
    sendRecordingRedo: () => {
      realtime.sendJson({ type: 'recording.redo' });
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
