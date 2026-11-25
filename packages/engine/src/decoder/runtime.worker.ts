import { type api } from '@musetric/api';
import { assertNever } from '@musetric/utils';
import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { getRecordingList } from '../audioRequest/audioRequest.worker.js';
import { playerDataChannel } from '../player/protocol.cross.js';
import { recordingStreamChannel } from '../player/recordingStream.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { createAudioDecode } from './audioDecode.worker.js';
import { createLoopTries } from './loopTries.worker.js';
import { type engineDecoderChannel } from './protocol.cross.js';
import {
  createProjectRealtime,
  type ProjectRealtime,
} from './realtime.worker.js';
import { createRecordingBatch } from './recordingBatch.worker.js';
import {
  createRecordingController,
  type RecordingController,
} from './recordingController.worker.js';
import {
  createRecordingList,
  isRecordingListEvent,
} from './recordingList.worker.js';
import {
  createRecordingStream,
  type RecordingStream,
} from './recordingStream.worker.js';

type TakeEvent = Extract<
  api.project.realtime.Event,
  { type: 'recording.started' | 'recording.finished' }
>;

export type CreateDecoderWorkerRuntimeOptions = {
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
};

export const createDecoderWorkerRuntime = (
  options: CreateDecoderWorkerRuntimeOptions,
): void => {
  const { port, spectrogramPort } = options;

  const audioDecode = createAudioDecode({ spectrogramPort });

  const recordingList = createRecordingList({ port, audioDecode });

  const loopTries = createLoopTries({ audioDecode });

  let recordingStream: RecordingStream | undefined = undefined;
  let draftStream = false;
  let recordingSessionId: string | undefined = undefined;
  let recordingReady = false;
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (event.type === 'error') {
        recordingController?.failRecordingStream(event.error);
        return;
      }
      assertNever(event, 'Unhandled project realtime event');
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

  port.bindHandlers({
    connectPlayer: (message) => {
      audioDecode.connectPlayer(playerDataChannel.outbound(message.playerPort));
      port.methods.playerConnected();
    },
    mount: async (message) => {
      try {
        realtime.open(message.projectId);
        const { recordings } = await getRecordingList(message.projectId);
        recordingList.apply(recordings);
        const mounted = await audioDecode.mount(message);
        port.methods.mounted({ frameCount: mounted.frameCount });
      } catch (error) {
        console.error('Failed to load and decode project audio track', error);
        port.methods.setState({ status: 'error' });
      }
    },
    unmount: () => {
      loopTries.clear();
      recordingList.clear();
      recordingController.clearRecordingStream();
      realtime.close();
      audioDecode.unmount();
      port.methods.unmounted();
    },
    requestTarget: (message) => {
      audioDecode.requestTarget(message);
    },
    startRecordingStream: (message) => {
      draftStream = message.draft;
      if (message.draft) {
        recordingController.clearRecordingStream();
        recordingStream = loopTries.openDraft(message);
        return;
      }
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
        transpose: message.transpose,
        octave: message.octave,
      });
      const batch = createRecordingBatch({
        sampleRate: message.sampleRate,
        realtime,
      });
      recordingStream = createRecordingStream({
        port: recordingStreamChannel.outbound(message.port),
        onChunk: (chunk) => {
          audioDecode.patchLiveTake(chunk);
          batch.push(chunk);
        },
        onFlush: batch.flush,
      });
      realtime.sendJson({
        type: 'recording.start',
        recordingId,
        sessionId: recordingSessionId,
        sampleRate: message.sampleRate,
        frameCount: message.frameCount,
        latencyFrameCount: message.latencyFrameCount,
        tempo: message.tempo,
        transpose: message.transpose,
        octave: message.octave,
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
          draftStream
            ? undefined
            : recordingController.finishCurrentRecordingStream(stream),
        )
        .then(() => {
          if (recordingStream === stream) {
            recordingController.clearRecordingStream();
          }
          port.methods.recordingStreamFinished();
        })
        .catch(recordingController.failRecordingStream);
    },
    settleLoopTry: (message) => {
      port.methods.loopTrySettled({ loopTry: loopTries.settle(message.keep) });
    },
    selectLoopTry: (message) => {
      loopTries.select(message.tryId);
    },
    deleteLoopTry: (message) => {
      loopTries.remove(message.tryId);
    },
    discardLoopTries: () => {
      loopTries.discard();
    },
    insertLoopTry: async (message) => {
      const recordingId = recordingList.getActiveId();
      const inserted =
        recordingId !== undefined &&
        (await loopTries.insert({
          projectId: message.projectId,
          recordingId,
          tryId: message.tryId,
          sampleRate: message.sampleRate,
          frameCount: message.frameCount,
        }));
      port.methods.loopTryInserted({ inserted });
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
  });
};
