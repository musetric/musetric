import { getRealAudioInputDevices } from '@musetric/audio/recording';
import { type NativePort } from './nativeCapture.js';

export type DesktopInput = {
  nativeId: string;
  port: NativePort;
};

export const matchDesktopInputs = (
  ports: NativePort[],
  devices: MediaDeviceInfo[],
): DesktopInput[] => {
  const pageInputs = getRealAudioInputDevices(devices);
  return ports.map((port) => {
    const named = pageInputs.filter((device) => device.label === port.label);
    const twins = ports.filter((other) => other.label === port.label);
    const page =
      port.label !== '' && named.length === 1 && twins.length === 1
        ? named[0]
        : undefined;
    return {
      nativeId: port.id,
      port: page ? { ...port, id: page.deviceId, groupId: page.groupId } : port,
    };
  });
};

export const toNativeInputId = (
  inputs: DesktopInput[],
  pageId: string | undefined,
) => inputs.find((input) => input.port.id === pageId)?.nativeId ?? pageId;

export const toPageInputId = (inputs: DesktopInput[], nativeId: string) =>
  inputs.find((input) => input.nativeId === nativeId)?.port.id ?? nativeId;
