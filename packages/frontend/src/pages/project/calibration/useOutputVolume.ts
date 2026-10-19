import { useEffect, useState } from 'react';
import { engine } from '../../../engine/engine.js';

const pollMs = 500;

export const useOutputVolume = (active: boolean): number | undefined => {
  const [volume, setVolume] = useState<number>();

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    let cancelled = false;
    const read = async () => {
      const next = await engine.calibration.readOutputVolume();
      if (!cancelled) {
        setVolume(next);
      }
    };
    void read();
    const interval = window.setInterval(() => {
      void read();
    }, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [active]);

  return volume;
};
