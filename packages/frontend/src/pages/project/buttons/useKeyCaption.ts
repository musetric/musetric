import { type VoiceOctave } from '@musetric/engine';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { formatKeyCompact, transposeKeyRoot } from '../key/keyFormat.js';
import { type DockCaption } from './dockCaption.js';
import { formatTransposeSemitones } from './formatTransposeSemitones.js';

export const useKeyCaption = (): DockCaption => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );
  const voiceOctave = useEngineStore((state) => state.voiceOctave);
  const keyQuery = useQuery(endpoints.key.get(projectId));
  const labels: Record<VoiceOctave, string> = {
    [-1]: t('pages.project.player.controls.transposeOctaveDown'),
    0: t('pages.project.player.controls.transpose'),
    1: t('pages.project.player.controls.transposeOctaveUp'),
  };
  const arrows: Record<VoiceOctave, string> = {
    [-1]: t('pages.project.player.controls.voiceOctaveDownArrow'),
    0: '',
    1: t('pages.project.player.controls.voiceOctaveUpArrow'),
  };
  const key =
    keyQuery.status === 'success'
      ? formatKeyCompact(
          transposeKeyRoot(keyQuery.data.root, transposeSemitones),
          keyQuery.data.mode,
        )
      : undefined;

  if (transposeSemitones === 0 && voiceOctave === 0) {
    return {
      label: labels[0],
      caption: key ?? t('pages.project.player.controls.transposeTitle'),
      changed: false,
    };
  }

  const shift =
    transposeSemitones === 0
      ? ''
      : formatTransposeSemitones(transposeSemitones);
  return {
    label: labels[voiceOctave],
    caption: `${shift}${arrows[voiceOctave]}`,
    badge: key,
    changed: true,
  };
};
