import { expect, it } from 'vitest';
import { createControlledPromise } from '../controlledPromise.js';
import { createMessageChannel } from '../messageChannel.cross.js';
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
