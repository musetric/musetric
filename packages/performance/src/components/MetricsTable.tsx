import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  useTheme,
} from '@mui/material';
import { type SpectrogramTimerLabel } from '@musetric/spectrogram/gpu';
import { type FC } from 'react';
import { windowSizes } from '../constants.js';
import { getMetric } from '../getMetric.js';
import { type MetricsData } from '../runBenchmarks.js';
import { useProcessingStore } from '../store.js';

type Row = { label: string; metric: SpectrogramTimerLabel };

const rowLabels: SpectrogramTimerLabel[] = [
  'configure',
  'writeBuffers',
  'createCommand',
  'submitCommand',
  'draw',
  'sliceSamples',
  'windowing',
  'fourierTransform',
  'magnitudify',
  'decibelify',
  'fundamentalFrequency',
  'remap',
  'other',
  'total',
];

const rows: Row[] = rowLabels.map((metric) => ({ label: metric, metric }));

export const MetricsTable: FC = () => {
  const mode = useProcessingStore((state) => state.mode);
  const results = useProcessingStore((state) => state.data[mode]);
  const showFirst = useProcessingStore((state) => state.showFirst);
  const showPercent = useProcessingStore((state) => state.showPercent);
  const showDeviations = useProcessingStore((state) => state.showDeviations);

  const theme = useTheme();
  const divider = `1px solid ${theme.palette.divider}`;
  const stickyBorder = {
    content: '""',
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: '1px',
    backgroundColor: theme.palette.divider,
    zIndex: 2,
  };

  const cellValue = (row: Row, data: MetricsData | undefined) => {
    const value = getMetric({
      data,
      metrics: [row.metric],
      showFirst,
      showPercent,
      showDeviations,
    });
    if (value === undefined) return '';
    return typeof value === 'string' ? value : value.toFixed(2);
  };

  const rowBackground = (rowIdx: number) =>
    rowIdx % 2 === 1 ? theme.palette.grey[800] : theme.palette.grey[900];

  return (
    <TableContainer
      component={Paper}
      sx={{
        my: 1,
        overflowX: 'auto',
        position: 'relative',
        '& .MuiTable-root': {
          minWidth: 'max-content',
        },
      }}
    >
      <Table
        size='small'
        sx={{
          width: '100%',
          fontSize: '0.75rem',
        }}
      >
        <TableHead>
          <TableRow sx={{ backgroundColor: theme.palette.grey[800] }}>
            <TableCell
              sx={{
                borderRight: divider,
                fontWeight: 'bold',
                width: '180px',
                position: 'sticky',
                left: 0,
                zIndex: 1,
                backgroundColor: theme.palette.grey[800],
                '&::after': stickyBorder,
              }}
            >
              {'windowSize'}
            </TableCell>
            {windowSizes.map((windowSize, idx) => (
              <TableCell
                key={windowSize}
                align='right'
                sx={{
                  borderRight: idx < windowSizes.length - 1 ? divider : 'none',
                  fontWeight: 'bold',
                  minWidth: '110px',
                }}
              >
                {windowSize}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, rowIdx) => {
            const background = rowBackground(rowIdx);
            return (
              <TableRow key={row.label} sx={{ background }}>
                <TableCell
                  component='th'
                  scope='row'
                  sx={{
                    borderRight: divider,
                    position: 'sticky',
                    left: 0,
                    backgroundColor: background,
                    zIndex: 1,
                    fontWeight: row.metric === 'total' ? 'bold' : 'normal',
                    '&::after': stickyBorder,
                    pl: 1,
                    py: 0.25,
                  }}
                >
                  {row.label}
                </TableCell>
                {windowSizes.map((windowSize, idx) => {
                  const data = results[windowSize];
                  return (
                    <TableCell
                      key={windowSize}
                      align='right'
                      sx={{
                        borderRight:
                          idx < windowSizes.length - 1 ? divider : 'none',
                        whiteSpace: 'nowrap',
                        fontWeight: row.metric === 'total' ? 'bold' : 'normal',
                      }}
                    >
                      {cellValue(row, data)}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
