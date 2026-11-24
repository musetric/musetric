import { expect, it } from 'vitest';
import { createControlledPromise } from '../controlledPromise.js';
import {
  createMessageChannel,
  createSyncMessageChannel,
} from '../messageChannel.cross.js';
import { type EmptyPortMethods } from '../messagePort.cross.js';

type BootedMethods = {
  boot: () => void;
  set: (value: string) => void;
};

const channel = createMessageChannel<EmptyPortMethods, BootedMethods>({
  inbound: { keys: [] },
  outbound: { keys: ['boot', 'set'] },
});

const settle = async () => {
  for (let turn = 0; turn < 4; turn += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

it('hands the messages sent during an async boot to the handlers it binds', async () => {
  const { port1, port2 } = new MessageChannel();
  const inbound = channel.inbound(port1);
  const outbound = channel.outbound(port2);
  const booting = createControlledPromise<void>();
  const received: string[] = [];
  inbound.bindBoot(async () => {
    await booting.promise;
    inbound.bindHandlers({
      set: (value) => {
        received.push(value);
      },
    });
  });

  outbound.methods.boot();
  outbound.methods.set('first');
  outbound.methods.set('second');
  await settle();
  booting.resolve();
  await settle();
  port1.close();
  port2.close();

  expect(received).toEqual(['first', 'second']);
});

const syncChannel = createSyncMessageChannel<EmptyPortMethods, BootedMethods>({
  inbound: { keys: [] },
  outbound: { keys: ['boot', 'set'] },
});

it('runs the handlers of a synchronous port inside its dispatch, in order', async () => {
  const { port1, port2 } = new MessageChannel();
  const dispatched: string[] = [];
  const inbound = syncChannel.inboundSync(port1, (handler, payload) => {
    dispatched.push('enter');
    handler(payload);
    dispatched.push('leave');
  });
  const outbound = syncChannel.outbound(port2);
  inbound.bindHandlers({
    set: (value) => {
      dispatched.push(value);
    },
  });

  outbound.methods.set('first');
  outbound.methods.set('second');
  await settle();
  port1.close();
  port2.close();

  expect(dispatched).toEqual([
    'enter',
    'first',
    'leave',
    'enter',
    'second',
    'leave',
  ]);
});

it('refuses an async handler on a synchronous port', () => {
  const { port1, port2 } = new MessageChannel();
  const inbound = syncChannel.inbound(port1);
  inbound.bindHandlers({
    // @ts-expect-error -- a synchronous dispatch cannot wait for a promise
    set: async () => {
      await settle();
    },
  });
  port1.close();
  port2.close();
});
