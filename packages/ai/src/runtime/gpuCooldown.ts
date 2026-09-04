export const gpuCooldownMs = (
  isAndroid: boolean,
  thermalStatus: number,
): number => {
  if (!isAndroid) {
    return 0;
  }
  if (thermalStatus >= 3) {
    return 10_000;
  }
  if (thermalStatus >= 2) {
    return 3_000;
  }
  return 1_000;
};

const readAndroidUserAgent = (): boolean => {
  const { navigator } = globalThis;
  return (
    typeof navigator === 'object' && navigator.userAgent.includes('Android')
  );
};

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

export const yieldGpuToCompositor = async (): Promise<void> => {
  const cooldownMilliseconds = gpuCooldownMs(
    readAndroidUserAgent(),
    readThermalStatus(),
  );
  if (cooldownMilliseconds === 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, cooldownMilliseconds);
  });
};
