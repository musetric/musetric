const frameId = 'musetricExecutor';

export const mountExecutorFrame = (url: string): void => {
  if (document.getElementById(frameId)) {
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
