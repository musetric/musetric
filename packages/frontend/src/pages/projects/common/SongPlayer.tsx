import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { IconButton, Slider, Stack, Typography } from '@mui/material';
import { type FC, useEffect, useRef, useState } from 'react';
import { formatDuration } from '../../../common/formatDuration.js';

export type SongPlayerProps = {
  url: string;
};
export const SongPlayer: FC<SongPlayerProps> = (props) => {
  const { url } = props;
  const audioRef = useRef<HTMLAudioElement>(undefined);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio(url);
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onLoadedMetadata = () => {
      const rawDuration = audio.duration;
      setDuration(Number.isFinite(rawDuration) ? rawDuration : 0);
    };
    const onEnded = () => {
      setPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [url]);

  return (
    <Stack direction='row' alignItems='center' gap={2}>
      <IconButton
        size='small'
        onClick={() => {
          if (!audioRef.current) return;
          if (playing) audioRef.current.pause();
          else void audioRef.current.play();
          setPlaying(!playing);
        }}
      >
        {playing ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
      </IconButton>
      <Slider
        size='small'
        sx={{ flex: 1 }}
        min={0}
        max={duration || 1}
        value={currentTime}
        onChange={(_, value) => {
          if (!audioRef.current) return;
          audioRef.current.currentTime = value;
          setCurrentTime(value);
        }}
      />
      <Typography
        variant='caption'
        color='text.secondary'
        width={72}
        textAlign='right'
      >
        {`${formatDuration(currentTime)} / ${formatDuration(duration)}`}
      </Typography>
    </Stack>
  );
};
