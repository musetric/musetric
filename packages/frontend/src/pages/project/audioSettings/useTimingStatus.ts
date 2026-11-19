import {
  getOutputLatencyFrameCount,
  getRecordingLatencyFrameCount,
  type RecordingLatencySource,
} from '@musetric/engine';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export type TimingStatus = {
  source: RecordingLatencySource;
  text: string;
};

export const useTimingStatus = (): TimingStatus => {
  const { t } = useTranslation();
  const source = useEngineStore((state) => state.latencySource);
  const outputFrameCount = useEngineStore(getOutputLatencyFrameCount);
  const latencyFrameCount = useEngineStore(getRecordingLatencyFrameCount);
  const { sampleRate } = engine.context;
  const texts: Record<RecordingLatencySource, string> = {
    calibrated: t('pages.project.audioSettings.timing.calibrated', {
      seconds: (outputFrameCount / sampleRate).toFixed(2),
    }),
    estimated: t('pages.project.audioSettings.timing.needed'),
    manual: t('pages.project.audioSettings.timing.manual', {
      value: Math.round((latencyFrameCount / sampleRate) * 1000),
    }),
  };
  return { source, text: texts[source] };
};
