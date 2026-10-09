import { alpha, SvgIcon } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type FC, useMemo } from 'react';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';

const waveColumns = 240;
const quietestScale = 0.1;
const silenceReach = 0.5;

const measureLevels = (peaks: Float32Array): number[] => {
  const peakCount = peaks.length / 2;
  return Array.from({ length: waveColumns }, (_, column) => {
    const start = Math.floor((column * peakCount) / waveColumns);
    const end = Math.max(
      start + 1,
      Math.floor(((column + 1) * peakCount) / waveColumns),
    );
    let level = 0;
    for (let index = start; index < end; index += 1) {
      level = Math.max(
        level,
        Math.abs(peaks[index * 2]),
        Math.abs(peaks[index * 2 + 1]),
      );
    }
    return level;
  });
};

const drawWave = (peaks: Float32Array, height: number): string => {
  const levels = measureLevels(peaks);
  const loudest = Math.max(quietestScale, ...levels);
  const middle = height / 2;
  const reaches = levels.map((level) =>
    Math.max(silenceReach, (level / loudest) * (middle - 1)),
  );
  const top = reaches
    .map(
      (reach, column) =>
        `${column === 0 ? 'M' : 'L'}${column} ${(middle - reach).toFixed(2)}`,
    )
    .join('');
  const bottom = reaches
    .map((reach, column) => `L${column} ${(middle + reach).toFixed(2)}`)
    .reverse()
    .join('');
  return `${top}${bottom}Z`;
};

export type RecordingWaveProps = {
  recordingId: number;
  active: boolean;
  height: number;
};

export const RecordingWave: FC<RecordingWaveProps> = (props) => {
  const { recordingId, active, height } = props;
  const { projectId } = routes.project.useAssertMatch();
  const wave = useQuery({
    ...endpoints.recording.wave(projectId, recordingId),
    refetchOnMount: 'always',
  });
  const path = useMemo(
    () => (wave.data ? drawWave(wave.data, height) : ''),
    [wave.data, height],
  );

  return (
    <SvgIcon
      viewBox={`0 0 ${waveColumns - 1} ${height}`}
      preserveAspectRatio='none'
      aria-hidden
      sx={(theme) => ({
        display: 'block',
        width: '100%',
        height,
        fontSize: 'inherit',
        color: active
          ? theme.palette.text.primary
          : alpha(theme.palette.text.primary, 0.45),
      })}
    >
      <path d={path} fill='currentColor' />
    </SvgIcon>
  );
};
