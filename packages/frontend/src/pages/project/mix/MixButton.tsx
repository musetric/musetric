import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { ControlButton } from '../buttons/ControlButton.js';
import { useProjectStore } from '../store.js';

export const MixButton: FC = () => {
  const { t } = useTranslation();
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const mixChanged = useEngineStore((state) =>
    Object.values(state.trackVolumes).some((volume) => volume !== 1),
  );
  const setMixAnchorEl = useProjectStore((state) => state.setMixAnchorEl);

  return (
    <ControlButton
      icon={<TuneRoundedIcon fontSize='small' />}
      label={t('pages.project.mix.title')}
      active={mixChanged}
      disabled={realtimeFailed}
      onClick={(event) => {
        setMixAnchorEl(event.currentTarget);
      }}
    />
  );
};
