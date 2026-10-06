import { Box } from '@mui/material';
import { extractSpectrogramConfig } from '@musetric/spectrogram';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewError } from '../../../components/ViewError.js';
import { ViewPending } from '../../../components/ViewPending.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useSettingsStore } from '../settings/store.js';

export const SpectrogramCanvas: FC = () => {
  const { t } = useTranslation();
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>();
  const decoderStatus = useEngineStore((state) => state.statuses.decoder);
  const spectrogramStatus = useEngineStore(
    (state) => state.statuses.spectrogram,
  );

  useEffect(() => {
    if (!canvas) return;
    return engine.spectrogram.mount(
      canvas,
      extractSpectrogramConfig(useSettingsStore.getState()),
    );
  }, [canvas]);

  if (decoderStatus === 'error' || spectrogramStatus === 'error') {
    return <ViewError message={t('pages.project.progress.error.audioTrack')} />;
  }

  return (
    <Box position='relative' width='100%' height='100%'>
      <Box
        component='canvas'
        ref={setCanvas}
        sx={{ width: '100%', height: '100%', display: 'block' }}
      />
      {decoderStatus === 'pending' && (
        <Box position='absolute' top={0} right={0} bottom={0} left={0}>
          <ViewPending />
        </Box>
      )}
    </Box>
  );
};
