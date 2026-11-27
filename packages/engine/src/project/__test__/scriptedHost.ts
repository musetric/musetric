import { readRecordingPacket } from '../recordingStream.worker.js';
import { type FakeSocket } from './fakeSocket.js';

type HostMessage = {
  type: string;
  sessionId?: string;
};

export const readMessageType = (message: string): string => {
  const event: HostMessage = JSON.parse(message);
  return event.type;
};

export type TakeRun = {
  startFrame: number;
  samples: number[];
};

type HostTake = {
  id: string;
  runs: TakeRun[];
};

export type ScriptedHost = {
  stored: ReadonlyMap<string, TakeRun[]>;
  faults: string[];
  attach: (socket: FakeSocket) => void;
  serve: (count?: number) => void;
  answer: (count?: number) => void;
  idle: () => boolean;
  drop: (expire: boolean) => void;
  refuseNextStart: () => void;
};

export const createScriptedHost = (first: FakeSocket): ScriptedHost => {
  const stored = new Map<string, TakeRun[]>();
  const faults: string[] = [];
  let socket = first;
  let processed = 0;
  let outbox: object[] = [];
  let open: HostTake | undefined = undefined;
  let parked: HostTake | undefined = undefined;
  let refused: string | undefined = undefined;
  let refusals = 0;

  const finished = (sessionId: string) => ({
    type: 'recording.finished',
    sessionId,
  });

  const commit = (take: HostTake) => {
    if (stored.has(take.id)) {
      faults.push(`the take ${take.id} was stored twice`);
    }
    stored.set(take.id, take.runs);
    outbox.push(finished(take.id));
  };

  const commitOpen = () => {
    if (open) {
      commit(open);
      open = undefined;
    }
  };

  const write = (data: ArrayBuffer) => {
    if (refused !== undefined) {
      return;
    }
    if (!open) {
      faults.push('a packet came with no take open');
      return;
    }
    const packet = readRecordingPacket(data);
    const last = open.runs.at(-1);
    const run =
      last && packet.offset > 0 && last.startFrame === packet.startFrame
        ? last
        : { startFrame: packet.startFrame, samples: [] };
    if (run !== last) {
      open.runs.push(run);
    }
    if (packet.offset !== run.samples.length) {
      faults.push(
        `a packet at frame ${packet.offset} of a run that holds ${run.samples.length}`,
      );
    }
    run.samples.splice(packet.offset, packet.samples.length, ...packet.samples);
  };

  const start = (sessionId: string) => {
    commitOpen();
    if (parked) {
      commit(parked);
      parked = undefined;
    }
    if (refusals > 0) {
      refusals -= 1;
      refused = sessionId;
      outbox.push(finished(sessionId));
      return;
    }
    refused = undefined;
    open = { id: sessionId, runs: [] };
    outbox.push({
      type: 'recording.started',
      sessionId,
      recordingId: 1,
      tempo: 1,
      transpose: 0,
      octave: 0,
    });
  };

  const resume = (sessionId: string) => {
    commitOpen();
    if (parked?.id !== sessionId) {
      outbox.push(finished(sessionId));
      return;
    }
    open = parked;
    parked = undefined;
    outbox.push({
      type: 'recording.resumed',
      sessionId,
      recordingId: 1,
      runs: open.runs.map((run) => ({
        startFrame: run.startFrame,
        frameCount: run.samples.length,
      })),
    });
  };

  const finish = () => {
    if (refused !== undefined) {
      outbox.push(finished(refused));
      refused = undefined;
      return;
    }
    commitOpen();
  };

  const handle = (message: string | ArrayBuffer) => {
    if (typeof message !== 'string') {
      write(message);
      return;
    }
    const event: HostMessage = JSON.parse(message);
    const sessionId = event.sessionId ?? '';
    if (event.type === 'recording.start') {
      start(sessionId);
    }
    if (event.type === 'recording.resume') {
      resume(sessionId);
    }
    if (event.type === 'recording.finish') {
      finish();
    }
  };

  return {
    stored,
    faults,
    attach: (next) => {
      socket = next;
      processed = 0;
    },
    serve: (count = Number.POSITIVE_INFINITY) => {
      for (
        let served = 0;
        served < count && processed < socket.sent.length;
        served += 1
      ) {
        handle(socket.sent[processed]);
        processed += 1;
      }
    },
    answer: (count = Number.POSITIVE_INFINITY) => {
      const delivered = outbox.slice(0, count);
      outbox = outbox.slice(delivered.length);
      for (const event of delivered) {
        socket.receive(event);
      }
    },
    idle: () => outbox.length === 0 && processed === socket.sent.length,
    drop: (expire) => {
      outbox = [];
      processed = socket.sent.length;
      if (open && expire) {
        stored.set(open.id, open.runs);
      }
      if (open && !expire) {
        parked = open;
      }
      open = undefined;
      refused = undefined;
      socket.hangUp();
    },
    refuseNextStart: () => {
      refusals += 1;
    },
  };
};
