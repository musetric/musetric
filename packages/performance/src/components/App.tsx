import { Box } from '@mui/material';
import { type FC } from 'react';
import { type BenchmarkProcessor } from '../processor.js';
import { BenchmarkCanvas } from './BenchmarkCanvas.js';
import { Controls } from './Controls.js';
import { MetricsTable } from './MetricsTable.js';
import { Progress } from './Progress.js';

type AppProps = {
  processor: BenchmarkProcessor;
};

export const App: FC<AppProps> = (props) => {
  const { processor } = props;
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
      <Controls />
      <Progress />
      <MetricsTable />
      <BenchmarkCanvas processor={processor} />
    </Box>
  );
};
