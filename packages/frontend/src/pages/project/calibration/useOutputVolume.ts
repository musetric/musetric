import { type EngineOutputVolume } from '@musetric/engine';
import { useEffect, useState } from 'react';
import { engine } from '../../../engine/engine.js';

const pollMs = 500;

export type OutputVolumeControl = {
  outputVolume?: EngineOutputVolume;
  setVolume: (volume: number) => void;
};

export const useOutputVolume = (): OutputVolumeControl => {
  const [outputVolume, setOutputVolume] = useState<EngineOutputVolume>();

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const next = await engine.calibration.readOutputVolume();
      if (!cancelled) {
        setOutputVolume(next);
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
  }, []);

  const setVolume = (volume: number) => {
    setOutputVolume((current) => current && { ...current, volume });
    void engine.calibration.writeOutputVolume(volume).then((next) => {
      if (next) {
        setOutputVolume(next);
      }
    });
  };

  return { outputVolume, setVolume };
};
