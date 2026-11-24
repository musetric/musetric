import {
  createMessagePort,
  type MessagePortLike,
  type PortDispatch,
  type PortMethods,
  type PortTransfers,
  type TypedMessagePort,
  type TypedSyncMessagePort,
} from './messagePort.cross.js';

type MessageChannelSide<Methods extends PortMethods> = {
  keys: readonly (keyof Methods)[];
  transfers?: PortTransfers<Methods>;
};

export type CreateMessageChannelOptions<
  InboundMethods extends PortMethods,
  OutboundMethods extends PortMethods,
> = {
  inbound: MessageChannelSide<InboundMethods>;
  outbound: MessageChannelSide<OutboundMethods>;
};

export type TypedMessageChannel<
  InboundMethods extends PortMethods,
  OutboundMethods extends PortMethods,
> = {
  inbound: <Port extends MessagePortLike>(
    instance: Port,
  ) => TypedMessagePort<Port, OutboundMethods, InboundMethods>;
  outbound: <Port extends MessagePortLike>(
    instance: Port,
  ) => TypedMessagePort<Port, InboundMethods, OutboundMethods>;
};

export const createMessageChannel = <
  InboundMethods extends PortMethods,
  OutboundMethods extends PortMethods,
>(
  options: CreateMessageChannelOptions<InboundMethods, OutboundMethods>,
): TypedMessageChannel<InboundMethods, OutboundMethods> => {
  const { inbound, outbound } = options;
  return {
    inbound: <Port extends MessagePortLike>(port: Port) =>
      createMessagePort<Port, OutboundMethods, InboundMethods>(
        port,
        inbound.keys,
        inbound.transfers,
      ),
    outbound: <Port extends MessagePortLike>(port: Port) =>
      createMessagePort<Port, InboundMethods, OutboundMethods>(
        port,
        outbound.keys,
        outbound.transfers,
      ),
  };
};

export type TypedSyncMessageChannel<
  InboundMethods extends PortMethods,
  OutboundMethods extends PortMethods,
> = Omit<TypedMessageChannel<InboundMethods, OutboundMethods>, 'inbound'> & {
  inbound: <Port extends MessagePortLike>(
    instance: Port,
  ) => TypedSyncMessagePort<Port, OutboundMethods, InboundMethods>;
  inboundSync: <Port extends MessagePortLike>(
    instance: Port,
    dispatch: PortDispatch,
  ) => TypedSyncMessagePort<Port, OutboundMethods, InboundMethods>;
  outboundSync: <Port extends MessagePortLike>(
    instance: Port,
    dispatch: PortDispatch,
  ) => TypedSyncMessagePort<Port, InboundMethods, OutboundMethods>;
};

export const createSyncMessageChannel = <
  InboundMethods extends PortMethods,
  OutboundMethods extends PortMethods,
>(
  options: CreateMessageChannelOptions<InboundMethods, OutboundMethods>,
): TypedSyncMessageChannel<InboundMethods, OutboundMethods> => {
  const { inbound, outbound } = options;
  return {
    ...createMessageChannel(options),
    inboundSync: <Port extends MessagePortLike>(
      port: Port,
      dispatch: PortDispatch,
    ) =>
      createMessagePort<Port, OutboundMethods, InboundMethods>(
        port,
        inbound.keys,
        inbound.transfers,
        dispatch,
      ),
    outboundSync: <Port extends MessagePortLike>(
      port: Port,
      dispatch: PortDispatch,
    ) =>
      createMessagePort<Port, InboundMethods, OutboundMethods>(
        port,
        outbound.keys,
        outbound.transfers,
        dispatch,
      ),
  };
};
