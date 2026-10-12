import { maxTempoRatio, minTempoRatio } from '@musetric/audio';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { ScaleSlider } from './ScaleSlider.js';

const stepsPerRatio = 20;
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
      value={Math.round(tempoRatio * stepsPerRatio)}
      min={Math.round(minTempoRatio * stepsPerRatio)}
      max={Math.round(maxTempoRatio * stepsPerRatio)}
      original={stepsPerRatio}
      largeTickEvery={stepsPerRatio / 2}
      mediumTickEvery={stepsPerRatio / 4}
      valueText={tempoRatio.toFixed(2)}
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
        value: Math.round(ratio * stepsPerRatio),
        label: t('pages.project.player.controls.tempoRatioValue', {
          value: ratio,
        }),
      }))}
      disabled={recording}
      onChange={(steps) => {
        engine.store.update((state) => {
          state.tempoRatio = steps / stepsPerRatio;
        });
      }}
    />
  );
};
