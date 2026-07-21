export type GpuPageProgressHandler = (progress: number) => void | Promise<void>;

export type CreateGpuPageOptions = {
  label: string;
  pageUrl: string;
  apiName: string;
  requireShaderF16: boolean;
  onProgress?: GpuPageProgressHandler;
  onConsole?: (text: string) => void;
  onPageError?: (message: string) => void;
};

export type GpuPage = {
  evaluate: <Result>(request: unknown) => Promise<Result>;
  captureDownloads: (targets: Map<string, string>) => Promise<void>;
  close: () => Promise<void>;
};

export type GpuPageHostFactory = (
  options: CreateGpuPageOptions,
) => Promise<GpuPage>;
