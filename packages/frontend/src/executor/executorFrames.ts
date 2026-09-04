const frameSelector = (id: string): string =>
  `iframe[data-executor-id="${CSS.escape(id)}"]`;

export type OpenExecutorFrameOptions = {
  id: string;
  url: string;
  onOpened: (id: string) => void;
  onFailed: (id: string, message: string) => void;
};

export const openExecutorFrame = (options: OpenExecutorFrameOptions): void => {
  const { id, url, onOpened, onFailed } = options;
  const frame = document.createElement('iframe');
  frame.dataset.executorId = id;
  frame.setAttribute('style', 'position:fixed;width:0;height:0;border:0;');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = 'Musetric executor';
  frame.addEventListener('load', () => {
    onOpened(id);
  });
  frame.addEventListener('error', () => {
    frame.remove();
    onFailed(id, 'the executor page did not load');
  });
  frame.src = url;
  document.body.append(frame);
};

export const closeExecutorFrame = (id: string): void => {
  document.querySelector(frameSelector(id))?.remove();
};
