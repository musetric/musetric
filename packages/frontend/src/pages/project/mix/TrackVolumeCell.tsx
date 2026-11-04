import VolumeOffRoundedIcon from '@mui/icons-material/VolumeOffRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';
import { alpha, Box, Stack, Typography } from '@mui/material';
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { playHaptic } from '../haptics.js';
import { RecordingPicker } from '../recording/RecordingPicker.js';
import { useTrackName } from '../waveform/trackName.js';
import {
  playVolumeTick,
  setTrackVolume,
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
  moved: boolean;
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
  const audibleVolumeRef = useRef(volume > 0 ? volume : 1);
  const [dragging, setDragging] = useState(false);
  const percent = Math.round(volume * volumeFullPercent);
  const muted = volume === 0;

  useEffect(() => {
    if (volume > 0) {
      audibleVolumeRef.current = volume;
    }
  }, [volume]);

  const changePercent = (next: number) => {
    const limited = Math.max(0, Math.min(next, volumeFullPercent));
    playVolumeTick(percent, limited);
    setTrackVolume(target, limited / volumeFullPercent);
  };

  const toggleMute = () => {
    playHaptic('detent');
    setTrackVolume(target, muted ? audibleVolumeRef.current : 0);
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
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          if (!drag.moved) {
            if (Math.abs(event.clientX - drag.startX) < dragLockDistance) {
              return;
            }
            drag.moved = true;
            drag.startX = event.clientX;
            setDragging(true);
          }
          const offset = event.clientX - drag.startX;
          changePercent(
            Math.round(
              drag.startPercent +
                (offset / event.currentTarget.clientWidth) * volumeFullPercent,
            ),
          );
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          dragRef.current = undefined;
          setDragging(false);
          if (!drag.moved) {
            toggleMute();
          }
        }}
        onPointerCancel={(event) => {
          const drag = dragRef.current;
          if (drag?.pointerId !== event.pointerId) return;
          dragRef.current = undefined;
          setDragging(false);
          if (drag.moved) {
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
          <Typography variant='caption' noWrap sx={{ minWidth: 0 }}>
            {dragging ? `${percent}%` : name}
          </Typography>
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
