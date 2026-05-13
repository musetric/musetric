import '@ncdai/react-wheel-picker/style.css';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, Stack, Typography } from '@mui/material';
import { getMaxTempoBpm, getMinTempoBpm } from '@musetric/audio';
import {
  WheelPicker,
  type WheelPickerOption,
  WheelPickerWrapper,
} from '@ncdai/react-wheel-picker';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';

const getTempoOptions = (
  sourceTempoBpm: number,
  t: (key: string, options: { value: number }) => string,
) => {
  const maxTempoBpm = getMaxTempoBpm(sourceTempoBpm);
  const minTempoBpm = getMinTempoBpm(sourceTempoBpm);

  return Array.from(
    { length: maxTempoBpm - minTempoBpm + 1 },
    (_, index): WheelPickerOption<number> => {
      const value = maxTempoBpm - index;

      return {
        value,
        label: t('pages.project.player.controls.tempoValue', {
          value,
        }),
      };
    },
  );
};

export const TempoPickerContent: FC = () => {
  const { t } = useTranslation();
  const recording = useEngineStore((state) => state.recording);
  const sourceTempoBpm = useEngineStore((state) => state.sourceTempoBpm);
  const tempoBpm = useEngineStore((state) => state.tempoBpm);

  return (
    <Stack gap={2}>
      <Typography variant='h6' textAlign='center'>
        {t('pages.project.player.controls.tempo')}
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
            value={tempoBpm}
            options={getTempoOptions(sourceTempoBpm, t)}
            visibleCount={16}
            onValueChange={(nextTempoBpm) => {
              if (recording) {
                return;
              }
              engine.store.update((state) => {
                state.tempoBpm = nextTempoBpm;
              });
            }}
          />
        </WheelPickerWrapper>
      </Box>
      <Button
        size='large'
        variant='outlined'
        startIcon={<RestartAltIcon />}
        disabled={recording || tempoBpm === sourceTempoBpm}
        onClick={() => {
          engine.store.update((state) => {
            state.tempoBpm = sourceTempoBpm;
          });
        }}
      >
        {t('pages.project.player.controls.tempoReset')}
      </Button>
    </Stack>
  );
};
