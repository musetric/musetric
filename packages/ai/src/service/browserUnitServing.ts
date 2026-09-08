import { fetchOk } from './browserShared.js';
import {
  type UnitCloseCommand,
  type UnitCommand,
  unitDoneApiName,
  unitOpenedApiName,
} from './jobProtocol.js';

type UnitReceiver = (event: UnitCommand | UnitCloseCommand) => Promise<void>;

type UnitQueue = {
  receiver: UnitReceiver | undefined;
  events: (UnitCommand | UnitCloseCommand)[];
  pumping: boolean;
};

const unitQueue: UnitQueue = {
  receiver: undefined,
  events: [],
  pumping: false,
};

const pump = async (): Promise<void> => {
  if (unitQueue.pumping) {
    return;
  }
  unitQueue.pumping = true;
  try {
    while (unitQueue.receiver && unitQueue.events.length > 0) {
      const event = unitQueue.events.shift();
      if (event === undefined) {
        break;
      }
      await unitQueue.receiver(event);
    }
  } finally {
    unitQueue.pumping = false;
    if (unitQueue.receiver && unitQueue.events.length > 0) {
      void pump();
    }
  }
};

export const registerUnitReceiver = (next: UnitReceiver | undefined): void => {
  unitQueue.receiver = next;
  if (!next) {
    unitQueue.events.length = 0;
    return;
  }
  void pump();
};

export const dispatchUnitEvent = (
  event: UnitCommand | UnitCloseCommand,
): void => {
  unitQueue.events.push(event);
  void pump();
};

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

const callAttemptApi = async (
  apiName: string,
  args: unknown[],
): Promise<void> => {
  const api: unknown = Reflect.get(globalThis, apiName);
  if (typeof api !== 'function') {
    throw new Error('AI unit API is not initialized');
  }
  await Reflect.apply(api, undefined, args);
};

const announceOpened = async (attemptId: string): Promise<void> =>
  callAttemptApi(unitOpenedApiName, [attemptId]);

const confirmUnit = async (attemptId: string, unit: number): Promise<void> =>
  callAttemptApi(unitDoneApiName, [attemptId, unit]);

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  const response = await fetchOk(url, 'the unit window');
  return new Uint8Array(await response.arrayBuffer());
};

export const serveUnits = async (serving: UnitServing): Promise<void> => {
  const closed = Promise.withResolvers<void>();
  const receive = async (
    event: UnitCommand | UnitCloseCommand,
  ): Promise<void> => {
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
    await confirmUnit(serving.attemptId, event.unit);
  };
  registerUnitReceiver(receive);
  try {
    await announceOpened(serving.attemptId);
    await closed.promise;
  } finally {
    registerUnitReceiver(undefined);
  }
};
