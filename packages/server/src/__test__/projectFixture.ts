import { DatabaseSync } from 'node:sqlite';
import { type StorageWorkspace } from './storageWorkspace.js';

export const fixtureProjectId = 1;

const audioAnalysis = [
  -14.2, -1.1, 0.4, -16.5, -2.3, -18.7, 3.2, -17.1, -2.8, -15.9, -1.7, 1.5,
  -0.6, 0.9,
];

const analysisColumns = [
  'sourceIntegratedLoudnessDb',
  'sourceTruePeakDb',
  'sourceGainDb',
  'leadIntegratedLoudnessDb',
  'leadTruePeakDb',
  'leadP95RmsDb',
  'leadSpectrogramGainDb',
  'backingIntegratedLoudnessDb',
  'backingTruePeakDb',
  'instrumentalIntegratedLoudnessDb',
  'instrumentalTruePeakDb',
  'leadGainDb',
  'backingGainDb',
  'instrumentalGainDb',
];

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

const stemTypes = ['lead', 'backing', 'instrumental'];
const analysisTables = [
  ['Subtitle', subtitle],
  ['Rhythm', rhythm],
  ['Key', key],
  ['Chords', chords],
] as const;

const audioBody = (marker: string): Buffer =>
  Buffer.from(`fixture ${marker} audio`, 'utf8');

const jsonBody = (value: unknown): Buffer =>
  Buffer.from(JSON.stringify(value), 'utf8');

type Stem = {
  master: string;
  delivery: string;
  wave: string;
};

const addStem = async (
  workspace: StorageWorkspace,
  stemType: string,
): Promise<Stem> => ({
  master: await workspace.addBlob(audioBody(`master ${stemType}`)),
  delivery: await workspace.addBlob(audioBody(`delivery ${stemType}`)),
  wave: await workspace.addBlob(audioBody(`wave ${stemType}`)),
});

type FixtureBlobs = {
  song: string;
  preview: string;
  stems: Stem[];
  analyses: string[];
  recording: string;
  recordingWave: string;
};

const addFixtureBlobs = async (
  workspace: StorageWorkspace,
): Promise<FixtureBlobs> => {
  const song = await workspace.addBlob(audioBody('source'));
  const preview = await workspace.addBlob(
    Buffer.from('fixture preview', 'utf8'),
  );
  const stems: Stem[] = [];
  for (const stemType of stemTypes) {
    stems.push(await addStem(workspace, stemType));
  }
  const analyses: string[] = [];
  for (const table of analysisTables) {
    analyses.push(await workspace.addBlob(jsonBody(table[1])));
  }
  return {
    song,
    preview,
    stems,
    analyses,
    recording: await workspace.addBlob(audioBody('recording')),
    recordingWave: await workspace.addBlob(audioBody('recording wave')),
  };
};

const insertProject = (database: DatabaseSync, blobs: FixtureBlobs): void => {
  database
    .prepare(
      'INSERT INTO Project (id, name, sampleRate, frameCount) VALUES (?, ?, ?, ?)',
    )
    .run(fixtureProjectId, 'Fixture project', 44100, 441000);
  const master = database.prepare(
    'INSERT INTO AudioMaster (projectId, type, blobId) VALUES (?, ?, ?)',
  );
  master.run(fixtureProjectId, 'source', blobs.song);
  database
    .prepare(
      'INSERT INTO Preview (projectId, blobId, filename, contentType) VALUES (?, ?, ?, ?)',
    )
    .run(fixtureProjectId, blobs.preview, 'preview.png', 'image/png');
  const delivery = database.prepare(
    'INSERT INTO AudioDelivery (projectId, stemType, blobId, waveBlobId) VALUES (?, ?, ?, ?)',
  );
  stemTypes.forEach((stemType, index) => {
    const stem = blobs.stems[index];
    master.run(fixtureProjectId, stemType, stem.master);
    delivery.run(fixtureProjectId, stemType, stem.delivery, stem.wave);
  });
};

const insertAnalyses = (database: DatabaseSync, blobs: FixtureBlobs): void => {
  const placeholders = analysisColumns.map(() => '?').join(', ');
  database
    .prepare(
      `INSERT INTO ProjectAudioAnalysis (projectId, ${analysisColumns.join(', ')}) VALUES (?, ${placeholders})`,
    )
    .run(fixtureProjectId, ...audioAnalysis);
  analysisTables.forEach((table, index) => {
    database
      .prepare(`INSERT INTO ${table[0]} (projectId, blobId) VALUES (?, ?)`)
      .run(fixtureProjectId, blobs.analyses[index]);
  });
  database
    .prepare(
      'INSERT INTO Recording (projectId, blobId, waveBlobId, sampleRate, frameCount) VALUES (?, ?, ?, ?, ?)',
    )
    .run(fixtureProjectId, blobs.recording, blobs.recordingWave, 44100, 220500);
};

const withDatabase = (
  workspace: StorageWorkspace,
  run: (database: DatabaseSync) => void,
): void => {
  const database = new DatabaseSync(workspace.paths.databasePath);
  try {
    run(database);
  } finally {
    database.close();
  }
};

export const createProjectFixture = async (
  workspace: StorageWorkspace,
): Promise<void> => {
  const blobs = await addFixtureBlobs(workspace);
  withDatabase(workspace, (database) => {
    insertProject(database, blobs);
    insertAnalyses(database, blobs);
  });
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

export type ProcessingStepName =
  | 'separation'
  | 'transcription'
  | 'rhythm'
  | 'key'
  | 'chords';

export const failFixtureStep = (
  workspace: StorageWorkspace,
  step: ProcessingStepName,
): void => {
  withDatabase(workspace, (database) => {
    database
      .prepare(
        'INSERT INTO ProcessingError (projectId, step, message) VALUES (?, ?, ?)',
      )
      .run(fixtureProjectId, step, 'Fixture failure');
  });
};
