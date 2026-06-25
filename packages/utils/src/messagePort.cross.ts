import { createCallEvery } from './callEvery.js';

export type MessagePortLike = {
  // eslint-disable-next-line musetric/no-type-method-signatures
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<unknown>) => unknown) | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PortMethods = Record<string, (message: any) => unknown>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type EmptyPortMethods = {};

type PortMessage<Methods extends PortMethods> = {
  [Type in keyof Methods]: {
    type: Type;
    payload: Parameters<Methods[Type]>[0];
  };
}[keyof Methods];

export type PortTransfers<Methods extends PortMethods> = Partial<{
  [Type in keyof Methods]: (
    payload: Parameters<Methods[Type]>[0],
  ) => Transferable[];
}>;

const createMethods = <Methods extends PortMethods>(
  instance: MessagePortLike,
  methodKeys: readonly (keyof Methods)[],
  transfers: PortTransfers<Methods>,
): Methods => {
  const methods: Partial<Record<keyof Methods, unknown>> = {};

  for (const type of methodKeys) {
    methods[type] = (...args: Parameters<Methods[typeof type]>) => {
      const [payload] = args;
      const transfer = transfers[type]?.(payload);
      instance.postMessage({ type, payload }, transfer);
    };
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return methods as Methods;
};

const bindHandlers = <Handlers extends PortMethods>(
  instance: MessagePortLike,
  handlers: Handlers,
) => {
  const onmessage = async (event: MessageEvent<PortMessage<Handlers>>) => {
    const message = event.data;
    const handler = handlers[message.type];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!handler) {
      console.error('Unhandled port method', message);
      return;
    }
    const { payload } = message;
    await handler(payload);
  };
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  instance.onmessage = createCallEvery(
    onmessage,
  ) as MessagePortLike['onmessage'];
};

export type TypedMessagePort<
  Port extends MessagePortLike,
  Handlers extends PortMethods,
  Methods extends PortMethods,
> = {
  instance: Port;
  methods: Methods;
  bindBoot: (boot: Handlers['boot']) => void;
  bindHandlers: (handlers: Omit<Handlers, 'boot'>) => void;
};

export const createMessagePort = <
  Port extends MessagePortLike,
  Handlers extends PortMethods,
  Methods extends PortMethods,
>(
  instance: Port,
  methodKeys: readonly (keyof Methods)[],
  methodTransfers: PortTransfers<Methods> = {},
): TypedMessagePort<Port, Handlers, Methods> => {
  return {
    instance,
    methods: createMethods(instance, methodKeys, methodTransfers),
    bindBoot: (boot) => bindHandlers(instance, { boot }),
    bindHandlers: (handlers) => bindHandlers(instance, handlers),
  };
};
