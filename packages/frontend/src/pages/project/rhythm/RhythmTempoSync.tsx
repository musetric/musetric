import { useQuery } from '@tanstack/react-query';
import { type FC, useEffect, useRef } from 'react';
import { endpoints } from '../../../api/index.js';
import { engine } from '../../../engine/engine.js';

export type RhythmTempoSyncProps = {
  projectId: number;
};

export const RhythmTempoSync: FC<RhythmTempoSyncProps> = (props) => {
  const { projectId } = props;
  const rhythmQuery = useQuery(endpoints.rhythm.get(projectId));
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (rhythmQuery.status !== 'success') return;
    const detectedBpm = Math.round(rhythmQuery.data.bpm);
    if (detectedBpm <= 0) return;
    appliedRef.current = true;
    const { beats, downbeats } = rhythmQuery.data;
    engine.store.update((state) => {
      const ratio =
        state.sourceTempoBpm > 0 ? state.tempoBpm / state.sourceTempoBpm : 1;
      state.sourceTempoBpm = detectedBpm;
      state.tempoBpm = Math.round(detectedBpm * ratio);
      state.metronomeBeats = beats;
      state.metronomeDownbeats = downbeats;
    });
  }, [rhythmQuery.status, rhythmQuery.data]);

  return undefined;
};
