import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { alpha, Box, Stack, Typography } from '@mui/material';
import { createScaledDrag } from '@musetric/interaction';
import { type FC, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { playHaptic } from '../haptics.js';
import { RecordingPicker } from '../recording/RecordingPicker.js';
import { useTrackName } from '../waveform/trackName.js';
import {
  playVolumeTick,
  rememberTrackVolume,
  setTrackVolume,
  toggleTrackMute,
  type TrackVolumeTarget,
  useTrackVolume,
  volumeFullPercent,
  volumeTickEvery,
} from './trackVolume.js';

const dragLockDistance = 8;
const iconSize = 16;

type VolumeDrag = {
  pointerId: number;
  startX: number;
  startPercent: number;
  getPercent: ((position: number) => number) | undefined;
};

export type TrackVolumeCellProps = {
  target: TrackVolumeTarget;
};

export const TrackVolumeCell: FC<TrackVolumeCellProps> = (props) => {
  const { target } = props;
  const { t } = useTranslation();
  const name = useTrackName(target);
  const volume = useTrackVolume(target);
  const realtimeFailed = useEngineStore(
    (state) => state.statuses.realtime === 'error',
  );
  const dragRef = useRef<VolumeDrag>(undefined);
  const percent = Math.round(volume * volumeFullPercent);
  const muted = volume === 0;

  const changePercent = (next: number) => {
    const limited = Math.max(0, Math.min(next, volumeFullPercent));
    playVolumeTick(percent, limited);
    setTrackVolume(target, limited / volumeFullPercent);
  };

  const toggleMute = () => {
    playHaptic('detent');
    toggleTrackMute(target);
  };

  return (
    <Box sx={{ position: 'relative', minWidth: 0, minHeight: 0 }}>
      <Box
        role='slider'
        tabIndex={realtimeFailed ? -1 : 0}
        aria-label={t('pages.project.mix.trackVolume', { name })}
        aria-valuemin={0}
        aria-valuemax={volumeFullPercent}
        aria-valuenow={percent}
        aria-disabled={realtimeFailed}
        onPointerDown={(event) => {
          if (realtimeFailed || !event.isPrimary || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startPercent: percent,
            getPercent: undefined,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          if (!drag.getPercent) {
            if (Math.abs(event.clientX - drag.startX) < dragLockDistance) {
              return;
            }
            rememberTrackVolume(target);
            const rect = event.currentTarget.getBoundingClientRect();
            drag.getPercent = createScaledDrag({
              startPosition: event.clientX,
              startValue: drag.startPercent,
              maxValue: volumeFullPercent,
              min: rect.left,
              max: rect.right,
            });
          }
          changePercent(Math.round(drag.getPercent(event.clientX)));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          dragRef.current = undefined;
          if (!drag.getPercent) {
            toggleMute();
          }
        }}
        onPointerCancel={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          dragRef.current = undefined;
          if (drag.getPercent) {
            setTrackVolume(target, drag.startPercent / volumeFullPercent);
          }
        }}
        onKeyDown={(event) => {
          if (realtimeFailed) return;
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            changePercent(percent + volumeTickEvery);
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            changePercent(percent - volumeTickEvery);
          } else if (event.key === 'Enter' || event.key === ' ') {
            toggleMute();
          } else {
            return;
          }
          event.preventDefault();
        }}
        sx={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          borderRadius: 1.5,
          bgcolor: 'action.hover',
          cursor: 'ew-resize',
          touchAction: 'none',
          userSelect: 'none',
          '&:focus-visible': {
            outline: 2,
            outlineColor: 'primary.main',
            outlineOffset: -2,
          },
        }}
      >
        <Box
          style={{ width: `${percent}%` }}
          sx={(theme) => ({
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            pointerEvents: 'none',
            bgcolor: alpha(theme.palette.primary.main, 0.28),
          })}
        />
        <Stack
          direction='row'
          sx={{
            position: 'relative',
            height: '100%',
            alignItems: 'center',
            gap: 1,
            pl: 1.5,
            pr: target.kind === 'recording' ? 6 : 1.5,
            opacity: muted ? 0.6 : 1,
            pointerEvents: 'none',
          }}
        >
          {muted ? (
            <VolumeOffRoundedIcon sx={{ fontSize: iconSize }} />
          ) : (
            <VolumeUpRoundedIcon sx={{ fontSize: iconSize }} />
          )}
          <Stack sx={{ minWidth: 0 }}>
            <Typography variant='caption' noWrap sx={{ lineHeight: 1.25 }}>
              {name}
            </Typography>
            <Typography
              variant='caption'
              sx={{ color: 'text.secondary', lineHeight: 1.25 }}
            >
              {`${percent}%`}
            </Typography>
          </Stack>
        </Stack>
      </Box>
      {target.kind === 'recording' && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
          }}
        >
          <RecordingPicker variant='lane' />
        </Box>
      )}
    </Box>
  );
};
