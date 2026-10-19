import { Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { type CalibrationTexts } from './calibrationTexts.js';
import { CalibrationVolume } from './CalibrationVolume.js';
import { type CalibrationFailure } from './useCalibrationFlow.js';

export type CalibrationFailureNoteProps = {
  failure: CalibrationFailure;
  texts: CalibrationTexts;
  volume: number | undefined;
  gutter: number;
};

export const CalibrationFailureNote: FC<CalibrationFailureNoteProps> = (
  props,
) => {
  const { failure, texts, volume, gutter } = props;
  const { t } = useTranslation();
  const titles: Record<CalibrationFailure, string> = {
    noisy: t('pages.project.calibration.noisy.title'),
    quiet: t('pages.project.calibration.quiet.title'),
    silent: t('pages.project.calibration.silent.title'),
    failed: t('pages.project.calibration.failed.title'),
  };
  const notes: Record<CalibrationFailure, string> = {
    noisy: t('pages.project.calibration.noisy.text'),
    quiet: texts.quiet,
    silent: texts.silent,
    failed: t('pages.project.calibration.failed.text'),
  };
  return (
    <Stack sx={{ px: gutter, pt: 4, gap: 2.5 }}>
      <Typography variant='subtitle1' sx={{ fontWeight: 500 }}>
        {titles[failure]}
      </Typography>
      <Typography variant='body2' sx={{ color: 'text.secondary' }}>
        {notes[failure]}
      </Typography>
      {volume !== undefined && failure === 'quiet' && (
        <CalibrationVolume volume={volume} />
      )}
    </Stack>
  );
};
