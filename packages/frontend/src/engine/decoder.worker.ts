import { api } from '@musetric/api';
import {
  createDecoderRuntime,
  type DecoderRuntime,
} from '@musetric/audio/decoder/worker';
import { playerDataChannel } from '@musetric/audio/player';
import { spectrogramDataChannel } from '@musetric/audio/spectrogram';
import {
  getDeliveryAudioContent,
  getRecordingAudioContent,
} from './audioRequest.worker.js';
import {
  type DecoderRecordingMessage,
  engineDecoderChannel,
} from './decoderProtocol.worker.js';

const port = engineDecoderChannel.inbound(self);

type ProjectRealtime = {
  projectId: number;
  socket: WebSocket;
  pendingMessages: (string | ArrayBuffer)[];
  openPromise: Promise<void>;
  closed: boolean;
};

type ControlledRecordingPromise = {
  promise: Promise<void>;
  resolve: () => void;
};

type FlushWaiter = {
  sequence: number;
  resolve: () => void;
};

type RecordingStream = {
  samples: Float32Array<SharedArrayBuffer>;
  metadata: Int32Array<SharedArrayBuffer>;
  port: MessagePort;
  start: ControlledRecordingPromise;
  finish: ControlledRecordingPromise;
  processedFlushSequence: number;
  flushWaiters: FlushWaiter[];
};

type ProjectRealtimeEvent =
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
  | { type: 'recording.started' }
  | { type: 'error'; error: string };

const recordingPacketHeaderByteLength = 8;

let decoderRuntime: DecoderRuntime | undefined = undefined;
let projectRealtime: ProjectRealtime | undefined = undefined;
let recordingStream: RecordingStream | undefined = undefined;
let recordingReady = false;
let playerPort:
  | ReturnType<typeof playerDataChannel.outbound<MessagePort>>
  | undefined = undefined;
let finishInterruptedRecordingStream = (stream: RecordingStream) => {
  stream.finish.resolve();
};

const getErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeLogMessage(message);
};

const sanitizeLogMessage = (message: string) =>
  message.replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ');

const waitWithTimeout = async (
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> =>
  await Promise.race([
    promise.then(() => true),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }).then(() => false),
  ]);

const createControlledRecordingPromise = (): ControlledRecordingPromise => {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise,
  };
};

