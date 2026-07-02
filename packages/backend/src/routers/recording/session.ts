import { randomUUID } from 'node:crypto';
import { type FileHandle, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { emptyWavePeaksBuffer, generateWavePeaks } from '@musetric/toolkit';
import { assertFound } from '../../common/assertFound.js';
import {
  createReservedWav,
  wavBytesPerSample,
  wavHeaderByteLength,
} from '../../services/recordingWav.js';
import { createPeakPatch, type PeakPatch } from './peakPatch.js';
import { type RecordingRuntime } from './runtime.js';

export const streamPacketHeaderByteLength = 8;
export const maxStreamPacketByteLength = 1024 * 1024;

export type RecordingSession = {
  id: string;
  projectId: number;
  sampleRate: number;
  frameCount: number;
  audioPath: string;
  waveBlobId: string;
  file: FileHandle;
  waveFile: FileHandle;
  writePromise: Promise<void>;
};

type ReservedRecordingBlobs = {
  audioBlobPath: string;
  waveBlobId: string;
  waveBlobPath: string;
  sampleRate: number;
  frameCount: number;
};

type ExistingRecording = {
  blobId: string;
  waveBlobId: string;
  sampleRate: number;
  frameCount: number;
};

const reserveNewRecordingBlobs = async (
  runtime: RecordingRuntime,
  projectId: number,
  sampleRate: number,
  frameCount: number,
): Promise<ReservedRecordingBlobs> => {
  const audioBlob = runtime.app.blobStorage.createPath();
  const waveBlob = runtime.app.blobStorage.createPath();
  await createReservedWav({
    toPath: audioBlob.blobPath,
    sampleRate,
    frameCount,
  });
  await mkdir(dirname(waveBlob.blobPath), { recursive: true });
  await writeFile(waveBlob.blobPath, emptyWavePeaksBuffer);
  await runtime.app.db.recording.create({
    projectId,
    blobId: audioBlob.blobId,
    waveBlobId: waveBlob.blobId,
    sampleRate,
    frameCount,
  });
  return {
    audioBlobPath: audioBlob.blobPath,
    waveBlobId: waveBlob.blobId,
    waveBlobPath: waveBlob.blobPath,
    sampleRate,
    frameCount,
  };
};

const reuseRecordingBlobs = async (
  runtime: RecordingRuntime,
  existing: ExistingRecording,
): Promise<ReservedRecordingBlobs> => {
  const audioBlobPath = runtime.app.blobStorage.getPath(existing.blobId);
  const waveBlobPath = runtime.app.blobStorage.getPath(existing.waveBlobId);
  if (!(await runtime.app.blobStorage.exists(existing.blobId))) {
    await createReservedWav({
      toPath: audioBlobPath,
      sampleRate: existing.sampleRate,
      frameCount: existing.frameCount,
    });
  }
  if (!(await runtime.app.blobStorage.exists(existing.waveBlobId))) {
    await mkdir(dirname(waveBlobPath), { recursive: true });
    await writeFile(waveBlobPath, emptyWavePeaksBuffer);
  }
  return {
    audioBlobPath,
    waveBlobId: existing.waveBlobId,
    waveBlobPath,
    sampleRate: existing.sampleRate,
    frameCount: existing.frameCount,
  };
};

export const createSession = async (
  runtime: RecordingRuntime,
  projectId: number,
  sampleRate: number,
  frameCount: number,
): Promise<RecordingSession> => {
  const project = await runtime.app.db.project.get(projectId);
  assertFound(project, `Project with id ${projectId} not found`);

  const previousSessionId = runtime.projectSessionIds.get(projectId);
  if (previousSessionId && runtime.sessions.has(previousSessionId)) {
    throw new Error('Recording session is already active');
  }

  const existingRecording = await runtime.app.db.recording.get(projectId);
  const blobs = existingRecording
    ? await reuseRecordingBlobs(runtime, existingRecording)
    : await reserveNewRecordingBlobs(
        runtime,
        projectId,
        sampleRate,
        frameCount,
      );

  const session: RecordingSession = {
    id: randomUUID(),
    projectId,
    sampleRate: blobs.sampleRate,
    frameCount: blobs.frameCount,
    audioPath: blobs.audioBlobPath,
    waveBlobId: blobs.waveBlobId,
    file: await open(blobs.audioBlobPath, 'r+'),
    waveFile: await open(blobs.waveBlobPath, 'r+'),
    writePromise: Promise.resolve(),
  };
  runtime.sessions.set(session.id, session);
  runtime.projectSessionIds.set(projectId, session.id);
  return session;
};

export const closeSession = async (
  session: RecordingSession,
): Promise<void> => {
  await session.writePromise;
  await session.file.close();
  await session.waveFile.close();
};

export const finishSession = async (
  runtime: RecordingRuntime,
  session: RecordingSession,
): Promise<void> => {
  await closeSession(session);
  await generateWavePeaks({
    fromPath: session.audioPath,
    toPath: runtime.app.blobStorage.getPath(session.waveBlobId),
    sampleRate: session.sampleRate,
    logger: runtime.logger,
  });
  runtime.sessions.delete(session.id);
  if (runtime.projectSessionIds.get(session.projectId) === session.id) {
    runtime.projectSessionIds.delete(session.projectId);
  }
};

export const writeSessionChunk = async (
  session: RecordingSession,
  frameIndex: number,
  rawSamples: Float32Array,
): Promise<Float32Array<ArrayBuffer> | undefined> => {
  if (frameIndex >= session.frameCount) {
    return undefined;
  }

  const frameLength = Math.min(
    rawSamples.length,
    session.frameCount - frameIndex,
  );
  if (frameLength <= 0) {
    return undefined;
  }

  const samples = new Float32Array(frameLength);
  samples.set(rawSamples.subarray(0, frameLength));
  const chunk = Buffer.alloc(frameLength * wavBytesPerSample);
  for (let index = 0; index < frameLength; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    chunk.writeInt16LE(
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      index * wavBytesPerSample,
    );
  }

  session.writePromise = session.writePromise.then(async () => {
    const startByteOffset = frameIndex * wavBytesPerSample;
    await session.file.write(
      chunk,
      0,
      chunk.byteLength,
      wavHeaderByteLength + startByteOffset,
    );
  });
  await session.writePromise;
  return samples;
};

export const createRecordingChunkPacket = (
  frameIndex: number,
  samples: Float32Array,
): Buffer => {
  const packet = Buffer.allocUnsafe(
    streamPacketHeaderByteLength + samples.byteLength,
  );
  packet.writeUInt32LE(frameIndex, 0);
  packet.writeUInt32LE(samples.length, 4);
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).copy(
    packet,
    streamPacketHeaderByteLength,
  );
  return packet;
};

