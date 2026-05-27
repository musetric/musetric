import BluetoothIcon from '@mui/icons-material/Bluetooth';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import MicIcon from '@mui/icons-material/Mic';
import SpeakerIcon from '@mui/icons-material/Speaker';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import {
  type AudioInputSourceKind,
  type AudioOutputSourceKind,
} from '@musetric/audio/recording';
import { type ReactNode } from 'react';

export const renderAudioInputIcon = (kind: AudioInputSourceKind): ReactNode => {
  if (kind === 'bluetooth') return <BluetoothIcon fontSize='small' />;
  if (kind === 'wiredHeadset') return <HeadphonesIcon fontSize='small' />;
  if (kind === 'builtIn') return <MicIcon fontSize='small' />;
  return <MicIcon fontSize='small' />;
};

export const renderAudioOutputIcon = (
  kind: AudioOutputSourceKind,
): ReactNode => {
  if (kind === 'bluetooth') return <BluetoothIcon fontSize='small' />;
  if (kind === 'wiredHeadset') return <HeadphonesIcon fontSize='small' />;
  if (kind === 'builtIn') return <SpeakerIcon fontSize='small' />;
  return <VolumeUpIcon fontSize='small' />;
};
