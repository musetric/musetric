import { type AudioDecoder } from '@musetric/audio/decoder';
import { describe, expect, it, vi } from 'vitest';
import { playerDataChannel } from '../../player/protocol.cross.js';
import { spectrogramDataChannel } from '../../spectrogram/protocol.cross.js';
import { createAudioDecode } from '../audioDecode.worker.js';
import {
  type StemPageReader,
  type StemPageReaders,
} from '../stemPageReaders.worker.js';

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
          transpose: 0,
          octave: 0,
        },
      ],
    };
  },
  getRecordingPiece: async (projectId: number, recordingId: number) =>
    Promise.resolve({ buffer: new ArrayBuffer(projectId * recordingId) }),
}));

vi.mock('@musetric/audio/decoder', () => ({
  createAudioDecoder: (): AudioDecoder => ({
    decode: async (buffer) =>
      Promise.resolve({
        frameCount: 4,
        channels: [new Float32Array(4).fill(buffer.byteLength)],
      }),
  }),
}));

const pageStarts = [0, 4];

vi.mock('../stemPageReaders.worker.js', () => {
  const reader: StemPageReader = {
    open: async () =>
      Promise.resolve({ frameCount: 8, channelCount: 2, pageStarts }),
    read: async (index, mono) =>
      Promise.resolve({
        id: index,
        index,
        startFrame: pageStarts[index],
        frameCount: 4,
        samples: new Float32Array(mono ? 4 : 8).fill(index + 1),
      }),
  };
  return {
    createStemPageReaders: (): StemPageReaders => ({
      lead: reader,
      backing: reader,
      instrumental: reader,
    }),
  };
});

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

type ReceivedPage = {
  stem: string;
  index: number;
  sample: number | undefined;
};

const createHarness = () => {
  const player = new MessageChannel();
  const spectrogram = new MessageChannel();
  const received: Received[] = [];
  const pages: ReceivedPage[] = [];
  const leadPages: ReceivedPage[] = [];
  const ignore = () => undefined;
  const playerSide = playerDataChannel.inbound(player.port2);
  const spectrogramSide = spectrogramDataChannel.inbound(spectrogram.port2);
  playerSide.bindHandlers({
    mount: ignore,
    unmount: ignore,
    putPage: (message) => {
      pages.push({
        stem: message.stem,
        index: message.index,
        sample: message.samples[0],
      });
    },
    dropPages: ignore,
    beginLiveTake: ignore,
    appendLiveTake: ignore,
    setRecordingPieces: (message) => {
      received.push({
        recording: message.pieces[0]?.samples[0],
        switched: Boolean(message.switched),
      });
    },
  });
  spectrogramSide.bindHandlers({
    mount: ignore,
    unmount: ignore,
    putLeadPage: (message) => {
      leadPages.push({
        stem: 'lead',
        index: message.index,
        sample: message.samples[0],
      });
    },
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
    pages,
    leadPages,
    playerSide,
    spectrogramSide,
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

  it('sends the player the pages around the frame it asks for', async () => {
    const harness = createHarness();
    await harness.audioDecode.mount({ projectId: 1, sampleRate: 48000 });

    harness.playerSide.methods.requestWindow({ frameIndex: 0 });
    await settle();

    expect(
      harness.pages
        .map(
          (page) => `${page.stem}:${String(page.index)}:${String(page.sample)}`,
        )
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual([
      'backing:0:1',
      'backing:1:2',
      'instrumental:0:1',
      'instrumental:1:2',
      'lead:0:1',
      'lead:1:2',
    ]);
    harness.close();
  });

  it('sends the spectrogram the pages of the lead it asks for', async () => {
    const harness = createHarness();
    await harness.audioDecode.mount({ projectId: 1, sampleRate: 48000 });

    harness.spectrogramSide.methods.requestLeadPages({ indices: [1] });
    await settle();

    expect(harness.leadPages).toEqual([{ stem: 'lead', index: 1, sample: 2 }]);
    harness.close();
  });
});
