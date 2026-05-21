import { randomUUID } from 'node:crypto';
import { type FileHandle, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type WebSocket } from '@fastify/websocket';
import { api } from '@musetric/api';
import { bindLogger, nextNumber } from '@musetric/resource-utils';
import {
  emptyWavePeaksBuffer,
  generateWavePeaks,
  wavePeakCount,
} from '@musetric/toolkit';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { assertFound } from '../common/assertFound.js';
import { envs } from '../common/envs.js';
import {
  createReservedWav,
  wavBytesPerSample,
  wavHeaderByteLength,
} from '../services/recordingWav.js';

type RecordingSession = {
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

type PlayerRuntimeState = {
  masterSocket: WebSocket | undefined;
  active: boolean;
  recording: boolean;
  frozen: boolean;
  frameIndex: number;
  revision: number;
};

type ProjectRealtimeEvent =
  | { type: 'recording.started' }
  | {
      type: 'recording.chunkCommitted';
      frameIndex: number;
      samplesBase64: string;
    }
  | {
      type: 'recording.peaksChanged';
      startPeakIndex: number;
      peaks: number[];
    }
  | { type: 'recording.finished' }
  | { type: 'error'; error: string }
  | { type: 'player.play' }
  | { type: 'player.record' }
  | { type: 'player.stop' }
  | {
      type: 'player.frameIndex';
      frameIndex: number;
      frozen: boolean;
      revision: number;
      source: 'playback' | 'user';
    }
  | { type: 'player.revision'; revision: number }
  | {
      type: 'player.sync.state';
      active: boolean;
      recording: boolean;
      frozen: boolean;
      frameIndex: number;
      revision: number;
    };

const streamPacketHeaderByteLength = 8;
const maxStreamPacketByteLength = 1024 * 1024;

export const recordingRouter: FastifyPluginCallbackZod = (app) => {
  const sessions = new Map<string, RecordingSession>();
  const projectSessionIds = new Map<number, string>();
  const projectRealtimeSockets = new Map<number, Set<WebSocket>>();
  const projectPlayerStates = new Map<number, PlayerRuntimeState>();
  const recordingLogger = bindLogger(app.log, envs.logLevel);

  app.addHook('onRoute', (opts) => {
    if (opts.schema) opts.schema.tags = ['recording'];
  });

  const closeSession = async (session: RecordingSession) => {
    await session.writePromise;
    await session.file.close();
    await session.waveFile.close();
  };

  const finishSession = async (session: RecordingSession) => {
    await closeSession(session);
    await generateWavePeaks({
      fromPath: session.audioPath,
      toPath: app.blobStorage.getPath(session.waveBlobId),
      sampleRate: session.sampleRate,
      logger: recordingLogger,
    });

    sessions.delete(session.id);
    if (projectSessionIds.get(session.projectId) === session.id) {
      projectSessionIds.delete(session.projectId);
    }
  };

  const createSession = async (
    projectId: number,
    sampleRate: number,
    frameCount: number,
  ) => {
    const project = await app.db.project.get(projectId);
    assertFound(project, `Project with id ${projectId} not found`);

    const previousSessionId = projectSessionIds.get(projectId);
    if (previousSessionId && sessions.has(previousSessionId)) {
      throw new Error('Recording session is already active');
    }

    const existingRecording = await app.db.recording.get(projectId);
    if (existingRecording) {
      const audioBlob = {
        blobId: existingRecording.blobId,
        blobPath: app.blobStorage.getPath(existingRecording.blobId),
      };
      const waveBlob = {
        blobId: existingRecording.waveBlobId,
        blobPath: app.blobStorage.getPath(existingRecording.waveBlobId),
      };
      if (!(await app.blobStorage.exists(audioBlob.blobId))) {
        await createReservedWav({
          toPath: audioBlob.blobPath,
          sampleRate: existingRecording.sampleRate,
          frameCount: existingRecording.frameCount,
        });
      }
      if (!(await app.blobStorage.exists(waveBlob.blobId))) {
        await mkdir(dirname(waveBlob.blobPath), { recursive: true });
        await writeFile(waveBlob.blobPath, emptyWavePeaksBuffer);
      }
      const session: RecordingSession = {
        id: randomUUID(),
        projectId,
        sampleRate: existingRecording.sampleRate,
        frameCount: existingRecording.frameCount,
        audioPath: audioBlob.blobPath,
        waveBlobId: waveBlob.blobId,
        file: await open(audioBlob.blobPath, 'r+'),
        waveFile: await open(waveBlob.blobPath, 'r+'),
        writePromise: Promise.resolve(),
      };
      sessions.set(session.id, session);
      projectSessionIds.set(projectId, session.id);
      return session;
    }

    const audioBlob = app.blobStorage.createPath();
    const waveBlob = app.blobStorage.createPath();
    await createReservedWav({
      toPath: audioBlob.blobPath,
      sampleRate,
      frameCount,
    });
    await mkdir(dirname(waveBlob.blobPath), { recursive: true });
    await writeFile(waveBlob.blobPath, emptyWavePeaksBuffer);
    await app.db.recording.create({
      projectId,
      blobId: audioBlob.blobId,
      waveBlobId: waveBlob.blobId,
      sampleRate,
      frameCount,
    });

    const session: RecordingSession = {
      id: randomUUID(),
      projectId,
      sampleRate,
      frameCount,
      audioPath: audioBlob.blobPath,
      waveBlobId: waveBlob.blobId,
      file: await open(audioBlob.blobPath, 'r+'),
      waveFile: await open(waveBlob.blobPath, 'r+'),
      writePromise: Promise.resolve(),
    };
    sessions.set(session.id, session);
    projectSessionIds.set(projectId, session.id);

    return session;
  };

  const writeSessionChunk = async (
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

  const createPeakPatch = async (
    session: RecordingSession,
    frameIndex: number,
    frameLength: number,
  ) => {
    if (!frameLength || !session.frameCount) {
      return undefined;
    }

    const framesPerPeak = Math.max(1, session.frameCount / wavePeakCount);
    const startPeakIndex = Math.max(0, Math.floor(frameIndex / framesPerPeak));
    const endPeakIndex = Math.min(
      wavePeakCount - 1,
      Math.floor((frameIndex + frameLength - 1) / framesPerPeak),
    );
    if (endPeakIndex < startPeakIndex) {
      return undefined;
    }

    const peaks = new Float32Array((endPeakIndex - startPeakIndex + 1) * 2);
    for (
      let peakIndex = startPeakIndex;
      peakIndex <= endPeakIndex;
      peakIndex += 1
    ) {
      const peakStartFrame = Math.floor(peakIndex * framesPerPeak);
      const peakEndFrame = Math.min(
        session.frameCount,
        Math.floor((peakIndex + 1) * framesPerPeak),
      );
      const frameCount = Math.max(0, peakEndFrame - peakStartFrame);
      const buffer = Buffer.alloc(frameCount * wavBytesPerSample);
      await session.file.read(
        buffer,
        0,
        buffer.byteLength,
        wavHeaderByteLength + peakStartFrame * wavBytesPerSample,
      );

      let min = 0;
      let max = 0;
      for (let offset = 0; offset < buffer.byteLength; offset += 2) {
        const value = buffer.readInt16LE(offset) / 32768;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }

      const patchIndex = (peakIndex - startPeakIndex) * 2;
      peaks[patchIndex] = min;
      peaks[patchIndex + 1] = max;
    }

    await session.waveFile.write(
      Buffer.from(peaks.buffer, peaks.byteOffset, peaks.byteLength),
      0,
      peaks.byteLength,
      startPeakIndex * 2 * Float32Array.BYTES_PER_ELEMENT,
    );

    return {
      startPeakIndex,
      peaks,
    };
  };

  const processStreamPacket = async (
    session: RecordingSession,
    packet: Buffer,
  ) => {
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
    return {
      frameIndex,
      chunk,
      peakPatch,
    };
  };

  const toBuffer = (data: unknown): Buffer | undefined => {
    if (Buffer.isBuffer(data)) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data);
    }
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
      return Buffer.concat(data);
    }
    return undefined;
  };

  const isRealtimeMessage = (
    message: unknown,
  ): message is Record<string, unknown> =>
    typeof message === 'object' && Boolean(message);

  const sendRealtimeEvent = (
    socket: WebSocket,
    event: ProjectRealtimeEvent,
  ) => {
    if (socket.readyState !== 1) {
      return;
    }

    socket.send(JSON.stringify(event));
  };

  const broadcastRealtimeEvent = (
    projectId: number,
    event: ProjectRealtimeEvent,
  ) => {
    const sockets = projectRealtimeSockets.get(projectId);
    if (!sockets) {
      return;
    }

    for (const socket of sockets) {
      sendRealtimeEvent(socket, event);
    }
  };

  const broadcastRealtimeEventExcluding = (
    projectId: number,
    event: ProjectRealtimeEvent,
    excludeSocket: WebSocket,
  ) => {
    const sockets = projectRealtimeSockets.get(projectId);
    if (!sockets) {
      return;
    }

    for (const socket of sockets) {
      if (socket !== excludeSocket) {
        sendRealtimeEvent(socket, event);
      }
    }
  };

  const createPlayerState = (): PlayerRuntimeState => ({
    masterSocket: undefined,
    active: false,
    recording: false,
    frozen: false,
    frameIndex: 0,
    revision: 0,
  });

  const getProjectPlayerState = (projectId: number) => {
    const existingState = projectPlayerStates.get(projectId);
    if (existingState) {
      return existingState;
    }

    const state = createPlayerState();
    projectPlayerStates.set(projectId, state);
    return state;
  };

  const sendPlayerSyncState = (
    socket: WebSocket,
    state: PlayerRuntimeState | undefined,
  ) => {
    sendRealtimeEvent(socket, {
      type: 'player.sync.state',
      active: state?.active ?? false,
      recording: state?.recording ?? false,
      frozen: state?.frozen ?? false,
      frameIndex: state?.frameIndex ?? 0,
      revision: state?.revision ?? 0,
    });
  };

  const broadcastPlayerFrameIndex = (
    projectId: number,
    state: PlayerRuntimeState,
    excludeSocket: WebSocket,
    source: 'playback' | 'user',
  ) => {
    broadcastRealtimeEventExcluding(
      projectId,
      {
        type: 'player.frameIndex',
        frameIndex: state.frameIndex,
        frozen: state.frozen,
        revision: state.revision,
        source,
      },
      excludeSocket,
    );
  };

  const claimPlayerMaster = (
    projectId: number,
    socket: WebSocket,
    recording: boolean,
  ) => {
    const state = getProjectPlayerState(projectId);
    if (!state.active) {
      state.masterSocket = socket;
      state.active = true;
      state.recording = recording;
      broadcastRealtimeEventExcluding(
        projectId,
        { type: recording ? 'player.record' : 'player.play' },
        socket,
      );
      return true;
    }

    if (state.masterSocket === socket && state.recording === recording) {
      return true;
    }

    sendPlayerSyncState(socket, state);
    return false;
  };

  const stopProjectPlayer = (projectId: number) => {
    const state = projectPlayerStates.get(projectId);
    if (state) {
      state.masterSocket = undefined;
      state.active = false;
      state.recording = false;
    }
    broadcastRealtimeEvent(projectId, { type: 'player.stop' });
  };

  const finishRealtimeSession = async (
    projectId: number,
    session: RecordingSession | undefined,
  ) => {
    if (!session) {
      return undefined;
    }

    await finishSession(session);
    broadcastRealtimeEvent(projectId, {
      type: 'recording.finished',
    });
    return undefined;
  };

  app.get(
    api.project.realtime.base.path,
    { websocket: true },
    (socket, request) => {
      const { projectId } = api.project.realtime.base.paramsSchema.parse(
        request.params,
      );
      let activeSession: RecordingSession | undefined = undefined;
      let socketClosed = false;
      let sessionAction: Promise<void> = Promise.resolve();
      let ignoringRecordingStream = false;

      const sockets = projectRealtimeSockets.get(projectId) ?? new Set();
      sockets.add(socket);
      projectRealtimeSockets.set(projectId, sockets);

      const closeWithError = (error: unknown, reason: string) => {
        recordingLogger.error({ error }, reason);
        sendRealtimeEvent(socket, {
          type: 'error',
          error: reason,
        });
        socket.close(1011, reason);
      };

      const isSocketClosed = () => socketClosed;

      const enqueueSessionAction = (
        reason: string,
        action: () => Promise<void>,
      ) => {
        const nextAction = sessionAction.then(action);
        sessionAction = nextAction.catch((error) => {
          if (socketClosed) {
            recordingLogger.error({ error }, reason);
            return;
          }
          closeWithError(error, reason);
        });
      };

      void app.db.project.get(projectId).then((project) => {
        if (!project) {
          socket.close(1008, `Project with id ${projectId} not found`);
        }
      });

      socket.on(
        'message',
        (data: ArrayBuffer | Buffer | Buffer[], isBinary: boolean) => {
          if (isBinary) {
            if (ignoringRecordingStream) {
              return;
            }

            const packet = toBuffer(data);
            const session = activeSession;
            if (!packet || !session) {
              socket.close(
                1003,
                'Recording packet must follow recording start',
              );
              return;
            }

            enqueueSessionAction(
              'Failed to write recording packet',
              async () => {
                if (activeSession !== session) {
                  return;
                }
                const result = await processStreamPacket(session, packet);
                if (!result) {
                  return;
                }
                broadcastRealtimeEvent(projectId, {
                  type: 'recording.chunkCommitted',
                  frameIndex: result.frameIndex,
                  samplesBase64: Buffer.from(
                    result.chunk.buffer,
                    result.chunk.byteOffset,
                    result.chunk.byteLength,
                  ).toString('base64'),
                });
                if (result.peakPatch) {
                  broadcastRealtimeEvent(projectId, {
                    type: 'recording.peaksChanged',
                    startPeakIndex: result.peakPatch.startPeakIndex,
                    peaks: Array.from(result.peakPatch.peaks),
                  });
                }
              },
            );
            return;
          }

          let message: unknown = undefined;
          try {
            message = JSON.parse(toBuffer(data)?.toString() ?? '');
          } catch (error) {
            closeWithError(error, 'Invalid project realtime message');
            return;
          }

          if (
            isRealtimeMessage(message) &&
            'type' in message &&
            message.type === 'recording.start'
          ) {
            const sampleRate =
              'sampleRate' in message && typeof message.sampleRate === 'number'
                ? message.sampleRate
                : undefined;
            const frameCount =
              'frameCount' in message && typeof message.frameCount === 'number'
                ? message.frameCount
                : undefined;
            const latencyFrameCount =
              'latencyFrameCount' in message &&
              typeof message.latencyFrameCount === 'number'
                ? message.latencyFrameCount
                : undefined;
            if (
              !sampleRate ||
              !Number.isInteger(sampleRate) ||
              frameCount === undefined ||
              !Number.isInteger(frameCount) ||
              frameCount < 0 ||
              latencyFrameCount === undefined ||
              !Number.isInteger(latencyFrameCount) ||
              latencyFrameCount < 0
            ) {
              socket.close(1008, 'Invalid recording start message');
              return;
            }

            const recordingClaimed = claimPlayerMaster(projectId, socket, true);
            if (!recordingClaimed) {
              ignoringRecordingStream = true;
              sendRealtimeEvent(socket, {
                type: 'recording.finished',
              });
              return;
            }

            enqueueSessionAction(
              'Failed to start recording session',
              async () => {
                await finishRealtimeSession(projectId, activeSession);
                activeSession = undefined;
                if (isSocketClosed()) {
                  return;
                }
                const session = await createSession(
                  projectId,
                  sampleRate,
                  frameCount,
                );
                if (isSocketClosed()) {
                  await finishRealtimeSession(projectId, session);
                  return;
                }
                activeSession = session;
                broadcastRealtimeEvent(projectId, {
                  type: 'recording.started',
                });
              },
            );
            return;
          }

          if (
            isRealtimeMessage(message) &&
            'type' in message &&
            message.type === 'recording.finish'
          ) {
            if (ignoringRecordingStream) {
              ignoringRecordingStream = false;
              sendRealtimeEvent(socket, {
                type: 'recording.finished',
              });
              return;
            }

            enqueueSessionAction(
              'Failed to finish recording session',
              async () => {
                const session = activeSession;
                activeSession = undefined;
                await finishRealtimeSession(projectId, session);
              },
            );
            return;
          }

          if (
            isRealtimeMessage(message) &&
            'type' in message &&
            message.type === 'player.play'
          ) {
            claimPlayerMaster(projectId, socket, false);
            return;
          }

          if (
            isRealtimeMessage(message) &&
            'type' in message &&
            message.type === 'player.record'
          ) {
            claimPlayerMaster(projectId, socket, true);
            return;
          }

          if (
            isRealtimeMessage(message) &&
            'type' in message &&
            message.type === 'player.stop'
          ) {
            stopProjectPlayer(projectId);
            return;
          }

          if (
            isRealtimeMessage(message) &&
            'type' in message &&
            message.type === 'player.frameIndex'
          ) {
            const frameIndex =
              'frameIndex' in message && typeof message.frameIndex === 'number'
                ? message.frameIndex
                : 0;
            const frozen =
              'frozen' in message && typeof message.frozen === 'boolean'
                ? message.frozen
                : false;
            const revision =
              'revision' in message && typeof message.revision === 'number'
                ? message.revision
                : 0;
            const source =
              'source' in message && message.source === 'user'
                ? 'user'
                : 'playback';
            const playerState = getProjectPlayerState(projectId);

            if (source === 'user') {
              playerState.revision = nextNumber(playerState.revision);
              playerState.frameIndex = frameIndex;
              playerState.frozen = frozen;
              sendRealtimeEvent(socket, {
                type: 'player.revision',
                revision: playerState.revision,
              });
              broadcastPlayerFrameIndex(projectId, playerState, socket, 'user');
              return;
            }

            if (!playerState.active || playerState.masterSocket !== socket) {
              sendPlayerSyncState(socket, playerState);
              return;
            }

            if (revision !== playerState.revision) {
              return;
            }

            playerState.frameIndex = frameIndex;
            playerState.frozen = frozen;
            broadcastPlayerFrameIndex(
              projectId,
              playerState,
              socket,
              'playback',
            );
            return;
          }

          if (
            isRealtimeMessage(message) &&
            'type' in message &&
            message.type === 'player.sync.request'
          ) {
            sendPlayerSyncState(socket, projectPlayerStates.get(projectId));
            return;
          }
        },
      );

      socket.on('close', () => {
        socketClosed = true;
        sockets.delete(socket);
        if (!sockets.size) {
          projectRealtimeSockets.delete(projectId);
          projectPlayerStates.delete(projectId);
        }

        const playerState = projectPlayerStates.get(projectId);
        if (playerState && playerState.masterSocket === socket) {
          stopProjectPlayer(projectId);
        }

        enqueueSessionAction(
          'Failed to finish recording session after realtime disconnect',
          async () => {
            const session = activeSession;
            activeSession = undefined;
            await finishRealtimeSession(projectId, session);
          },
        );
      });
    },
  );
};
