import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TempoIcon } from '../../../icons/TempoIcon.js';
import { useProjectStore } from '../store.js';
import { ControlButton } from './ControlButton.js';

export const TempoButton: FC = () => {
  const { t } = useTranslation();
  const frameCount = useEngineStore((state) => state.frameCount);
  const recording = useEngineStore((state) => state.recording);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const sourceTempoBpm = useEngineStore((state) => state.sourceTempoBpm);
  const tempoBpm = useEngineStore((state) => state.tempoBpm);
  const setTempoAnchorEl = useProjectStore((state) => state.setTempoAnchorEl);

  return (
    <ControlButton
      icon={<TempoIcon fontSize='small' />}
      label={t('pages.project.player.controls.tempo')}
      value={t('pages.project.player.controls.tempoValue', {
        value: tempoBpm,
      })}
      active={tempoBpm !== sourceTempoBpm}
      disabled={!frameCount || recording || realtimeFailed}
      onClick={(event) => {
        setTempoAnchorEl(event.currentTarget);
      }}
    />
  );
};
