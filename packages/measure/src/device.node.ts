import { execFileSync } from 'node:child_process';
import { z } from 'zod';

const androidPackage = 'com.musetric.client';
const projectPath = /\/project\/(\d+)/;

const targetListSchema = z.array(
  z.object({
    type: z.string(),
    url: z.string(),
    webSocketDebuggerUrl: z.string().optional(),
  }),
);

export type DeviceKind = 'android' | 'chrome' | 'desktop';

export type MeasureDevice = {
  kind: DeviceKind;
  serial?: string;
  port: number;
};

const runAdb = (device: MeasureDevice, args: string[]) =>
  execFileSync(
    'adb',
    device.serial === undefined ? args : ['-s', device.serial, ...args],
    { encoding: 'utf8' },
  ).trim();

const forwardAndroid = (device: MeasureDevice) => {
  const pid = runAdb(device, ['shell', 'pidof', androidPackage]);
  if (pid === '') {
    throw new Error('Musetric is not running on the phone');
  }
  runAdb(device, [
    'forward',
    `tcp:${device.port}`,
    `localabstract:webview_devtools_remote_${pid}`,
  ]);
  return () => {
    runAdb(device, ['forward', '--remove', `tcp:${device.port}`]);
  };
};

export type DevicePage = {
  webSocketUrl: string;
  projectId: number;
  close: () => void;
};

export const openDevicePage = async (
  device: MeasureDevice,
): Promise<DevicePage> => {
  const close =
    device.kind === 'android' ? forwardAndroid(device) : () => undefined;
  const response = await fetch(`http://127.0.0.1:${device.port}/json`);
  const targets = targetListSchema.parse(await response.json());
  const page = targets.find(
    (target) =>
      target.type === 'page' &&
      projectPath.test(target.url) &&
      target.webSocketDebuggerUrl !== undefined,
  );
  if (!page?.webSocketDebuggerUrl) {
    close();
    throw new Error(`Open a project in Musetric on the ${device.kind} first`);
  }
  return {
    webSocketUrl: page.webSocketDebuggerUrl,
    projectId: Number(projectPath.exec(page.url)?.[1]),
    close,
  };
};
