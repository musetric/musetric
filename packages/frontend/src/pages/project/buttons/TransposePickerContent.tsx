import '@ncdai/react-wheel-picker/style.css';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, Stack, Typography } from '@mui/material';
import { maxTransposeSemitones, minTransposeSemitones } from '@musetric/audio';
import {
  WheelPicker,
  type WheelPickerOption,
  WheelPickerWrapper,
} from '@ncdai/react-wheel-picker';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { formatKeyCompact, transposeKeyRoot } from '../key/keyFormat.js';
import { formatTransposeSemitones } from './formatTransposeSemitones.js';

const getTransposeOptions = (
  t: (key: string, options: { value: number | string }) => string,
  sourceKeyRoot: string | undefined,
  sourceKeyMode: 'major' | 'minor' | undefined,
): WheelPickerOption<number>[] =>
  Array.from(
    {
      length: maxTransposeSemitones - minTransposeSemitones + 1,
    },
    (_, index) => {
      const semitones = maxTransposeSemitones - index;
      const semitonesLabel =
        semitones === 0
          ? t('pages.project.player.controls.original', { value: 0 })
          : t('pages.project.player.controls.transposeValue', {
              value: formatTransposeSemitones(semitones),
            });
      const keyLabel =
        sourceKeyRoot !== undefined && sourceKeyMode !== undefined
          ? formatKeyCompact(
              transposeKeyRoot(sourceKeyRoot, semitones),
              sourceKeyMode,
            )
          : undefined;
      const label =
        keyLabel !== undefined ? (
          <Box
            component='span'
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              width: '100%',
              px: 2,
            }}
          >
            <span />
            <span>{keyLabel}</span>
            <Box component='span' sx={{ opacity: 0.6, justifySelf: 'end' }}>
              {semitonesLabel}
            </Box>
          </Box>
        ) : (
          semitonesLabel
        );

      return {
        label,
        textValue: keyLabel ?? semitonesLabel,
        value: semitones,
      };
    },
  );

export const TransposePickerContent: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const recording = useEngineStore((state) => state.recording);
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );
  const keyQuery = useQuery(endpoints.key.get(projectId));
  const sourceKeyRoot =
    keyQuery.status === 'success' ? keyQuery.data.root : undefined;
  const sourceKeyMode =
    keyQuery.status === 'success' ? keyQuery.data.mode : undefined;

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
            options={getTransposeOptions(t, sourceKeyRoot, sourceKeyMode)}
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
