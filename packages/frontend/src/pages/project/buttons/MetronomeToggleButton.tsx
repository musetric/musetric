import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { MetronomeIcon } from '../../../icons/MetronomeIcon.js';
import { ControlButton } from './ControlButton.js';

export const MetronomeToggleButton: FC = () => {
  const { t } = useTranslation();
  const metronomeEnabled = useEngineStore((state) => state.metronomeEnabled);

  return (
    <ControlButton
      icon={<MetronomeIcon fontSize='small' />}
      label={t('pages.project.detailsMode.metronome')}
      active={metronomeEnabled}
      onClick={() => {
        engine.store.update((state) => {
          state.metronomeEnabled = !state.metronomeEnabled;
        });
      }}
    />
  );
};
