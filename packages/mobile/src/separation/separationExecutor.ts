const getNativeExecutor = (): 'webgpu' | 'standby' | undefined => {
  const bridge = Reflect.get(globalThis, 'MusetricExecution');
  if (typeof bridge !== 'object' || !bridge) {
    return undefined;
  }
  const select = Reflect.get(bridge, 'separationExecutor');
  if (typeof select !== 'function') {
    return undefined;
  }
  const executor: unknown = Reflect.apply(select, bridge, []);
  return executor === 'webgpu' || executor === 'standby' ? executor : undefined;
};

export const waitForWebGpuExecutor = async (): Promise<void> => {
  let executor = getNativeExecutor();
  while (executor === 'standby') {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 250);
    });
    executor = getNativeExecutor();
  }
};

export const reportSeparationStage = (stage: string): void => {
  const bridge = Reflect.get(globalThis, 'MusetricExecution');
  if (typeof bridge !== 'object' || !bridge) {
    return;
  }
  const report = Reflect.get(bridge, 'reportSeparationStage');
  if (typeof report === 'function') {
    Reflect.apply(report, bridge, ['webgpu', stage]);
  }
};

type GpuFailureTrackingBridge = {
  beginSeparation: (projectId: string) => void;
  finishSeparation: () => void;
};

const getGpuFailureTrackingBridge = (): GpuFailureTrackingBridge | undefined => {
  const bridge = Reflect.get(globalThis, 'MusetricExecution');
  if (typeof bridge !== 'object' || !bridge) {
    return undefined;
  }
  const beginSeparation = Reflect.get(bridge, 'beginSeparation');
  const finishSeparation = Reflect.get(bridge, 'finishSeparation');
  if (
    typeof beginSeparation !== 'function' ||
    typeof finishSeparation !== 'function'
  ) {
    return undefined;
  }
  return {
    beginSeparation: (projectId) =>
      Reflect.apply(beginSeparation, bridge, [projectId]),
    finishSeparation: () => Reflect.apply(finishSeparation, bridge, []),
  };
};

export const runWithGpuFailureTracking = async <Result>(
  projectId: string,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const bridge = getGpuFailureTrackingBridge();
  if (!bridge) {
    return await operation();
  }
  bridge.beginSeparation(projectId);
  try {
    return await operation();
  } finally {
    bridge.finishSeparation();
  }
};
