import { maxTempoRatio, minTempoRatio } from '@musetric/audio';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { ScaleSlider } from './ScaleSlider.js';
import { tempoStepsPerRatio } from './tempoSteps.js';

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
      value={Math.round(tempoRatio * tempoStepsPerRatio)}
      min={Math.round(minTempoRatio * tempoStepsPerRatio)}
      max={Math.round(maxTempoRatio * tempoStepsPerRatio)}
      original={tempoStepsPerRatio}
      largeTickEvery={tempoStepsPerRatio / 2}
      mediumTickEvery={tempoStepsPerRatio / 4}
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
        value: Math.round(ratio * tempoStepsPerRatio),
        label: t('pages.project.player.controls.tempoRatioValue', {
          value: ratio,
        }),
      }))}
      disabled={recording}
      onReset={
        tempoRatio === 1
          ? undefined
          : () => {
              engine.store.update((state) => {
                state.tempoRatio = 1;
              });
            }
      }
      onChange={(steps) => {
        engine.store.update((state) => {
          state.tempoRatio = steps / tempoStepsPerRatio;
        });
      }}
    />
  );
};
