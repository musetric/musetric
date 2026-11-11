import { describe, expect, it } from 'vitest';
import { engineDecoderChannel } from '../protocol.cross.js';
import { type ProjectRealtime } from '../realtime.worker.js';
import { createRecordingController } from '../recordingController.worker.js';

describe('recording controller', () => {
  it('drops the queued packets of the take it clears', () => {
    let dropped = 0;
    const realtime: ProjectRealtime = {
      open: () => undefined,
      close: () => undefined,
      ready: async () => Promise.resolve(),
      sendJson: () => undefined,
      sendBinary: () => undefined,
      dropPackets: () => {
        dropped += 1;
      },
      flush: () => undefined,
    };
    const controller = createRecordingController({
      getRecordingStream: () => undefined,
      setRecordingStream: () => undefined,
      getRecordingReady: () => false,
      setRecordingReady: () => undefined,
      realtime,
      port: engineDecoderChannel.inbound({
        postMessage: () => undefined,
        onmessage: () => undefined,
      }),
    });

    controller.clearRecordingStream();

    expect(dropped).toBe(1);
  });
});
