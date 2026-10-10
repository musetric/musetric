import { defaultFrequencyRanges } from '@musetric/engine';
import { voiceViewRanges } from '@musetric/spectrogram';
import { useQuery } from '@tanstack/react-query';
import { type FC, useEffect, useRef } from 'react';
import { endpoints } from '../../../api/index.js';
import { engine } from '../../../engine/engine.js';
import { useSettingsStore } from '../settings/store.js';

export type VoiceRangeSyncProps = {
  projectId: number;
  leadSpectrogramGainDb: number;
};

export const VoiceRangeSync: FC<VoiceRangeSyncProps> = (props) => {
  const { projectId, leadSpectrogramGainDb } = props;
  const voiceRangeQuery = useQuery(endpoints.voiceRange.get(projectId));
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (voiceRangeQuery.status === 'pending') return;
    appliedRef.current = true;
    const { minDecibel, visual } = useSettingsStore.getState();
    const ranges =
      voiceRangeQuery.status === 'success'
        ? voiceViewRanges({
            voiceRange: voiceRangeQuery.data,
            gainDb: leadSpectrogramGainDb,
            minDecibel,
            visual,
            fallback: defaultFrequencyRanges,
          })
        : defaultFrequencyRanges;
    engine.store.update((state) => {
      state.frequencyRanges = ranges;
    });
  }, [voiceRangeQuery.status, voiceRangeQuery.data, leadSpectrogramGainDb]);

  return undefined;
};
