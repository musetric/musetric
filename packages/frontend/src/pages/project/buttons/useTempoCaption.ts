import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type DockCaption } from './dockCaption.js';

export const useTempoCaption = (): DockCaption => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const tempoRatio = useEngineStore((state) => state.tempoRatio);
  const rhythmQuery = useQuery(endpoints.rhythm.get(projectId));
  const bpm =
    rhythmQuery.status === 'success' && rhythmQuery.data.bpm > 0
      ? rhythmQuery.data.bpm
      : undefined;
  const label = t('pages.project.player.controls.tempo');

  if (tempoRatio === 1) {
    return {
      label,
      caption:
        bpm === undefined
          ? t('pages.project.player.controls.tempoTitle')
          : String(Math.round(bpm)),
      changed: false,
    };
  }

  return {
    label,
    caption: t('pages.project.player.controls.tempoRatioValue', {
      value: tempoRatio.toFixed(2),
    }),
    badge: bpm === undefined ? undefined : String(Math.round(bpm * tempoRatio)),
    changed: true,
  };
};
