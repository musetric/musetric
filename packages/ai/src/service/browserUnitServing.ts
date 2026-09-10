import { fetchOk } from './browserShared.js';
import { type UnitEvent } from './jobProtocol.js';

export type UnitServing = {
  attemptId: string;
  attemptUrl: string;
  outputs: string[];
  run: (input: Uint8Array, unit: number) => Promise<Uint8Array>;
};

const putOutput = async (
  serving: UnitServing,
  unit: number,
  output: string,
  body: Uint8Array,
): Promise<void> => {
  const response = await fetch(
    `${serving.attemptUrl}/unit/${String(unit)}/${output}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/octet-stream' },
      body: Uint8Array.from(body),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to upload ${output} of unit ${String(unit)}: HTTP ${String(response.status)}`,
    );
  }
};

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetchOk(url, 'the unit window');
  return new Uint8Array(await response.arrayBuffer());
};

type UnitReceiver = (event: UnitEvent) => Promise<void>;

export type UnitHost = {
  unitOpened: (jobId: string, attemptId: string) => void;
  unitDone: (jobId: string, attemptId: string, unit: number) => void;
};

export type UnitServer = {
  serve: (jobId: string, serving: UnitServing) => Promise<void>;
  dispatch: (event: UnitEvent) => void;
  abandon: (reason: string) => void;
};

export const createUnitServer = (host: UnitHost): UnitServer => {
  const events: UnitEvent[] = [];
  let receiver: UnitReceiver | undefined = undefined;
  let pumping = false;
  let rejectServing: ((reason: Error) => void) | undefined = undefined;

  const pump = async (): Promise<void> => {
    if (pumping) {
      return;
    }
    pumping = true;
    try {
      while (receiver && events.length > 0) {
        const event = events.shift();
        if (event === undefined) {
          break;
        }
        await receiver(event);
      }
    } finally {
      pumping = false;
      if (receiver && events.length > 0) {
        void pump();
      }
    }
  };

  const setReceiver = (next: UnitReceiver | undefined): void => {
    receiver = next;
    if (!next) {
      events.length = 0;
      return;
    }
    void pump();
  };

  return {
    serve: async (jobId, serving) => {
      const closed = Promise.withResolvers<void>();
      setReceiver(async (event) => {
        if (event.attemptId !== serving.attemptId) {
          return;
        }
        if (event.type === 'unitClose') {
          closed.resolve();
          return;
        }
        const input = await fetchBytes(
          `${serving.attemptUrl}/unit/${String(event.unit)}`,
        );
        const produced = await serving.run(input, event.unit);
        for (const output of serving.outputs) {
          await putOutput(serving, event.unit, output, produced);
        }
        host.unitDone(jobId, serving.attemptId, event.unit);
      });
      rejectServing = closed.reject;
      try {
        host.unitOpened(jobId, serving.attemptId);
        await closed.promise;
      } finally {
        rejectServing = undefined;
        setReceiver(undefined);
      }
    },
    dispatch: (event) => {
      events.push(event);
      void pump();
    },
    abandon: (reason) => {
      rejectServing?.(new Error(reason));
    },
  };
};
