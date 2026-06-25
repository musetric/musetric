export type MessageHandler<Message, Type> = (
  message: Extract<Message, { type: Type }>,
) => unknown | Promise<unknown>;

export type MessageHandlers<Message extends { type: string }> = {
  [Type in Message['type']]: MessageHandler<Message, Type>;
};

export const createMessageHandler = <Message extends { type: string }>(
  handlers: MessageHandlers<Message>,
) => {
  return async (raw: Message): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const message = raw as Extract<Message, { type: Message['type'] }>;
    const handler = handlers[message.type];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!handler) return false;
    await handler(message);
    return true;
  };
};
