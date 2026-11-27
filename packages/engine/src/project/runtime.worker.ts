import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { getRecordingList } from '../audioRequest/audioRequest.worker.js';
import { playerDataChannel } from '../player/protocol.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { createProjectAudio } from './audio.worker.js';
import { createLoopTries } from './loopTries.worker.js';
import { type engineProjectChannel } from './protocol.cross.js';
import { createProjectRealtime } from './realtime.worker.js';
import {
  createRecordingList,
  isRecordingListEvent,
} from './recordingList.worker.js';
import { type RecordingStream } from './recordingStream.worker.js';
import {
  createTakeDelivery,
  type TakeDelivery,
} from './takeDelivery.worker.js';

const measure = import.meta.env.frontendMeasure === 'true';

export type CreateProjectWorkerRuntimeOptions = {
  port: ReturnType<typeof engineProjectChannel.inbound<MessagePortLike>>;
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
};

export const createProjectWorkerRuntime = (
  options: CreateProjectWorkerRuntimeOptions,
): void => {
  const { port, spectrogramPort } = options;

  const audio = createProjectAudio({ spectrogramPort });

  const recordingList = createRecordingList({ port, audio });

  const loopTries = createLoopTries({ audio });

  let draft: RecordingStream | undefined = undefined;
  let finishedTakeId: string | undefined = undefined;

  let takes: TakeDelivery | undefined = undefined;

  let mountedProjectId: number | undefined = undefined;

  const readRecordingList = async (projectId: number) => {
    const { recordings } = await getRecordingList(projectId);
    if (mountedProjectId === projectId) {
      recordingList.apply(recordings);
    }
  };

  const realtime = createProjectRealtime({
    onOpen: (projectId, reopened) => {
      port.methods.setRealtimeState({ status: 'success' });
      if (reopened) {
        readRecordingList(projectId).catch((error: unknown) => {
          console.error('Failed to read the recordings again', error);
        });
      }
      takes?.connect();
    },
    onEvent: (event) => {
      if (isRecordingListEvent(event)) {
        recordingList.applyEvent(event, finishedTakeId);
        return;
      }
      if (event.type === 'error') {
        console.error('The host reported an error', event.error);
      }
      if (event.type === 'recording.finished') {
        finishedTakeId = event.sessionId;
        audio.reloadRecording(event.sessionId).catch((error: unknown) => {
          console.error('Failed to reload the recording', error);
        });
      }
      takes?.apply(event);
    },
    onClose: (error) => {
      port.methods.setRealtimeState({ status: 'error' });
      console.error('Project realtime socket failed', error);
      takes?.disconnect();
    },
  });

  takes = createTakeDelivery({ realtime, port });

  const closeDraft = () => {
    draft?.close();
    draft = undefined;
  };

  if (measure) {
    // eslint-disable-next-line musetric/no-global-state -- the measure build gives the external driver one entry point
    Object.assign(globalThis, {
      musetricMeasureHooks: { dropRealtime: realtime.drop },
    });
  }

  port.bindHandlers({
    connectPlayer: (message) => {
      port.methods.playerConnected({
        mounted: audio.connectPlayer(
          playerDataChannel.outbound(message.playerPort),
        ),
      });
    },
    mount: async (message) => {
      try {
        mountedProjectId = message.projectId;
        realtime.open(message.projectId);
        await readRecordingList(message.projectId);
        const mounted = await audio.mount(message);
        port.methods.mounted({ frameCount: mounted.frameCount });
      } catch (error) {
        console.error('Failed to load and decode project audio track', error);
        port.methods.setState({ status: 'error' });
      }
    },
    unmount: () => {
      loopTries.clear();
      recordingList.clear();
      closeDraft();
      takes.clear();
      mountedProjectId = undefined;
      realtime.close();
      audio.unmount();
      port.methods.unmounted();
    },
    reconnectRealtime: () => {
      realtime.reconnect();
    },
    requestTarget: (message) => {
      audio.requestTarget(message);
    },
    startRecordingStream: (message) => {
      closeDraft();
      if (message.draft) {
        draft = loopTries.openDraft(message);
        return;
      }
      realtime.open(message.projectId);
      const recordingId = recordingList.getActiveId();
      if (recordingId === undefined) {
        port.methods.takeRefused({ takeId: message.takeId, reason: 'failed' });
        return;
      }
      takes.begin(
        {
          takeId: message.takeId,
          recordingId,
          sampleRate: message.sampleRate,
          frameCount: message.frameCount,
          latencyFrameCount: message.latencyFrameCount,
          tempo: message.tempo,
          transpose: message.transpose,
          octave: message.octave,
          port: message.port,
        },
        (chunk, take) => {
          audio.patchLiveTake(chunk, take);
        },
      );
    },
    finishRecordingStream: async (message) => {
      const { takeId, sequence } = message;
      if (takes.holds(takeId)) {
        const held = await takes.finish(takeId, sequence);
        if (held) {
          audio.holdTake(held);
        }
      } else {
        await draft?.waitForFlush(sequence);
        closeDraft();
      }
      port.methods.recordingStreamFinished({ takeId });
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
