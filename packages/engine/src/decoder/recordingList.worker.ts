import { type api } from '@musetric/api';
import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { type AudioDecode } from './audioDecode.worker.js';
import { type engineDecoderChannel } from './protocol.cross.js';

export type RecordingListEvent = Extract<
  api.project.realtime.Event,
  { type: 'recording.peaksChanged' | 'recording.changed' | 'recording.list' }
>;

export const isRecordingListEvent = (
  event: api.project.realtime.Event,
): event is RecordingListEvent =>
  event.type === 'recording.peaksChanged' ||
  event.type === 'recording.changed' ||
  event.type === 'recording.list';

export type RecordingList = {
  getActiveId: () => number | undefined;
  apply: (recordings: api.recording.Item[]) => void;
  applyEvent: (
    event: RecordingListEvent,
    finishedTakeId: string | undefined,
  ) => void;
  clear: () => void;
};

export type CreateRecordingListOptions = {
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
  audioDecode: AudioDecode;
};

export const createRecordingList = (
  options: CreateRecordingListOptions,
): RecordingList => {
  const { port, audioDecode } = options;
  let activeId: number | undefined = undefined;

  const apply = (recordings: api.recording.Item[]) => {
    port.methods.recordingsChanged({ recordings });
    activeId = recordings.find((recording) => recording.active)?.id;
    audioDecode.setActiveRecording(activeId);
  };

  return {
    getActiveId: () => activeId,
    apply,
    applyEvent: (event, finishedTakeId) => {
      if (event.type === 'recording.list') {
        apply(event.recordings);
        return;
      }
      if (event.recordingId !== activeId) {
        return;
      }
      if (event.type === 'recording.peaksChanged') {
        port.methods.recordingPeaksChanged({
          recordingId: event.recordingId,
          startPeakIndex: event.startPeakIndex,
          peaks: new Float32Array(event.peaks),
        });
        return;
      }
      port.methods.recordingContentChanged({ recordingId: event.recordingId });
      audioDecode.reloadRecording(finishedTakeId).catch((error: unknown) => {
        console.error('Failed to reload the recording', error);
      });
    },
    clear: () => {
      activeId = undefined;
    },
  };
};
