declare const MusetricThermal: { status: () => number } | undefined;

const throttledThermalStatus = 2;
const criticalThermalStatus = 3;
const maxThermalWaits = 60;

export const gpuCooldownMs = (thermalStatus: number): number =>
  thermalStatus >= throttledThermalStatus ? 1_000 : 0;

const readThermalStatus = (): number =>
  typeof MusetricThermal === 'undefined' ? 0 : MusetricThermal.status();

const wait = async (milliseconds: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export const yieldGpuToCompositor = async (): Promise<void> => {
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
