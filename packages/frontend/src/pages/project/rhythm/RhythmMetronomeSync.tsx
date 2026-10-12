import { useQuery } from '@tanstack/react-query';
import { type FC, useEffect, useRef } from 'react';
import { endpoints } from '../../../api/index.js';
import { engine } from '../../../engine/engine.js';

export type RhythmMetronomeSyncProps = {
  projectId: number;
};

export const RhythmMetronomeSync: FC<RhythmMetronomeSyncProps> = (props) => {
  const { projectId } = props;
  const rhythmQuery = useQuery(endpoints.rhythm.get(projectId));
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (rhythmQuery.status !== 'success') return;
    appliedRef.current = true;
    const { beats, downbeats } = rhythmQuery.data;
    engine.store.update((state) => {
      state.metronomeBeats = beats;
      state.metronomeDownbeats = downbeats;
    });
  }, [rhythmQuery.status, rhythmQuery.data]);

  return undefined;
};