const createWebSocketUrl = (path: string) => {
  const url = new URL(path, self.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

const decodeBase64Bytes = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const decodeFloat32Base64 = (base64: string): Float32Array<ArrayBuffer> => {
  const bytes = decodeBase64Bytes(base64);
  const samples = new Float32Array(
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  samples.set(new Float32Array(bytes.buffer, bytes.byteOffset, samples.length));
  return samples;
};

const decodeCommittedSamples = (
  base64: string,
): Float32Array<ArrayBuffer>[] => {
  const samples = decodeFloat32Base64(base64);
  const left = new Float32Array(samples.length);
  const right = new Float32Array(samples.length);
  left.set(samples);
  right.set(samples);
  return [left, right];
};

const resolveFlushWaiters = (stream: RecordingStream) => {
  const waiters = stream.flushWaiters;
  stream.flushWaiters = [];
  for (const waiter of waiters) {
    if (stream.processedFlushSequence >= waiter.sequence) {
      waiter.resolve();
      continue;
    }
    stream.flushWaiters.push(waiter);
  }
};

const waitRecordingFlush = async (
  stream: RecordingStream,
  sequence: number,
) => {
  if (stream.processedFlushSequence >= sequence) {
    return;
  }
  await new Promise<void>((resolve) => {
    stream.flushWaiters.push({
      sequence,
      resolve,
    });
  });
};

const closeRecordingStreamPort = () => {
  recordingStream?.port.close();
};

const clearRecordingStream = () => {
  closeRecordingStreamPort();
  recordingStream?.start.resolve();
  recordingStream?.finish.resolve();
  recordingStream = undefined;
  recordingReady = false;
};

const failRecordingStream = (error: unknown) => {
  const errorMessage = getErrorMessage(error);
  console.error('Recording stream failed', sanitizeLogMessage(errorMessage));
  const stream = recordingStream;
  if (stream) {
    finishInterruptedRecordingStream(stream);
  }
  clearRecordingStream();
  port.methods.recordingStreamFailed({
    error: errorMessage,
  });
};

const failProjectRealtime = (error: unknown) => {
  console.error('Project realtime socket failed', error);
  port.methods.setRealtimeState({
    status: 'error',
  });
  if (recordingStream) {
    failRecordingStream(error);
  }
};

const flushPendingPackets = (realtime: ProjectRealtime) => {
  if (realtime.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const deferredMessages: (string | ArrayBuffer)[] = [];
  for (const message of realtime.pendingMessages) {
    if (typeof message !== 'string' && !recordingReady) {
      deferredMessages.push(message);
      continue;
    }
    realtime.socket.send(message);
  }
  realtime.pendingMessages = deferredMessages;
};

const sendRealtimeJson = (message: object) => {
  const realtime = projectRealtime;
  if (!realtime || realtime.closed) {
    return;
  }

  const json = JSON.stringify(message);
  if (realtime.socket.readyState === WebSocket.OPEN) {
    flushPendingPackets(realtime);
    realtime.socket.send(json);
    return;
  }

  realtime.pendingMessages.push(json);
};

const sendRealtimePacket = (packet: ArrayBuffer) => {
  const realtime = projectRealtime;
  if (!realtime || realtime.closed) {
    throw new Error('Project realtime socket is not open');
  }

  if (!recordingReady) {
    realtime.pendingMessages.push(packet);
    return;
  }

  if (realtime.socket.readyState === WebSocket.OPEN) {
    flushPendingPackets(realtime);
    realtime.socket.send(packet);
    return;
  }

  realtime.pendingMessages.push(packet);
};

const closeProjectRealtimeSocket = (realtime: ProjectRealtime) => {
  if (realtime.socket.readyState === WebSocket.CLOSED) {
    return;
  }
  if (realtime.socket.readyState === WebSocket.CLOSING) {
    return;
  }
  if (realtime.socket.readyState === WebSocket.CONNECTING) {
    void realtime.openPromise.finally(() => {
      closeProjectRealtimeSocket(realtime);
    });
    return;
  }
  realtime.socket.close();
};

const handleProjectRealtimeEvent = (event: ProjectRealtimeEvent) => {
  if (event.type === 'recording.chunkCommitted') {
    playerPort?.methods.patchRecordingTrack({
      frameIndex: event.frameIndex,
      channels: decodeCommittedSamples(event.samplesBase64),
    });
    return;
  }

  if (event.type === 'recording.peaksChanged') {
    port.methods.recordingPeaksChanged({
      startPeakIndex: event.startPeakIndex,
      peaks: new Float32Array(event.peaks),
    });
    return;
  }

  if (event.type === 'recording.finished') {
    recordingStream?.start.resolve();
    recordingStream?.finish.resolve();
    recordingReady = false;
    return;
  }

  if (event.type === 'recording.started') {
    recordingReady = true;
    recordingStream?.start.resolve();
    if (projectRealtime) {
      flushPendingPackets(projectRealtime);
    }
    return;
  }

  failRecordingStream(event.error);
};

const closeProjectRealtime = () => {
  const realtime = projectRealtime;
  projectRealtime = undefined;
  clearRecordingStream();
  if (!realtime || realtime.closed) {
    return;
  }

  realtime.closed = true;
  closeProjectRealtimeSocket(realtime);
};

const openProjectRealtime = (message: { projectId: number }) => {
  if (
    projectRealtime &&
    projectRealtime.projectId === message.projectId &&
    !projectRealtime.closed
  ) {
    return;
  }

  closeProjectRealtime();
  const socket = new WebSocket(
    createWebSocketUrl(api.project.realtime.base.endpoint(message)),
  );
  socket.binaryType = 'arraybuffer';

  const realtime: ProjectRealtime = {
    projectId: message.projectId,
    socket,
    pendingMessages: [],
    openPromise: new Promise((resolve, reject) => {
      socket.addEventListener('open', () => {
        port.methods.setRealtimeState({
          status: 'success',
        });
        flushPendingPackets(realtime);
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error('Project realtime WebSocket failed'));
      });
    }),
    closed: false,
  };

  realtime.openPromise.catch(failProjectRealtime);
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    if (typeof event.data !== 'string') {
      return;
    }

    try {
      handleProjectRealtimeEvent(JSON.parse(event.data));
    } catch (error) {
      console.error('Failed to process project realtime event', error);
    }
  });
  socket.addEventListener('close', () => {
    if (projectRealtime === realtime) {
      projectRealtime = undefined;
    }
    if (!realtime.closed) {
      failProjectRealtime(new Error('Project realtime WebSocket closed'));
    }
  });
  projectRealtime = realtime;
};

const readRecordingSamples = (
  stream: RecordingStream,
  message: Extract<DecoderRecordingMessage, { type: 'chunk' }>,
) => {
  const currentBufferFrameIndex = Atomics.load(stream.metadata, 0);
  if (
    currentBufferFrameIndex - message.bufferFrameIndex >
    stream.samples.length
  ) {
    throw new Error('Recording ring buffer overflow');
  }

  const samples = new Float32Array(message.frameCount);
  const firstFrameCount = Math.min(
    message.frameCount,
    stream.samples.length - message.bufferOffset,
  );
  samples.set(
    stream.samples.subarray(
      message.bufferOffset,
      message.bufferOffset + firstFrameCount,
    ),
  );
  if (firstFrameCount < message.frameCount) {
    samples.set(
      stream.samples.subarray(0, message.frameCount - firstFrameCount),
      firstFrameCount,
    );
  }
  return samples;
};

const createRecordingPacket = (frameIndex: number, samples: Float32Array) => {
  const packet = new ArrayBuffer(
    recordingPacketHeaderByteLength + samples.byteLength,
  );
  const view = new DataView(packet);
  view.setUint32(0, frameIndex, true);
  view.setUint32(4, samples.length, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setFloat32(
      recordingPacketHeaderByteLength + index * Float32Array.BYTES_PER_ELEMENT,
      samples[index],
      true,
    );
  }
  return packet;
};

const processRecordingChunk = (
  stream: RecordingStream,
  message: Extract<DecoderRecordingMessage, { type: 'chunk' }>,
) => {
  const samples = readRecordingSamples(stream, message);
  const skippedFrameCount = Math.max(0, -message.frameIndex);
  const frameIndex = Math.max(0, message.frameIndex);
  const alignedSamples = samples.subarray(skippedFrameCount);
  if (alignedSamples.length === 0) {
    return;
  }
  sendRealtimePacket(createRecordingPacket(frameIndex, alignedSamples));
};

const bindRecordingStreamPort = (stream: RecordingStream) => {
  stream.port.onmessage = (event: MessageEvent<DecoderRecordingMessage>) => {
    const message = event.data;
    try {
      if (message.type === 'flush') {
        stream.processedFlushSequence = Math.max(
          stream.processedFlushSequence,
          message.sequence,
        );
        resolveFlushWaiters(stream);
        return;
      }
      processRecordingChunk(stream, message);
    } catch (error) {
      failRecordingStream(error);
    }
  };
  stream.port.start();
};

const startRecordingStream = (message: {
  projectId: number;
  sampleRate: number;
  frameCount: number;
  latencyFrameCount: number;
  samples: Float32Array<SharedArrayBuffer>;
  metadata: Int32Array<SharedArrayBuffer>;
  port: MessagePort;
}) => {
  openProjectRealtime({ projectId: message.projectId });
  clearRecordingStream();
  const stream: RecordingStream = {
    samples: message.samples,
    metadata: message.metadata,
    port: message.port,
    start: createControlledRecordingPromise(),
    finish: createControlledRecordingPromise(),
    processedFlushSequence: 0,
    flushWaiters: [],
  };
  recordingStream = stream;
  recordingReady = false;
  bindRecordingStreamPort(stream);
  sendRealtimeJson({
    type: 'recording.start',
    sampleRate: message.sampleRate,
    frameCount: message.frameCount,
    latencyFrameCount: message.latencyFrameCount,
  });
};

const finishCurrentRecordingStream = async (stream: RecordingStream) => {
  const realtime = projectRealtime;
  if (realtime) {
    await waitWithTimeout(realtime.openPromise, 1000);
    const started = await waitWithTimeout(stream.start.promise, 3000);
    if (!started) {
      throw new Error('Recording stream was not accepted by the backend');
    }
    flushPendingPackets(realtime);
  }
  sendRealtimeJson({
    type: 'recording.finish',
  });
  await waitWithTimeout(stream.finish.promise, 5000);
};

finishInterruptedRecordingStream = (stream) => {
  void finishCurrentRecordingStream(stream).catch((finishError) => {
    console.error('Failed to finish interrupted recording stream', finishError);
  });
};

const finishRecordingStream = (message: { sequence: number }) => {
  const stream = recordingStream;
  if (!stream) {
    port.methods.recordingStreamFinished();
    return;
  }

  void waitRecordingFlush(stream, message.sequence)
    .then(async () => finishCurrentRecordingStream(stream))
    .then(() => {
      if (recordingStream === stream) {
        clearRecordingStream();
      }
      port.methods.recordingStreamFinished();
    })
    .catch(failRecordingStream);
};

const reportError = () => {
  port.methods.setState({
    status: 'error',
  });
};
self.addEventListener('error', reportError);
self.addEventListener('unhandledrejection', reportError);
self.addEventListener('messageerror', reportError);

const bindRuntimeHandlers = () => {
  port.bindHandlers({
    mount: async (message) => {
      try {
        openProjectRealtime({
          projectId: message.projectId,
        });
        const mounted = await decoderRuntime?.mount(message);
        port.methods.mounted({
          frameCount: mounted?.frameCount ?? 0,
        });
      } catch (error) {
        console.error('Failed to load and decode project audio track', error);
        port.methods.setState({
          status: 'error',
        });
      }
    },
    unmount: () => {
      closeProjectRealtime();
      decoderRuntime?.unmount();
      port.methods.unmounted();
    },
    startRecordingStream,
    finishRecordingStream,
  });
};

port.bindBoot((message) => {
  playerPort = playerDataChannel.outbound(message.playerPort);
  decoderRuntime = createDecoderRuntime({
    playerPort,
    spectrogramPort: spectrogramDataChannel.outbound(message.spectrogramPort),
    getDeliveryEncodedBuffer: async (projectId, stemType) => {
      const encodedBuffer = await getDeliveryAudioContent(projectId, stemType);
      return encodedBuffer.buffer;
    },
    getRecordingEncodedBuffer: async (projectId) => {
      const encodedBuffer = await getRecordingAudioContent(projectId);
      return encodedBuffer.buffer;
    },
  });
  bindRuntimeHandlers();
  port.methods.booted();
});
