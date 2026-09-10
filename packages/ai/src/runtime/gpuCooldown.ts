const throttledThermalStatus = 2;
const criticalThermalStatus = 3;
const maxThermalWaits = 60;

export const gpuCooldownMs = (thermalStatus: number): number =>
  thermalStatus >= throttledThermalStatus ? 1_000 : 0;

const readThermalStatus = (): number => {
  const bridge = Reflect.get(globalThis, 'MusetricThermal');
  if (typeof bridge !== 'object' || !bridge) {
    return 0;
  }
  const getStatus = Reflect.get(bridge, 'status');
  if (typeof getStatus !== 'function') {
    return 0;
  }
  const status: unknown = Reflect.apply(getStatus, bridge, []);
  return typeof status === 'number' ? status : 0;
};

const wait = async (milliseconds: number): Promise<void> =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });

export const yieldGpuToCompositor = async (): Promise<void> => {
  if (Reflect.get(globalThis, 'MusetricYieldOff') === true) {
    return;
  }
  for (let waits = 0; waits < maxThermalWaits; waits += 1) {
    const thermalStatus = readThermalStatus();
    const cooldownMilliseconds = gpuCooldownMs(thermalStatus);
    if (cooldownMilliseconds === 0) {
      return;
    }
    await wait(cooldownMilliseconds);
    if (thermalStatus < criticalThermalStatus) {
      return;
    }
  }
};
