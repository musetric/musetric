import { type PayloadSegment } from '@musetric/ai/dom';
import { type TrackAnalysis } from '../analysis/index.js';
import { type StorageClient } from '../storage/index.js';
import { type MobileProjectProcessing } from './processingTypes.js';
import {
  hasStringProperties,
  isObject,
  isOptionalArray,
  isPayloadSegment,
  isProjectCue,
  isProjectRecording,
  isProjectStem,
  type MobileProjectCue,
  type MobileProjectRecording,
  type MobileProjectStem,
} from './projectTypes.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const projectsPath = 'projects';
const metadataName = 'project.json';
const sourceName = 'source';

const isChordSegment = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  const end: unknown = Reflect.get(value, 'end');
  const label: unknown = Reflect.get(value, 'label');
  const quality: unknown = Reflect.get(value, 'quality');
  const root: unknown = Reflect.get(value, 'root');
  const start: unknown = Reflect.get(value, 'start');
  return (
    typeof end === 'number' &&
    typeof label === 'string' &&
    (quality === undefined || typeof quality === 'string') &&
    typeof root === 'string' &&
    typeof start === 'number'
  );
};

const isChordResult = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  const segments: unknown = Reflect.get(value, 'segments');
  return Array.isArray(segments) && segments.every(isChordSegment);
};

const isKeyResult = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  const confidence: unknown = Reflect.get(value, 'confidence');
  const mode: unknown = Reflect.get(value, 'mode');
  const root: unknown = Reflect.get(value, 'root');
  return (
    typeof confidence === 'number' &&
    (mode === 'major' || mode === 'minor') &&
    typeof root === 'string'
  );
};

const isNumberArray = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === 'number');

const isRhythmResult = (value: unknown): boolean => {
  if (!isObject(value)) {
    return false;
  }
  const beats: unknown = Reflect.get(value, 'beats');
  const bpm: unknown = Reflect.get(value, 'bpm');
  const downbeats: unknown = Reflect.get(value, 'downbeats');
  const meter: unknown = Reflect.get(value, 'meter');
  return (
    isNumberArray(beats) &&
    typeof bpm === 'number' &&
    isNumberArray(downbeats) &&
    typeof meter === 'number'
  );
};

const isTrackAnalysis = (value: unknown): value is TrackAnalysis => {
  if (!isObject(value)) {
    return false;
  }
  return (
    isChordResult(Reflect.get(value, 'chords')) &&
    isKeyResult(Reflect.get(value, 'key')) &&
    isRhythmResult(Reflect.get(value, 'rhythm'))
  );
};

export type MobileProject = {
  id: string;
  name: string;
  sourcePath: string;
  sourceFilename: string;
  sourceContentType: string;
  sourceSize: number;
  createdAt: string;
  updatedAt: string;
  processing?: MobileProjectProcessing;
  analysis?: TrackAnalysis;
  cues?: MobileProjectCue[];
  recordings?: MobileProjectRecording[];
  stems?: MobileProjectStem[];
  transcript?: PayloadSegment[];
};

const isMobileProject = (value: unknown): value is MobileProject => {
  if (!isObject(value)) {
    return false;
  }
  const analysis: unknown = Reflect.get(value, 'analysis');
  return (
    hasStringProperties(value, [
      'createdAt',
      'id',
      'name',
      'sourceContentType',
      'sourceFilename',
      'sourcePath',
      'updatedAt',
    ]) &&
    typeof Reflect.get(value, 'sourceSize') === 'number' &&
    (analysis === undefined || isTrackAnalysis(analysis)) &&
    isOptionalArray(Reflect.get(value, 'cues'), isProjectCue) &&
    isOptionalArray(Reflect.get(value, 'recordings'), isProjectRecording) &&
    isOptionalArray(Reflect.get(value, 'stems'), isProjectStem) &&
    isOptionalArray(Reflect.get(value, 'transcript'), isPayloadSegment)
  );
};

const metadataPath = (projectId: string): string =>
  `${projectsPath}/${projectId}/${metadataName}`;

const projectPath = (projectId: string): string =>
  `${projectsPath}/${projectId}`;

const recordingsPath = (projectId: string): string =>
  `${projectPath(projectId)}/recordings`;

const recordingExtension = (contentType: string): string =>
  contentType.includes('mp4') ? 'm4a' : 'webm';

const updateProject = (
  project: MobileProject,
  update: Partial<MobileProject>,
): MobileProject => ({
  ...project,
  ...update,
  updatedAt: new Date().toISOString(),
});

const readProject = async (
  storage: StorageClient,
  projectId: string,
): Promise<MobileProject | undefined> => {
  const data = await storage.readFile(metadataPath(projectId));
  if (data === undefined) {
    return undefined;
  }
  const value: unknown = JSON.parse(decoder.decode(data));
  if (!isMobileProject(value) || value.id !== projectId) {
    throw new Error(`Project ${projectId} has invalid metadata`);
  }
  return value;
};

const writeProject = async (
  storage: StorageClient,
  project: MobileProject,
): Promise<void> => {
  await storage.writeFile(
    metadataPath(project.id),
    encoder.encode(JSON.stringify(project)),
  );
};

