export type OpenedPage = {
  close: () => Promise<void>;
};

export type OpenJobPage = (url: string) => Promise<OpenedPage>;
