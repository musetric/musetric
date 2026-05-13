import '@ncdai/react-wheel-picker/style.css';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, Stack, Typography } from '@mui/material';
import { maxTransposeSemitones, minTransposeSemitones } from '@musetric/audio';
import {
  WheelPicker,
  type WheelPickerOption,
  WheelPickerWrapper,
} from '@ncdai/react-wheel-picker';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { formatTransposeSemitones } from './formatTransposeSemitones.js';

const getTransposeOptions = (
  t: (key: string, options: { value: number | string }) => string,
): WheelPickerOption<number>[] =>
  Array.from(
    {
      length: maxTransposeSemitones - minTransposeSemitones + 1,
    },
    (_, index) => {
      const semitones = maxTransposeSemitones - index;

      return {
        label: t('pages.project.player.controls.transposeValue', {
          value: formatTransposeSemitones(semitones),
        }),
        value: semitones,
      };
    },
  );

export const TransposePickerContent: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );

  return (
    <Stack gap={2}>
      <Typography variant='h6' textAlign='center'>
        {t('pages.project.player.controls.transpose')}
      </Typography>
      <Box
        sx={{
          '& [data-rwp-highlight-wrapper]': {
            backgroundColor: 'primary.main',
            borderRadius: 2,
            color: 'primary.contrastText',
            fontWeight: 700,
          },
          '& [data-rwp-highlight-item]': {
            fontSize: '1rem',
            fontWeight: 700,
          },
        }}
      >
        <WheelPickerWrapper>
          <WheelPicker
            value={transposeSemitones}
            options={getTransposeOptions(t)}
            visibleCount={16}
            onValueChange={(semitones) => {
              if (recording) {
                return;
              }
              engine.store.update((state) => {
                state.transposeSemitones = semitones;
              });
            }}
          />
        </WheelPickerWrapper>
      </Box>
      <Button
        size='large'
        variant='outlined'
        startIcon={<RestartAltIcon />}
        disabled={recording || transposeSemitones === 0}
        onClick={() => {
          engine.store.update((state) => {
            state.transposeSemitones = 0;
          });
        }}
      >
        {t('pages.project.player.controls.transposeReset')}
      </Button>
    </Stack>
  );
};
