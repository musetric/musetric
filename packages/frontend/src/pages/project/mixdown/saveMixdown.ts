type ShareHandler = {
  postMessage: (message: { url: string }) => Promise<unknown>;
};

type ShareWindow = Window & {
  webkit?: { messageHandlers?: { musetricShare?: ShareHandler } };
};

export const saveMixdown = async (href: string) => {
  const shareWindow: ShareWindow = window;
  const handler = shareWindow.webkit?.messageHandlers?.musetricShare;
  if (handler) {
    await handler.postMessage({
      url: new URL(href, window.location.href).href,
    });
    return;
  }
  const link = document.createElement('a');
  link.href = href;
  link.download = '';
  link.click();
};
