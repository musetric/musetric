import { maxTempoRatio, minTempoRatio } from '@musetric/audio';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { ScaleSlider } from './ScaleSlider.js';

const tenthsPerRatio = 10;
const labelledTempoRatios = [minTempoRatio, 0.5, 1.5, maxTempoRatio];

export const TempoPickerContent: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const recording = useEngineStore((state) => state.recording);
  const tempoRatio = useEngineStore((state) => state.tempoRatio);
  const rhythmQuery = useQuery(endpoints.rhythm.get(projectId));
  const sourceTempoBpm =
    rhythmQuery.status === 'success' && rhythmQuery.data.bpm > 0
      ? rhythmQuery.data.bpm
      : undefined;

  return (
    <ScaleSlider
      title={t('pages.project.player.controls.tempoTitle')}
      value={Math.round(tempoRatio * tenthsPerRatio)}
      min={Math.round(minTempoRatio * tenthsPerRatio)}
      max={Math.round(maxTempoRatio * tenthsPerRatio)}
      original={tenthsPerRatio}
      valueText={tempoRatio.toFixed(1)}
      unit={t('pages.project.player.controls.tempoRatioUnit')}
      info={
        sourceTempoBpm === undefined
          ? undefined
          : t('pages.project.player.controls.tempoValue', {
              value: Math.round(sourceTempoBpm * tempoRatio),
            })
      }
      originalInfo={
        sourceTempoBpm === undefined
          ? undefined
          : t('pages.project.player.controls.tempoValue', {
              value: Math.round(sourceTempoBpm),
            })
      }
      labels={labelledTempoRatios.map((ratio) => ({
        value: Math.round(ratio * tenthsPerRatio),
        label: t('pages.project.player.controls.tempoRatioValue', {
          value: ratio,
        }),
      }))}
      disabled={recording}
      onChange={(tenths) => {
        engine.store.update((state) => {
          state.tempoRatio = tenths / tenthsPerRatio;
        });
      }}
    />
  );
};
