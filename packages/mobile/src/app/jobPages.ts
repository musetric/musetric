import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const openEvent = 'musetric://open-page';
const closeEvent = 'musetric://close-page';
const reportCommand = 'report_page';

const readMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const report = (page: string, error?: string): void => {
  void invoke(reportCommand, { page, error });
};

const createFrame = (page: string, url: string): HTMLIFrameElement => {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.addEventListener('load', () => {
    report(page);
  });
  frame.addEventListener('error', () => {
    report(page, 'the executor page did not load');
  });
  frame.src = url;
  document.body.append(frame);
  return frame;
};

export const startJobPages = async (): Promise<void> => {
  const frames = new Map<string, HTMLIFrameElement>();
  const open = (asked: string): void => {
    const separator = asked.indexOf(' ');
    const page = asked.slice(0, separator);
    const url = asked.slice(separator + 1);
    try {
      frames.set(page, createFrame(page, url));
    } catch (error) {
      report(page, readMessage(error));
    }
  };
  const close = (page: string): void => {
    const frame = frames.get(page);
    frames.delete(page);
    frame?.remove();
  };
  await listen<string>(openEvent, (event) => {
    open(event.payload);
  });
  await listen<string>(closeEvent, (event) => {
    close(event.payload);
  });
};
