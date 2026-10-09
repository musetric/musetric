import { describe, expect, it, vi } from 'vitest';
import { playerDataChannel } from '../../player/protocol.cross.js';
import { spectrogramDataChannel } from '../../spectrogram/protocol.cross.js';
import { createAudioDecode } from '../audioDecode.worker.js';

type Gate = {
  promise: Promise<void>;
  open: () => void;
};

const createGate = (): Gate => {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

const gates = new Map<number, Gate>();

vi.mock('../../audioRequest/audioRequest.worker.js', () => ({
  getDeliveryAudioContent: async () =>
    Promise.resolve({ buffer: new ArrayBuffer(0) }),
  getRecordingPieces: async (projectId: number, recordingId: number) => {
    await gates.get(recordingId)?.promise;
    return {
      pieces: [
        {
          blobId: `take-${projectId}-${recordingId}`,
          sampleRate: 48000,
          songStartFrame: 0,
          frameCount: 4,
          tempo: 1,
        },
      ],
    };
  },
  getRecordingPiece: async (projectId: number, recordingId: number) =>
    Promise.resolve({ buffer: new ArrayBuffer(projectId * recordingId) }),
}));

vi.mock('@musetric/audio/decoder', () => ({
  decodeMp4: async () =>
    Promise.resolve({
      frameCount: 8,
      channels: [new Float32Array(8), new Float32Array(8)],
    }),
  decodeWav: async (buffer: ArrayBuffer) =>
    Promise.resolve({
      channels: [new Float32Array(4).fill(buffer.byteLength)],
    }),
}));

const settle = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

type Received = {
  recording: number | undefined;
  switched: boolean;
};

const createHarness = () => {
  const player = new MessageChannel();
  const spectrogram = new MessageChannel();
  const received: Received[] = [];
  const ignore = () => undefined;
  playerDataChannel.inbound(player.port2).bindHandlers({
    mount: ignore,
    unmount: ignore,
    beginLiveTake: ignore,
    appendLiveTake: ignore,
    setRecordingPieces: (message) => {
      received.push({
        recording: message.pieces[0]?.samples[0],
        switched: Boolean(message.switched),
      });
    },
  });
  spectrogramDataChannel.inbound(spectrogram.port2).bindHandlers({
    mount: ignore,
    unmount: ignore,
    beginLiveTake: ignore,
    appendLiveTake: ignore,
    setRecordingPieces: ignore,
  });
  const audioDecode = createAudioDecode({
    playerPort: playerDataChannel.outbound(player.port1),
    spectrogramPort: spectrogramDataChannel.outbound(spectrogram.port1),
  });
  return {
    audioDecode,
    received,
    close: () => {
      player.port1.close();
      spectrogram.port1.close();
    },
  };
};

describe('audio decode', () => {
  it('keeps a late answer for an earlier recording out of the new one', async () => {
    const harness = createHarness();
    harness.audioDecode.setActiveRecording(1);
    await harness.audioDecode.mount({ projectId: 1, sampleRate: 48000 });
    const slow = createGate();
    gates.set(2, slow);

    harness.audioDecode.setActiveRecording(2);
    await settle();
    harness.audioDecode.setActiveRecording(3);
    await settle();
    slow.open();
    await settle();

    expect(harness.received).toEqual([{ recording: 3, switched: true }]);
    harness.close();
  });

  it('loads a recording once when it is chosen twice in a row', async () => {
    const harness = createHarness();
    harness.audioDecode.setActiveRecording(1);
    await harness.audioDecode.mount({ projectId: 1, sampleRate: 48000 });

    harness.audioDecode.setActiveRecording(2);
    harness.audioDecode.setActiveRecording(3);
    await settle();

    expect(harness.received).toEqual([{ recording: 3, switched: true }]);
    harness.close();
  });

  it('keeps the live take when its own recording reloads', async () => {
    const harness = createHarness();
    harness.audioDecode.setActiveRecording(2);
    await harness.audioDecode.mount({ projectId: 1, sampleRate: 48000 });

    await harness.audioDecode.reloadRecording('take');
    await settle();

    expect(harness.received).toEqual([{ recording: 2, switched: false }]);
    harness.close();
  });
});
