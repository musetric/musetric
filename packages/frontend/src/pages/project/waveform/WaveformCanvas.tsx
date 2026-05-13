import { Box } from '@mui/material';
import { type StemType } from '@musetric/audio/es';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { ViewError } from '../../../components/ViewError.js';
import { ViewPending } from '../../../components/ViewPending.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { TrackLabel } from './TrackLabel.js';

export type WaveformCanvasProps =
  | {
      kind: 'delivery';
      stemType: StemType;
    }
  | {
      kind: 'recording';
      stemType?: undefined;
    };
export const WaveformCanvas: FC<WaveformCanvasProps> = (props) => {
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();

  const [canvas, setCanvas] = useState<HTMLCanvasElement>();
  const status = useEngineStore((state) =>
    props.kind === 'recording'
      ? state.statuses.waveform.recording
      : state.statuses.waveform[props.stemType],
  );

  useEffect(() => {
    if (!canvas) return;
    if (props.kind === 'recording') {
      return engine.waveform.mountRecording({
        projectId,
        canvas,
      });
    }
    return engine.waveform.mountDelivery({
      projectId,
      stemType: props.stemType,
      canvas,
    });
  }, [canvas, projectId, props.kind, props.stemType]);

  return (
    <Box position='relative' width='100%' height='100%'>
      <TrackLabel {...props} />
      <Box
        ref={setCanvas}
        component='canvas'
        sx={{
          height: '100%',
          width: '100%',
          display: 'block',
          visibility: status === 'success' ? 'visible' : 'hidden',
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
    </Box>
  );
};
