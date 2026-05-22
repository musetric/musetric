import { Box } from '@mui/material';
import { extractSpectrogramConfig } from '@musetric/audio';
import { type FC, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewError } from '../../../components/ViewError.js';
import { ViewPending } from '../../../components/ViewPending.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useSettingsStore } from '../settings/store.js';

export const SpectrogramCanvas: FC = () => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const decoderStatus = useEngineStore((state) => state.statuses.decoder);
  const spectrogramStatus = useEngineStore(
    (state) => state.statuses.spectrogram,
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return engine.spectrogram.mount(
      container,
      extractSpectrogramConfig(useSettingsStore.getState()),
    );
  }, []);

  if (decoderStatus === 'error' || spectrogramStatus === 'error') {
    return <ViewError message={t('pages.project.progress.error.audioTrack')} />;
  }

  if (decoderStatus === 'pending') {
    return <ViewPending />;
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Box
        component='canvas'
        sx={{
          display: 'block',
          width: '150%',
          height: '100%',
          willChange: 'transform',
        }}
      />
    </Box>
  );
};
