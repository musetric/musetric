type ThermalBridge = {
  status: () => number;
};

const getThermalBridge = (): ThermalBridge | undefined => {
  const value: unknown = Reflect.get(globalThis, 'MusetricThermal');
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const status: unknown = Reflect.get(value, 'status');
  return typeof status === 'function'
    ? {
        status: () => {
          const result: unknown = Reflect.apply(status, value, []);
          return typeof result === 'number' ? result : 0;
        },
      }
    : undefined;
};

const getThermalStatus = (): number => {
  try {
    const status = getThermalBridge()?.status();
    return typeof status === 'number' ? status : 0;
  } catch {
    return 0;
  }
};

const waitForCooling = async (status: number): Promise<void> => {
  let milliseconds = 5_000;
  if (status >= 3) {
    milliseconds = 15_000;
  } else if (status >= 2) {
    milliseconds = 10_000;
  }
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
};

export type GpuHeadroomOptions = {
  activity: string;
  onProgress: (stage: string, fraction?: number) => void;
};

export const waitForGpuHeadroom = async (
  options: GpuHeadroomOptions,
): Promise<void> => {
  const { activity, onProgress } = options;
  let status = getThermalStatus();
  if (status === 1) {
    onProgress(`Cooling briefly before ${activity} on GPU`);
    await waitForCooling(status);
    return;
  }
  while (status >= 2) {
    onProgress(`Waiting for the phone to cool before ${activity} on GPU`);
    await waitForCooling(status);
    status = getThermalStatus();
  }
};
