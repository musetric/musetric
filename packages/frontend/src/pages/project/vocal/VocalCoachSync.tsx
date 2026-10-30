import { type FC, useEffect } from 'react';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';

export const VocalCoachSync: FC = () => {
  const enabled = useSettingsStore((state) =>
    Object.values(state.vocalCoach).some(Boolean),
  );

  useEffect(() => {
    engine.store.update((state) => {
      state.vocalCoachEnabled = enabled;
    });
  }, [enabled]);

  useEffect(
    () => () => {
      engine.store.update((state) => {
        state.vocalCoachEnabled = false;
      });
    },
    [],
  );

  return undefined;
};
