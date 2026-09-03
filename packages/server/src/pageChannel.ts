import { type ChildProcess } from 'node:child_process';

const openPagePrefix = 'MUSETRIC_PAGE_OPEN=';
const closePagePrefix = 'MUSETRIC_PAGE_CLOSE=';
const pageOpenedPrefix = 'MUSETRIC_PAGE_OPENED=';
const pageFailedPrefix = 'MUSETRIC_PAGE_FAILED=';

const readMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, ' ');
};

export type OpenedGpuPage = {
  close: () => Promise<void>;
};

export type OpenGpuPage = (url: string) => Promise<OpenedGpuPage>;

export type PageChannelOptions = {
  child: ChildProcess;
  openPage?: OpenGpuPage;
  onLog?: (line: string) => void;
};

export type PageChannel = {
  handleLine: (line: string) => boolean;
  closeAll: () => Promise<void>;
};

export const createPageChannel = (options: PageChannelOptions): PageChannel => {
  const pages = new Map<string, Promise<OpenedGpuPage | undefined>>();
  const answer = (line: string): void => {
    options.child.stdin?.write(`${line}\n`);
  };
  const open = (pageId: string, url: string): void => {
    const { openPage } = options;
    if (!openPage) {
      options.onLog?.('the gpu page was refused: this host opens no pages');
      return;
    }
    pages.set(
      pageId,
      openPage(url).then(
        (page) => {
          answer(`${pageOpenedPrefix}${pageId}`);
          return page;
        },
        (error: unknown) => {
          answer(`${pageFailedPrefix}${pageId} ${readMessage(error)}`);
          return undefined;
        },
      ),
    );
  };
  const close = async (pageId: string): Promise<void> => {
    const opening = pages.get(pageId);
    pages.delete(pageId);
    const page = await opening;
    await page?.close();
  };
  const forget = (pageId: string): void => {
    close(pageId).catch((error: unknown) => {
      options.onLog?.(`the gpu page did not close (${readMessage(error)})`);
    });
  };
  return {
    handleLine: (line) => {
      if (line.startsWith(openPagePrefix)) {
        const asked = line.slice(openPagePrefix.length);
        const separator = asked.indexOf(' ');
        open(asked.slice(0, separator), asked.slice(separator + 1));
        return true;
      }
      if (line.startsWith(closePagePrefix)) {
        forget(line.slice(closePagePrefix.length));
        return true;
      }
      return false;
    },
    closeAll: async () => {
      const opened = [...pages.keys()];
      await Promise.all(opened.map(close));
    },
  };
};
