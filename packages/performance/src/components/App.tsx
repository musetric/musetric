import {
  Box,
  Checkbox,
  FormControlLabel,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { allFourierModes, type FourierMode } from '@musetric/audio/spectrogram';
import { type FC, useMemo, useState } from 'react';
import { windowSizes } from '../constants.js';
import type { BenchmarkData } from '../runBenchmarks.js';
import { BenchmarkRunner } from './BenchmarkRunner.js';
import { MetricsTable } from './MetricsTable.js';

type Task = {
  fourierMode: FourierMode;
  windowSize: number;
};

const initialData: BenchmarkData = allFourierModes.reduce((acc, mode) => {
  acc[mode] = {};
  return acc;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
}, {} as BenchmarkData);

const allTasks: Task[] = allFourierModes.flatMap((fourierMode) =>
  windowSizes.map((windowSize) => ({ fourierMode, windowSize })),
);

export const App: FC = () => {
  const [data, setData] = useState<BenchmarkData>(initialData);
  const [showFirst, setShowFirst] = useState(false);
  const [showPercent, setShowPercent] = useState(false);
  const [showDeviations, setShowDeviations] = useState(false);
  const [mode, setMode] = useState<FourierMode>(allFourierModes[0]);
  const [toDo, setToDo] = useState<Task[]>(allTasks);

  const status = useMemo(() => {
    const total = allTasks.length;
    const done = total - toDo.length;
    const progress = total > 0 ? (done / total) * 100 : 0;
    return { total, done, progress };
  }, [toDo]);

  const [task] = toDo;

  return (
    <Box
      sx={{
        p: 1,
        bgcolor: 'background.default',
        color: 'text.primary',
        height: '100vh',
        width: '100vw',
        maxWidth: '100vw',
        overflow: 'auto',
        boxSizing: 'border-box',
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap' }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={showFirst}
              onClick={() => setShowFirst(!showFirst)}
            />
          }
          label='Show first run'
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={showPercent}
              onClick={() => setShowPercent(!showPercent)}
            />
          }
          label='Show percent'
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={showDeviations}
              onClick={() => setShowDeviations(!showDeviations)}
            />
          }
          label='Show max deviations'
        />
        <ToggleButtonGroup
          value={mode}
          exclusive
          sx={{
            my: 2,
            minWidth: 'max-content',
          }}
        >
          {allFourierModes.map((fourierMode) => (
            <ToggleButton
              key={fourierMode}
              size='small'
              value={fourierMode}
              onClick={() => setMode(fourierMode)}
            >
              {fourierMode}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <Box sx={{ width: '100%', mb: 2 }}>
        <Typography variant='body2' sx={{ mt: 1, textAlign: 'center' }}>
          {`${status.done} of ${status.total} tasks completed`}
        </Typography>
        <LinearProgress variant='determinate' value={status.progress} />
      </Box>

      <MetricsTable
        results={data[mode]}
        showFirst={showFirst}
        showPercent={showPercent}
        showDeviations={showDeviations}
      />

      {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
      {task && (
        <BenchmarkRunner
          fourierMode={task.fourierMode}
          windowSize={task.windowSize}
          onUpdate={(metrics) => {
            setData({
              ...data,
              [task.fourierMode]: {
                ...data[task.fourierMode],
                [task.windowSize]: metrics,
              },
            });
            setToDo((prev) => prev.slice(1));
          }}
        />
      )}
    </Box>
  );
};
