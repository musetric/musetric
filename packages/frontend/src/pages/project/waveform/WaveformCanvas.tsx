import { Box } from '@mui/material';
import type { api } from '@musetric/api';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { ViewError } from '../../../components/ViewError.js';
import { ViewPending } from '../../../components/ViewPending.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export type WaveformCanvasProps = {
  stemType: api.wavePeaks.StemType;
};
export const WaveformCanvas: FC<WaveformCanvasProps> = (props) => {
  const { stemType } = props;
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>();
  const status = useEngineStore((state) => state.statuses.waveform[stemType]);

  useEffect(() => {
    if (!canvas) return;
    return engine.waveform.mount({
      projectId,
      stemType,
      canvas,
    });
  }, [canvas, projectId, stemType]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={setCanvas}
        key={`${projectId}-${stemType}`}
        style={{
          height: '100%',
          width: '100%',
          display: 'block',
          visibility: status === 'success' ? 'visible' : 'hidden',
        }}
        onClick={(event) => {
          const { frameCount } = engine.store.get();
          if (!frameCount) {
            return;
          }

          const targetCanvas = event.currentTarget;
          const rect = targetCanvas.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const frameIndex = Math.floor(
            (x / targetCanvas.clientWidth) * frameCount,
          );
          engine.player.seek(frameIndex);
        }}
      />
      {status === 'pending' && (
        <Box position='absolute' top={0} right={0} bottom={0} left={0}>
          <ViewPending />
        </Box>
      )}
      {status === 'error' && (
        <Box position='absolute' top={0} right={0} bottom={0} left={0}>
          <ViewError message={t('pages.project.progress.error.waveform')} />
        </Box>
      )}
    </div>
  );
};
