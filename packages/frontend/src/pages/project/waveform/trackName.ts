import { type StemType } from '@musetric/audio';
import { getActiveRecording } from '@musetric/engine';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type TrackVolumeTarget } from '../mix/trackVolume.js';

const stemNames: Record<StemType, (t: TFunction) => string> = {
  lead: (t) => t('pages.project.waveform.stemType.lead'),
  backing: (t) => t('pages.project.waveform.stemType.backing'),
  instrumental: (t) => t('pages.project.waveform.stemType.instrumental'),
};

export const useTrackName = (target: TrackVolumeTarget): string => {
  const { t } = useTranslation();
  const recordingName = useEngineStore(
    (state) => getActiveRecording(state)?.name,
  );
  return target.kind === 'recording'
    ? (recordingName ?? t('pages.project.waveform.stemType.recording'))
    : stemNames[target.stemType](t);
};
