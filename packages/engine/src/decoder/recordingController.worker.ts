import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { type engineDecoderChannel } from './protocol.cross.js';
import { type ProjectRealtime } from './realtime.worker.js';
import { type RecordingStream } from './recordingStream.worker.js';

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

export const waitWithTimeout = async (
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> =>
  await Promise.race([
    promise.then(() => true),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }).then(() => false),
  ]);

export type RecordingController = {
  clearRecordingStream: () => void;
  failRecordingStream: (error: unknown) => void;
  finishCurrentRecordingStream: (stream: RecordingStream) => Promise<void>;
};

export type RecordingControllerDeps = {
  getRecordingStream: () => RecordingStream | undefined;
  setRecordingStream: (stream: RecordingStream | undefined) => void;
  getRecordingReady: () => boolean;
  setRecordingReady: (ready: boolean) => void;
  realtime: ProjectRealtime;
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
};

export const createRecordingController = (
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
