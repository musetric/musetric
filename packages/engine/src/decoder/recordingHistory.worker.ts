import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { getRecordingHistory } from '../audioRequest/audioRequest.worker.js';
import { type engineDecoderChannel } from './protocol.cross.js';

export type RecordingHistoryChange = {
  canUndo: boolean;
  canRedo: boolean;
};

export type RecordingHistory = {
  load: (projectId: number) => Promise<void>;
  apply: (change: RecordingHistoryChange) => void;
};

export type CreateRecordingHistoryOptions = {
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
  reload: () => Promise<void>;
};

export const createRecordingHistory = (
  options: CreateRecordingHistoryOptions,
): RecordingHistory => {
  const { port, reload } = options;

  return {
    load: async (projectId) => {
      try {
        const history = await getRecordingHistory(projectId);
        port.methods.recordingHistoryChanged({
          canUndo: history.canUndo,
          canRedo: history.canRedo,
        });
      } catch (error) {
        console.error('Failed to load the recording history', error);
      }
    },
    apply: (change) => {
      port.methods.recordingHistoryChanged({
        canUndo: change.canUndo,
        canRedo: change.canRedo,
      });
      reload().catch((error: unknown) => {
        console.error('Failed to reload the recording', error);
      });
    },
  };
};
