import { type api } from '@musetric/api';
import { assertNever } from '@musetric/utils';
import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { getRecordingList } from '../audioRequest/audioRequest.worker.js';
import { type Playhead } from '../player/playhead.cross.js';
import { type playerDataChannel } from '../player/protocol.cross.js';
import { recordingStreamChannel } from '../player/recordingStream.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { createAudioDecode } from './audioDecode.worker.js';
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
import {
  createRecordingList,
  isRecordingListEvent,
} from './recordingList.worker.js';
import {
  createRecordingPacket,
  createRecordingStream,
  readRecordingPacket,
  type RecordingStream,
} from './recordingStream.worker.js';

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

  const recordingList = createRecordingList({ port, audioDecode });

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
      if (event.recordingId !== recordingList.getActiveId()) {
        return;
      }
      audioDecode.beginLiveTake({
        takeId: event.sessionId,
        tempo: event.tempo,
      });
      return;
    }
    recordingReady = true;
    recordingStream?.notifyStarted();
    connection.flush();
  };

  const realtime = createProjectRealtime({
    isRecordingReady: () => recordingReady,
    onOpen: () => {
      port.methods.setRealtimeState({ status: 'success' });
    },
    onEvent: (event) => {
      if (isRecordingListEvent(event)) {
        recordingList.applyEvent(event, finishedTakeId);
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
      audioDecode.patchLiveTake(readRecordingPacket(data));
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
        const { recordings } = await getRecordingList(message.projectId);
        recordingList.apply(recordings);
        const mounted = await audioDecode.mount(message);
        port.methods.mounted({ frameCount: mounted.frameCount });
        realtime.sendJson({ type: 'player.sync.request' });
      } catch (error) {
        console.error('Failed to load and decode project audio track', error);
        port.methods.setState({ status: 'error' });
      }
    },
    unmount: () => {
      recordingList.clear();
      frameIndexStream.stop();
      recordingController.clearRecordingStream();
      realtime.close();
      audioDecode.unmount();
      port.methods.unmounted();
    },
    startRecordingStream: (message) => {
      realtime.open(message.projectId);
      recordingController.clearRecordingStream();
      const recordingId = recordingList.getActiveId();
      if (recordingId === undefined) {
        port.methods.recordingStreamFailed({
          error: 'The project has no active recording',
        });
        return;
      }
      recordingSessionId = crypto.randomUUID();
      audioDecode.beginLiveTake({
        takeId: recordingSessionId,
        tempo: message.tempo,
      });
      recordingStream = createRecordingStream({
        port: recordingStreamChannel.outbound(message.port),
        onChunk: (chunk) => {
          audioDecode.patchLiveTake(chunk);
          realtime.sendBinary(createRecordingPacket(chunk));
        },
      });
      realtime.sendJson({
        type: 'recording.start',
        recordingId,
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
      const recordingId = recordingList.getActiveId();
      if (recordingId !== undefined) {
        realtime.sendJson({ type: 'recording.undo', recordingId });
      }
    },
    sendRecordingRedo: () => {
      const recordingId = recordingList.getActiveId();
      if (recordingId !== undefined) {
        realtime.sendJson({ type: 'recording.redo', recordingId });
      }
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
