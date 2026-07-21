const reportProgressApiName = 'musetricAiReportProgress';
const reportPageErrorApiName = 'musetricAiReportPageError';
const gpuProgressChannel = 'musetric:gpu-progress';
const gpuPageErrorChannel = 'musetric:gpu-page-error';
const electron: typeof import('electron') = require('electron');
const { contextBridge, ipcRenderer } = electron;

contextBridge.exposeInMainWorld(
  reportProgressApiName,
  async (message: unknown) => ipcRenderer.invoke(gpuProgressChannel, message),
);

contextBridge.exposeInMainWorld(reportPageErrorApiName, (message: unknown) => {
  ipcRenderer.send(gpuPageErrorChannel, message);
});

contextBridge.executeInMainWorld({
  func: (apiName: string) => {
    const report: unknown = Reflect.get(globalThis, apiName);
    const addEventListener: unknown = Reflect.get(
      globalThis,
      'addEventListener',
    );
    if (
      typeof report !== 'function' ||
      typeof addEventListener !== 'function'
    ) {
      return;
    }
    const readMessage = (event: unknown): string => {
      if (typeof event !== 'object' || !event) {
        return String(event);
      }
      const error: unknown = Reflect.get(event, 'error');
      if (error instanceof Error) {
        return error.message;
      }
      const reason: unknown = Reflect.get(event, 'reason');
      if (reason instanceof Error) {
        return reason.message;
      }
      const message: unknown = Reflect.get(event, 'message');
      return typeof message === 'string' ? message : String(reason);
    };
    const listen = (name: string): void => {
      Reflect.apply(addEventListener, globalThis, [
        name,
        (event: unknown) => {
          Reflect.apply(report, undefined, [readMessage(event)]);
        },
      ]);
    };
    listen('error');
    listen('unhandledrejection');
  },
  args: [reportPageErrorApiName],
});
