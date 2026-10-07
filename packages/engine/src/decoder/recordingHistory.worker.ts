import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { getRecordingHistory } from '../audioRequest/audioRequest.worker.js';
import { type AudioDecode } from './audioDecode.worker.js';
import { type engineDecoderChannel } from './protocol.cross.js';

export type RecordingHistoryChange = {
  canUndo: boolean;
  canRedo: boolean;
  audioChanged: boolean;
};

export type RecordingHistory = {
  load: (projectId: number) => Promise<void>;
  apply: (change: RecordingHistoryChange) => void;
};

export type CreateRecordingHistoryOptions = {
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
  audioDecode: AudioDecode;
};

export const createRecordingHistory = (
  options: CreateRecordingHistoryOptions,
): RecordingHistory => {
  const { port, audioDecode } = options;
  let reloadStale = false;

  const reload = async (): Promise<void> => {
    try {
      reloadStale = !(await audioDecode.reloadRecording());
    } catch (error) {
      reloadStale = true;
      console.error('Failed to reload the recording', error);
    }
  };

  return {
    load: async (projectId) => {
      try {
        const history = await getRecordingHistory(projectId);
        port.methods.recordingHistoryChanged({
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          audioChanged: false,
        });
      } catch (error) {
        console.error('Failed to load the recording history', error);
      }
    },
    apply: (change) => {
      const audioChanged = change.audioChanged || reloadStale;
      port.methods.recordingHistoryChanged({
        canUndo: change.canUndo,
        canRedo: change.canRedo,
        audioChanged,
      });
      if (audioChanged) {
        void reload();
      }
    },
  };
};
