import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { api } from '@musetric/api';
import { stemTypes } from '@musetric/audio';
import { useMutation } from '@tanstack/react-query';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useProjectStore } from '../store.js';
import { TrackVolumeControl } from '../waveform/TrackVolumeControl.js';

type FormatName = api.mixdown.Format['format'];

const formatNames: FormatName[] = ['m4a', 'mp3', 'flac', 'wav'];
const formatLabels: Record<FormatName, string> = {
  m4a: 'M4A',
  mp3: 'MP3',
  flac: 'FLAC',
  wav: 'WAV',
};
const bitrates: api.mixdown.Bitrate[] = [128, 192, 256];
const bitDepths: api.mixdown.BitDepth[] = [16, 24];

const downloadFile = (href: string) => {
  const link = document.createElement('a');
  link.href = href;
  link.download = '';
  link.click();
};

export const MixdownDialog: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const open = useProjectStore((state) => state.mixdownOpen);
  const setOpen = useProjectStore((state) => state.setMixdownOpen);
  const [formatName, setFormatName] = useState<FormatName>('m4a');
  const [bitrate, setBitrate] = useState<api.mixdown.Bitrate>(256);
  const [bitDepth, setBitDepth] = useState<api.mixdown.BitDepth>(24);
  const mixdown = useMutation(
    endpoints.mixdown.create(projectId, engine.player.exportRecording),
  );

  const close = () => {
    setOpen(false);
    mixdown.reset();
  };

  const readFormat = (): api.mixdown.Format =>
    formatName === 'm4a' || formatName === 'mp3'
      ? { format: formatName, bitrate }
      : { format: formatName, bitDepth };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth='sm'>
      <DialogTitle>{t('pages.project.mixdown.title')}</DialogTitle>
      <DialogContent>
        <Stack gap={3}>
          <Box
            display='grid'
            gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }}
            gridAutoRows='80px'
            gap={1}
          >
            <TrackVolumeControl kind='recording' />
            {stemTypes.map((stemType) => (
              <TrackVolumeControl
                key={stemType}
                kind='delivery'
                stemType={stemType}
              />
            ))}
          </Box>
          <Stack gap={1}>
            <Typography variant='subtitle2'>
              {t('pages.project.mixdown.format')}
            </Typography>
            <ToggleButtonGroup
              exclusive
              size='small'
              color='primary'
              value={formatName}
              onChange={(_, value: FormatName | null) => {
                if (value) {
                  setFormatName(value);
                }
              }}
            >
              {formatNames.map((name) => (
                <ToggleButton key={name} value={name}>
                  {formatLabels[name]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
          <Stack gap={1}>
            <Typography variant='subtitle2'>
              {t('pages.project.mixdown.quality')}
            </Typography>
            {formatName === 'm4a' || formatName === 'mp3' ? (
              <ToggleButtonGroup
                exclusive
                size='small'
                color='primary'
                value={bitrate}
                onChange={(_, value: api.mixdown.Bitrate | null) => {
                  if (value) {
                    setBitrate(value);
                  }
                }}
              >
                {bitrates.map((value) => (
                  <ToggleButton
                    key={value}
                    value={value}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('pages.project.mixdown.bitrate', { value })}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            ) : (
              <ToggleButtonGroup
                exclusive
                size='small'
                color='primary'
                value={bitDepth}
                onChange={(_, value: api.mixdown.BitDepth | null) => {
                  if (value) {
                    setBitDepth(value);
                  }
                }}
              >
                {bitDepths.map((value) => (
                  <ToggleButton key={value} value={value}>
                    {t('pages.project.mixdown.bitDepth', { value })}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}
          </Stack>
          {mixdown.isError && (
            <Alert severity='error'>{t('pages.project.mixdown.failed')}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>{t('pages.project.mixdown.cancel')}</Button>
        <Button
          variant='contained'
          loading={mixdown.isPending}
          onClick={() => {
            const { trackVolumes } = engine.store.get();
            mixdown.mutate(
              { format: readFormat(), volumes: trackVolumes },
              {
                onSuccess: (created) => {
                  downloadFile(
                    api.mixdown.content.base.endpoint({
                      mixdownId: created.mixdownId,
                    }),
                  );
                  close();
                },
              },
            );
          }}
        >
          {t('pages.project.mixdown.download')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
