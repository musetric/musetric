const frameId = 'musetricExecutor';

const findFrame = (): HTMLElement | null => document.getElementById(frameId);

export const mountExecutorFrame = (url: string): void => {
  if (findFrame()) {
    return;
  }
  const frame = document.createElement('iframe');
  frame.id = frameId;
  frame.setAttribute('style', 'position:fixed;width:0;height:0;border:0;');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.title = 'Musetric executor';
  frame.src = url;
  document.body.append(frame);
};

export const unmountExecutorFrame = (): void => {
  findFrame()?.remove();
};
