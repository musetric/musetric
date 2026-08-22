import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { LyricsTextIcon } from '../../../icons/LyricsTextIcon.js';
import { useProjectStore } from '../store.js';
import { ControlButton } from './ControlButton.js';

export const SubtitlesToggleButton: FC = () => {
  const { t } = useTranslation();
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const subtitlesOpen = useProjectStore((state) => state.subtitlesOpen);
  const setSubtitlesOpen = useProjectStore((state) => state.setSubtitlesOpen);

  return (
    <ControlButton
      icon={<LyricsTextIcon fontSize='small' />}
      label={t('pages.project.detailsMode.subtitles')}
      active={subtitlesOpen}
      disabled={realtimeFailed}
      onClick={() => {
        setSubtitlesOpen(!subtitlesOpen);
      }}
    />
  );
};