export const processStreamPacket = async (
  session: RecordingSession,
  packet: Buffer,
): Promise<
  | {
      frameIndex: number;
      chunk: Float32Array<ArrayBuffer>;
      peakPatch: PeakPatch | undefined;
    }
  | undefined
> => {
  if (packet.byteLength < streamPacketHeaderByteLength) {
    throw new Error('Recording packet is missing a header');
  }

  const frameIndex = packet.readUInt32LE(0);
  const frameCount = packet.readUInt32LE(4);
  const byteLength = frameCount * Float32Array.BYTES_PER_ELEMENT;
  if (byteLength > maxStreamPacketByteLength) {
    throw new Error(`Recording packet is too large: ${byteLength}`);
  }

  const packetByteLength = streamPacketHeaderByteLength + byteLength;
  if (packet.byteLength !== packetByteLength) {
    throw new Error('Recording packet has invalid byte length');
  }

  const view = new DataView(
    packet.buffer,
    packet.byteOffset + streamPacketHeaderByteLength,
    byteLength,
  );
  const samples = new Float32Array(frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    samples[index] = view.getFloat32(
      index * Float32Array.BYTES_PER_ELEMENT,
      true,
    );
  }
  const chunk = await writeSessionChunk(session, frameIndex, samples);
  if (!chunk) {
    return undefined;
  }

  const peakPatch = await createPeakPatch(session, frameIndex, chunk.length);
  return { frameIndex, chunk, peakPatch };
};
