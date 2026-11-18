import { Stack, Typography } from '@mui/material';
import { getOutputLatencyFrameCount } from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

export type CalibrationDoneProps = {
  headphones: boolean;
  outputLabel: string;
  gutter: number;
};

export const CalibrationDone: FC<CalibrationDoneProps> = (props) => {
  const { headphones, outputLabel, gutter } = props;
  const { t } = useTranslation();
  const outputFrameCount = useEngineStore(getOutputLatencyFrameCount);
  const seconds = (outputFrameCount / engine.context.sampleRate).toFixed(2);
  return (
    <Stack sx={{ px: gutter, pt: 4, gap: 2.5 }}>
      <Typography variant='subtitle1' sx={{ fontWeight: 500 }}>
        {t('pages.project.calibration.result.title')}
      </Typography>
      <Typography variant='body2'>
        {headphones
          ? t('pages.project.calibration.result.headphones', { seconds })
          : t('pages.project.calibration.result.output', { seconds })}
      </Typography>
      <Typography variant='caption' sx={{ color: 'text.secondary' }}>
        {t('pages.project.calibration.result.saved', { output: outputLabel })}
      </Typography>
    </Stack>
  );
};
