import { type api } from '@musetric/api';
import { type MessagePortLike } from '@musetric/utils/cross/messagePort';
import { type LiveTakeChunk } from '../player/protocol.cross.js';
import { recordingStreamChannel } from '../player/recordingStream.cross.js';
import {
  type engineDecoderChannel,
  type TakeRefusal,
} from './protocol.cross.js';
import { type ProjectRealtime } from './realtime.worker.js';
import {
  createRecordingStream,
  type RecordingStream,
} from './recordingStream.worker.js';
import {
  createTakePages,
  type HeldTake,
  type TakePages,
} from './takePages.worker.js';

export type TakeStart = {
  takeId: string;
  recordingId: number;
  sampleRate: number;
  frameCount: number;
  latencyFrameCount: number;
  tempo: number;
  transpose: number;
  octave: number;
  port: MessagePort;
};

export type TakeEvent = Extract<
  api.project.realtime.Event,
  {
    type:
      | 'recording.started'
      | 'recording.resumed'
      | 'recording.finished'
      | 'error';
  }
>;

type TakeLink = 'offline' | 'starting' | 'resuming' | 'ready' | 'closing';

type Take = {
  start: Omit<TakeStart, 'port'>;
  pages: TakePages;
  stream: RecordingStream;
  link: TakeLink;
  sent: boolean;
  accepted: boolean;
  finishing: boolean;
  asked: boolean;
};

export type RecordingController = {
  begin: (start: TakeStart, onChunk: (chunk: LiveTakeChunk) => void) => void;
  holds: (takeId: string) => boolean;
  finish: (takeId: string, sequence: number) => Promise<HeldTake | undefined>;
  connect: () => void;
  disconnect: () => void;
  apply: (event: TakeEvent) => void;
  clear: () => void;
};

export type RecordingControllerOptions = {
  realtime: Pick<ProjectRealtime, 'isOpen' | 'sendJson' | 'sendBinary'>;
  port: ReturnType<typeof engineDecoderChannel.inbound<MessagePortLike>>;
};

export const createRecordingController = (
  options: RecordingControllerOptions,
): RecordingController => {
  const { realtime, port } = options;
  let takes: Take[] = [];

  const sendStart = (take: Take) => {
    const { takeId, ...start } = take.start;
    take.pages.hold([]);
    take.link = 'starting';
    take.sent = true;
    realtime.sendJson({ type: 'recording.start', sessionId: takeId, ...start });
  };

  const link = () => {
    const take = takes.at(0);
    if (!take || take.link !== 'offline' || !realtime.isOpen()) {
      return;
    }
    if (!take.sent) {
      sendStart(take);
      return;
    }
    take.link = 'resuming';
    realtime.sendJson({
      type: 'recording.resume',
      sessionId: take.start.takeId,
    });
  };

  const pump = () => {
    const take = takes.at(0);
    if (!take || take.link !== 'ready' || !realtime.isOpen()) {
      return;
    }
    for (
      let packet = take.pages.cut(take.finishing);
      packet;
      packet = take.pages.cut(take.finishing)
    ) {
      realtime.sendBinary(packet);
    }
    if (take.finishing) {
      take.link = 'closing';
      take.asked = true;
      realtime.sendJson({ type: 'recording.finish' });
    }
  };

  const drop = (take: Take) => {
    takes = takes.filter((item) => item !== take);
    take.stream.close();
    link();
  };

  const refuse = (take: Take, reason: TakeRefusal) => {
    drop(take);
    port.methods.takeRefused({ takeId: take.start.takeId, reason });
  };

  const accept = (take: Take) => {
    take.link = 'ready';
    take.accepted = true;
    pump();
  };

  const applyFinished = (take: Take) => {
    if (take.link === 'closing' || (take.link === 'resuming' && take.asked)) {
      drop(take);
      return;
    }
    if (take.link === 'resuming' && !take.accepted) {
      sendStart(take);
      return;
    }
    refuse(take, take.link === 'starting' ? 'busy' : 'ended');
  };

  return {
    begin: (start, onChunk) => {
      const { port: streamPort, ...format } = start;
      const pages = createTakePages(start.sampleRate);
      takes.push({
        start: format,
        pages,
        stream: createRecordingStream({
          port: recordingStreamChannel.outbound(streamPort),
          onChunk: (chunk) => {
            onChunk(chunk);
            pages.push(chunk);
            pump();
          },
        }),
        link: 'offline',
        sent: false,
        accepted: false,
        finishing: false,
        asked: false,
      });
      link();
    },
    holds: (takeId) => takes.some((take) => take.start.takeId === takeId),
    finish: async (takeId, sequence) => {
      const take = takes.find((item) => item.start.takeId === takeId);
      if (!take) {
        return undefined;
      }
      await take.stream.waitForFlush(sequence);
      take.stream.close();
      take.finishing = true;
      pump();
      const { pages, start } = take;
      return {
        takeId,
        tempo: start.tempo,
        transpose: start.transpose,
        octave: start.octave,
        runs: pages.runs(),
        read: pages.read,
      };
    },
    connect: link,
    disconnect: () => {
      for (const take of takes) {
        take.link = 'offline';
      }
    },
    apply: (event) => {
      const take = takes.at(0);
      if (!take) {
        return;
      }
      if (event.type === 'error') {
        if (take.link === 'starting') {
          refuse(take, 'failed');
        }
        return;
      }
      if (event.sessionId !== take.start.takeId) {
        return;
      }
      if (event.type === 'recording.started' && take.link === 'starting') {
        accept(take);
        return;
      }
      if (event.type === 'recording.resumed' && take.link === 'resuming') {
        take.pages.hold(event.runs);
        accept(take);
        return;
      }
      if (event.type === 'recording.finished') {
        applyFinished(take);
      }
    },
    clear: () => {
      for (const take of takes) {
        take.stream.close();
      }
      takes = [];
    },
  };
};
