type PortMessage = { type: string; payload: unknown };

export const isPortMessage = (value: unknown): value is PortMessage =>
  value instanceof Object && 'type' in value;

export type PostHook = (payload: unknown) => void;

export const watchPosts = (port: MessagePort, posted: string[]) => {
  const hooks = new Map<string, PostHook>();
  const post = port.postMessage.bind(port);
  const postWatched = (message: unknown, transfer: Transferable[] = []) => {
    post(message, transfer);
    if (!isPortMessage(message)) {
      return;
    }
    posted.push(message.type);
    const hook = hooks.get(message.type);
    if (hook) {
      hooks.delete(message.type);
      hook(message.payload);
    }
  };
  Object.assign(port, { postMessage: postWatched });
  return (type: string, hook: PostHook) => {
    hooks.set(type, hook);
  };
};
