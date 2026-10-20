import BluetoothIcon from '@mui/icons-material/Bluetooth';
import CloseIcon from '@mui/icons-material/Close';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import SpeakerIcon from '@mui/icons-material/Speaker';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { alpha, Box, Chip, IconButton, Stack, Typography } from '@mui/material';
import { type AudioOutputSourceKind } from '@musetric/audio/recording';
import { type FC, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

const outputIconByKind: Record<AudioOutputSourceKind, ReactNode> = {
  bluetooth: <BluetoothIcon fontSize='small' />,
  wiredHeadset: <HeadphonesIcon fontSize='small' />,
  builtIn: <SpeakerIcon fontSize='small' />,
  unknown: <VolumeUpIcon fontSize='small' />,
};

export type CalibrationHeaderProps = {
  title: string;
  kind: AudioOutputSourceKind;
  outputLabel: string;
  calibrated: boolean;
  closeDisabled: boolean;
  sheet: boolean;
  onClose: () => void;
};

export const CalibrationHeader: FC<CalibrationHeaderProps> = (props) => {
  const { title, kind, outputLabel, calibrated, closeDisabled, sheet } = props;
  const { t } = useTranslation();
  const gutter = sheet ? 5 : 6;
  return (
    <>
      <Stack
        direction='row'
        sx={{
          minHeight: sheet ? 52 : 60,
          alignItems: 'center',
          justifyContent: 'space-between',
          pl: gutter,
          pr: sheet ? 1 : 3,
        }}
      >
        <Typography variant='h6' component='h2'>
          {title}
        </Typography>
        <IconButton
          aria-label={t('pages.project.calibration.close')}
          disabled={closeDisabled}
          onClick={props.onClose}
        >
          <CloseIcon />
        </IconButton>
      </Stack>
      <Stack
        direction='row'
        sx={{ px: gutter, gap: 2.5, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Box sx={{ display: 'flex', color: 'text.secondary' }}>
          {outputIconByKind[kind]}
        </Box>
        <Typography variant='body2'>{outputLabel}</Typography>
        <Chip
          size='small'
          label={
            calibrated
              ? t('pages.project.calibration.chip.done')
              : t('pages.project.calibration.chip.needed')
          }
          sx={(theme) => {
            const color = calibrated
              ? theme.palette.primary.main
              : theme.palette.warning.main;
            return { bgcolor: alpha(color, 0.18), color, fontWeight: 500 };
          }}
        />
      </Stack>
    </>
  );
};