const compareByUpdatedAt = (
  left: MobileProject,
  right: MobileProject,
): number => right.updatedAt.localeCompare(left.updatedAt);

type ProjectStore = {
  create: (file: File) => Promise<MobileProject>;
  addCue: (
    project: MobileProject,
    cue: Omit<MobileProjectCue, 'id'>,
  ) => Promise<MobileProject>;
  addRecording: (
    project: MobileProject,
    recording: Blob,
  ) => Promise<MobileProject>;
  get: (projectId: string) => Promise<MobileProject | undefined>;
  list: () => Promise<MobileProject[]>;
  removeCue: (
    project: MobileProject,
    cue: MobileProjectCue,
  ) => Promise<MobileProject>;
  removeRecording: (
    project: MobileProject,
    recording: MobileProjectRecording,
  ) => Promise<MobileProject>;
  saveAnalysis: (
    project: MobileProject,
    analysis: TrackAnalysis,
  ) => Promise<MobileProject>;
  saveStems: (
    project: MobileProject,
    stems: MobileProjectStem[],
  ) => Promise<MobileProject>;
  saveProcessing: (
    project: MobileProject,
    processing: MobileProjectProcessing,
  ) => Promise<MobileProject>;
  saveTranscript: (
    project: MobileProject,
    transcript: PayloadSegment[],
  ) => Promise<MobileProject>;
  rename: (project: MobileProject, name: string) => Promise<MobileProject>;
  remove: (project: MobileProject) => Promise<void>;
};

export const createProjectStore = (storage: StorageClient): ProjectStore => ({
  create: async (file) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const project: MobileProject = {
      id,
      name: file.name.replace(/\.[^.]+$/u, '') || 'Untitled track',
      sourcePath: `${projectPath(id)}/${sourceName}`,
      sourceFilename: file.name,
      sourceContentType: file.type,
      sourceSize: file.size,
      createdAt: now,
      updatedAt: now,
      cues: [],
      recordings: [],
      stems: [],
    };
    try {
      await storage.writeFile(project.sourcePath, await file.arrayBuffer());
      await writeProject(storage, project);
      return project;
    } catch (cause) {
      await storage.deleteFile(projectPath(id));
      throw cause;
    }
  },
  addCue: async (project, cue) => {
    const text = cue.text.trim();
    if (!text) {
      throw new Error('A cue needs text');
    }
    const updated = updateProject(project, {
      cues: [
        ...(project.cues ?? []),
        { ...cue, id: crypto.randomUUID(), text },
      ],
    });
    await writeProject(storage, updated);
    return updated;
  },
  addRecording: async (project, recording) => {
    const id = crypto.randomUUID();
    const extension = recordingExtension(recording.type);
    const path = `${recordingsPath(project.id)}/${id}.${extension}`;
    const entry: MobileProjectRecording = {
      id,
      path,
      filename: `Vocal take ${new Date().toLocaleString()}.${extension}`,
      contentType: recording.type || `audio/${extension}`,
      size: recording.size,
      createdAt: new Date().toISOString(),
    };
    await storage.writeFile(path, await recording.arrayBuffer());
    try {
      const updated = updateProject(project, {
        recordings: [...(project.recordings ?? []), entry],
      });
      await writeProject(storage, updated);
      return updated;
    } catch (cause) {
      await storage.deleteFile(path);
      throw cause;
    }
  },
  get: async (projectId) => await readProject(storage, projectId),
  list: async () => {
    const entries = await storage.listDirectory(projectsPath);
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.directory)
        .map(async (entry) => await readProject(storage, entry.name)),
    );
    return projects
      .filter((project): project is MobileProject => project !== undefined)
      .sort(compareByUpdatedAt);
  },
  saveAnalysis: async (project, analysis) => {
    const updated = updateProject(project, {
      analysis,
    });
    await writeProject(storage, updated);
    return updated;
  },
  saveStems: async (project, stems) => {
    const updated = updateProject(project, { stems });
    await writeProject(storage, updated);
    return updated;
  },
  saveProcessing: async (project, processing) => {
    const updated = updateProject(project, { processing });
    await writeProject(storage, updated);
    return updated;
  },
  saveTranscript: async (project, transcript) => {
    const updated = updateProject(project, { transcript });
    await writeProject(storage, updated);
    return updated;
  },
  removeCue: async (project, cue) => {
    const updated = updateProject(project, {
      cues: (project.cues ?? []).filter((item) => item.id !== cue.id),
    });
    await writeProject(storage, updated);
    return updated;
  },
  removeRecording: async (project, recording) => {
    const updated = updateProject(project, {
      recordings: (project.recordings ?? []).filter(
        (item) => item.id !== recording.id,
      ),
    });
    await writeProject(storage, updated);
    await storage.deleteFile(recording.path);
    return updated;
  },
  rename: async (project, name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('A project needs a name');
    }
    const updated = updateProject(project, { name: trimmed });
    await writeProject(storage, updated);
    return updated;
  },
  remove: async (project) => {
    await storage.deleteFile(projectPath(project.id));
  },
});
