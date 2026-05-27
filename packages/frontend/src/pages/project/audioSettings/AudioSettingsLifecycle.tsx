import { type FC, type ReactNode, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { useProjectStore } from '../store.js';

export type AudioSettingsLifecycleProps = {
  children: ReactNode;
};

export const AudioSettingsLifecycle: FC<AudioSettingsLifecycleProps> = (
  props,
) => {
  const open = useProjectStore((state) => state.audioSettingsOpen);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    return engine.calibration.openPreview();
  }, [open]);

  return <>{props.children}</>;
};
