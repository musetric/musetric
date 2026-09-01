import { DB } from '@musetric/backend-db';
import { type StorageWorkspace } from './storageWorkspace.js';

export const fixtureProjectId = 1;

const audioAnalysis = {
  sourceIntegratedLoudnessDb: -14.2,
  sourceTruePeakDb: -1.1,
  sourceGainDb: 0.4,
  leadIntegratedLoudnessDb: -16.5,
  leadTruePeakDb: -2.3,
  leadP95RmsDb: -18.7,
  leadSpectrogramGainDb: 3.2,
  backingIntegratedLoudnessDb: -17.1,
  backingTruePeakDb: -2.8,
  instrumentalIntegratedLoudnessDb: -15.9,
  instrumentalTruePeakDb: -1.7,
  leadGainDb: 1.5,
  backingGainDb: -0.6,
  instrumentalGainDb: 0.9,
};

const subtitle = [
  {
    text: 'a line',
    start: 0,
    end: 1.5,
    words: [{ text: 'a', start: 0, end: 0.5 }],
  },
];

const rhythm = { bpm: 120, beats: [0, 0.5, 1], downbeats: [0] };
const key = { root: 'C', mode: 'major', confidence: 0.8 };
const chords = {
  segments: [{ start: 0, end: 1, label: 'C', root: 'C', quality: 'major' }],
};

const audioBody = (marker: string): Buffer =>
  Buffer.from(`fixture ${marker} audio`, 'utf8');

const jsonBody = (value: unknown): Buffer =>
  Buffer.from(JSON.stringify(value), 'utf8');

export const createProjectFixture = async (
  workspace: StorageWorkspace,
): Promise<void> => {
  const db = await DB.createInstance(workspace.config.databasePath);
  try {
    const created = await db.project.create({
      name: 'Fixture project',
      song: {
        blobId: await workspace.addBlob(audioBody('source')),
        filename: 'source.flac',
        contentType: 'audio/flac',
      },
      sampleRate: 44100,
      frameCount: 441000,
      preview: {
        blobId: await workspace.addBlob(Buffer.from('fixture preview', 'utf8')),
        filename: 'preview.png',
        contentType: 'image/png',
      },
    });
    const projectId = created.project.id;

    await db.processing.applySeparationResult({
      projectId,
      audioAnalysis,
      master: {
        leadId: await workspace.addBlob(audioBody('master lead')),
        backingId: await workspace.addBlob(audioBody('master backing')),
        instrumentalId: await workspace.addBlob(
          audioBody('master instrumental'),
        ),
      },
      delivery: {
        leadId: await workspace.addBlob(audioBody('delivery lead')),
        backingId: await workspace.addBlob(audioBody('delivery backing')),
        instrumentalId: await workspace.addBlob(
          audioBody('delivery instrumental'),
        ),
      },
      wavePeaks: {
        leadId: await workspace.addBlob(audioBody('wave lead')),
        backingId: await workspace.addBlob(audioBody('wave backing')),
        instrumentalId: await workspace.addBlob(audioBody('wave instrumental')),
      },
    });
    await db.processing.applyTranscriptionResult({
      projectId,
      blobId: await workspace.addBlob(jsonBody(subtitle)),
    });
    await db.processing.applyRhythmResult({
      projectId,
      blobId: await workspace.addBlob(jsonBody(rhythm)),
    });
    await db.processing.applyKeyResult({
      projectId,
      blobId: await workspace.addBlob(jsonBody(key)),
    });
    await db.processing.applyChordsResult({
      projectId,
      blobId: await workspace.addBlob(jsonBody(chords)),
    });
    await db.recording.create({
      projectId,
      blobId: await workspace.addBlob(audioBody('recording')),
      waveBlobId: await workspace.addBlob(audioBody('recording wave')),
      sampleRate: 44100,
      frameCount: 220500,
    });
  } finally {
    await db.disconnect();
  }
};

export const createFixtureAudioFile = (): File => {
  const frameCount = 4410;
  const dataLength = frameCount * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(88200, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataLength, 40);
  return new File([buffer], 'fixture.wav', { type: 'audio/wav' });
};

export const failFixtureStep = async (
  workspace: StorageWorkspace,
  step: 'separation' | 'transcription' | 'rhythm' | 'key' | 'chords',
): Promise<void> => {
  const db = await DB.createInstance(workspace.config.databasePath);
  try {
    await db.processing.recordError({
      projectId: fixtureProjectId,
      step,
      message: 'Fixture failure',
    });
  } finally {
    await db.disconnect();
  }
};
