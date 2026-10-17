import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import {
  Alert,
  Button,
  IconButton,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  Typography,
} from '@mui/material';
import { api } from '@musetric/api';
import { getActiveRecording } from '@musetric/engine';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import { getMixdownLabel } from './mixdownLabel.js';
import { MixdownTiles } from './MixdownTiles.js';
import { saveMixdown } from './saveMixdown.js';

type FormatName = api.mixdown.Format['format'];

const formatNames: FormatName[] = ['flac', 'mp3', 'm4a', 'wav'];
const formatLabels: Record<FormatName, string> = {
  flac: 'FLAC',
  mp3: 'MP3',
  m4a: 'M4A',
  wav: 'WAV',
};
const bitrates: api.mixdown.Bitrate[] = [128, 192, 256];
const bitDepths: api.mixdown.BitDepth[] = [16, 24];

export type MixdownContentProps = {
  sideAnchor?: HTMLElement;
};

export const MixdownContent: FC<MixdownContentProps> = (props) => {
  const { sideAnchor } = props;
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const setOpen = useProjectStore((state) => state.setMixdownOpen);
  const trackVolumes = useEngineStore((state) => state.trackVolumes);
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );
  const tempoRatio = useEngineStore((state) => state.tempoRatio);
  const activeRecording = useEngineStore(getActiveRecording);
  const project = useQuery(endpoints.project.get(projectId));
  const [formatName, setFormatName] = useState<FormatName>('flac');
  const [bitrate, setBitrate] = useState<api.mixdown.Bitrate>(256);
  const [bitDepth, setBitDepth] = useState<api.mixdown.BitDepth>(24);
  const mixdown = useMutation(endpoints.mixdown.create(projectId));
  const lossy = formatName === 'm4a' || formatName === 'mp3';

  const label = getMixdownLabel(
    {
      recording:
        activeRecording && !activeRecording.empty
          ? { name: activeRecording.name, volume: trackVolumes.recording }
          : undefined,
      lead: {
        name: t('pages.project.waveform.stemType.lead'),
        volume: trackVolumes.lead,
      },
      backing: {
        name: t('pages.project.waveform.stemType.backing'),
        volume: trackVolumes.backing,
      },
      instrumental: {
        name: t('pages.project.waveform.stemType.instrumental'),
        volume: trackVolumes.instrumental,
      },
      transposeSemitones,
      tempoRatio,
    },
    t,
  );

  return (
    <Stack sx={{ gap: 5 }}>
      <Stack
        direction='row'
        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Typography variant='h6' component='h2'>
          {t('pages.project.mixdown.title')}
        </Typography>
        <IconButton
          aria-label={t('pages.project.mixdown.close')}
          sx={{ my: -2, mr: -2 }}
          onClick={() => {
            setOpen(false);
          }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </Stack>
      <MixdownTiles sideAnchor={sideAnchor} disabled={mixdown.isPending} />
      <Stack sx={{ gap: 1.5 }}>
        <Stack
          direction='row'
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography variant='subtitle2'>
            {t('pages.project.mixdown.format')}
          </Typography>
          {lossy ? (
            <Select
              variant='standard'
              disableUnderline
              value={bitrate}
              disabled={mixdown.isPending}
              inputProps={{ 'aria-label': t('pages.project.mixdown.quality') }}
              onChange={(event) => {
                const value = bitrates.find(
                  (item) => item === event.target.value,
                );
                if (value) {
                  setBitrate(value);
                }
              }}
              sx={{ fontSize: 13, color: 'text.secondary' }}
            >
              {bitrates.map((value) => (
                <MenuItem key={value} value={value}>
                  {t('pages.project.mixdown.bitrate', { value })}
                </MenuItem>
              ))}
            </Select>
          ) : (
            <Select
              variant='standard'
              disableUnderline
              value={bitDepth}
              disabled={mixdown.isPending}
              inputProps={{ 'aria-label': t('pages.project.mixdown.quality') }}
              onChange={(event) => {
                const value = bitDepths.find(
                  (item) => item === event.target.value,
                );
                if (value) {
                  setBitDepth(value);
                }
              }}
              sx={{ fontSize: 13, color: 'text.secondary' }}
            >
              {bitDepths.map((value) => (
                <MenuItem key={value} value={value}>
                  {t('pages.project.mixdown.bitDepth', { value })}
                </MenuItem>
              ))}
            </Select>
          )}
        </Stack>
        <Stack
          direction='row'
          role='group'
          aria-label={t('pages.project.mixdown.format')}
          sx={{ gap: 1, p: 1, borderRadius: '10px', bgcolor: 'action.hover' }}
        >
          {formatNames.map((name) => (
            <ToggleButton
              key={name}
              value={name}
              selected={name === formatName}
              disabled={mixdown.isPending}
              onClick={() => {
                setFormatName(name);
              }}
              sx={{
                flex: 1,
                height: 36,
                border: 0,
                borderRadius: 2,
                fontSize: 14,
                '&.Mui-selected': { fontWeight: 700 },
                '@media (any-pointer: coarse)': { height: 44 },
              }}
            >
              {formatLabels[name]}
            </ToggleButton>
          ))}
        </Stack>
      </Stack>
      {mixdown.isError && (
        <Alert severity='error'>{t('pages.project.mixdown.failed')}</Alert>
      )}
      <Stack
        direction={{ xs: 'column-reverse', sm: 'row' }}
        sx={{
          alignItems: { xs: 'stretch', sm: 'center' },
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Typography
          variant='caption'
          noWrap
          sx={{
            color: 'text.secondary',
            textAlign: { xs: 'center', sm: 'left' },
          }}
        >
          {label === undefined
            ? t('pages.project.mixdown.silent')
            : t('pages.project.mixdown.fileName', {
                name: project.data?.name ?? '',
                label,
                extension: formatName,
              })}
        </Typography>
        <Button
          variant='contained'
          startIcon={<DownloadRoundedIcon />}
          loading={mixdown.isPending}
          disabled={label === undefined}
          sx={{ flexShrink: 0, '@media (any-pointer: coarse)': { height: 48 } }}
          onClick={() => {
            if (label === undefined) {
              return;
            }
            const state = engine.store.get();
            const voiceShifted = state.singerVoice === 'shifted';
            mixdown.mutate(
              {
                request: {
                  format: lossy
                    ? { format: formatName, bitrate }
                    : { format: formatName, bitDepth },
                  volumes: state.trackVolumes,
                  playback: {
                    tempoRatio: state.tempoRatio,
                    transposeSemitones: state.transposeSemitones,
                    leadOctave: voiceShifted ? state.voiceOctave : 0,
                  },
                  label,
                },
                renderRecording: async () =>
                  engine.player.exportRecording({
                    tempoRatio: state.tempoRatio,
                    transposeSemitones: state.transposeSemitones,
                    voiceOctave: state.voiceOctave,
                    voiceShifted,
                  }),
              },
              {
                onSuccess: (created) => {
                  void saveMixdown(
                    api.mixdown.content.base.endpoint({
                      mixdownId: created.mixdownId,
                    }),
                  ).catch((error: unknown) => {
                    console.error('Failed to save the mixdown', error);
                  });
                  setOpen(false);
                },
              },
            );
          }}
        >
          {t('pages.project.mixdown.download')}
        </Button>
      </Stack>
    </Stack>
  );
};
