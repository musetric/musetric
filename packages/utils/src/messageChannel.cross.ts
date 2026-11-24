import {
  createMessagePort,
  type MessagePortLike,
  type PortDispatch,
  type PortMethods,
  type PortTransfers,
  type TypedMessagePort,
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
  inboundSync: <Port extends MessagePortLike>(
    instance: Port,
    dispatch: PortDispatch,
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
    outbound: <Port extends MessagePortLike>(port: Port) =>
      createMessagePort<Port, InboundMethods, OutboundMethods>(
        port,
        outbound.keys,
        outbound.transfers,
      ),
  };
};
