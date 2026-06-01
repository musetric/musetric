import {
  Box,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  useTheme,
} from '@mui/material';
import {
  allTrackKeys,
  type SpectrogramLaneStage,
  spectrogramLaneStages,
  type SpectrogramTimerLabel,
  type TrackKey,
} from '@musetric/audio/spectrogram';
import { type FC, useState } from 'react';
import { windowSizes } from '../constants.js';
import { getMetric } from '../getMetric.js';
import { type MetricsData } from '../runBenchmarks.js';
import { useProcessingStore } from '../store.js';

type Row =
  | { kind: 'root'; label: string; metric: SpectrogramTimerLabel }
  | {
      kind: 'group';
      label: string;
      trackKey: TrackKey;
      metrics: SpectrogramTimerLabel[];
    }
  | {
      kind: 'leaf';
      label: string;
      trackKey: TrackKey;
      stage: SpectrogramLaneStage;
      metric: SpectrogramTimerLabel;
    };

const rootBeforeLaneLabels: SpectrogramTimerLabel[] = [
  'configure',
  'writeBuffers',
  'createCommand',
  'submitCommand',
  'draw',
];

const rootAfterLaneLabels: SpectrogramTimerLabel[] = ['other', 'total'];

const buildLaneExpanded = (): Record<TrackKey, boolean> =>
  allTrackKeys.reduce(
    (acc, key) => {
      acc[key] = false;
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Record<TrackKey, boolean>,
  );

const buildRows = (expanded: Record<TrackKey, boolean>): Row[] => {
  const rows: Row[] = rootBeforeLaneLabels.map((metric) => ({
    kind: 'root',
    label: metric,
    metric,
  }));
  for (const trackKey of allTrackKeys) {
    const laneMetrics = spectrogramLaneStages.map<SpectrogramTimerLabel>(
      (stage) => `${trackKey}.${stage}`,
    );
    rows.push({
      kind: 'group',
      label: trackKey,
      trackKey,
      metrics: laneMetrics,
    });
    if (expanded[trackKey]) {
      for (const stage of spectrogramLaneStages) {
        rows.push({
          kind: 'leaf',
          label: stage,
          trackKey,
          stage,
          metric: `${trackKey}.${stage}`,
        });
      }
    }
  }
  for (const metric of rootAfterLaneLabels) {
    rows.push({ kind: 'root', label: metric, metric });
  }
  return rows;
};

export const MetricsTable: FC = () => {
  const mode = useProcessingStore((state) => state.mode);
  const results = useProcessingStore((state) => state.data[mode]);
  const showFirst = useProcessingStore((state) => state.showFirst);
  const showPercent = useProcessingStore((state) => state.showPercent);
  const showDeviations = useProcessingStore((state) => state.showDeviations);
  const [expanded, setExpanded] =
    useState<Record<TrackKey, boolean>>(buildLaneExpanded);

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

  const rows = buildRows(expanded);

  const toggleLane = (key: TrackKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const cellValue = (row: Row, data: MetricsData | undefined) => {
    const metrics = row.kind === 'group' ? row.metrics : [row.metric];
    const value = getMetric({
      data,
      metrics,
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
            const isLeaf = row.kind === 'leaf';
            const isGroup = row.kind === 'group';
            return (
              <TableRow key={`${row.kind}:${row.label}`} sx={{ background }}>
                <TableCell
                  component='th'
                  scope='row'
                  sx={{
                    borderRight: divider,
                    position: 'sticky',
                    left: 0,
                    backgroundColor: background,
                    zIndex: 1,
                    fontWeight: isGroup ? 'bold' : 'normal',
                    '&::after': stickyBorder,
                    pl: isLeaf ? 4 : 1,
                    py: 0.25,
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                    }}
                  >
                    {isGroup && (
                      <IconButton
                        size='small'
                        onClick={() => toggleLane(row.trackKey)}
                        sx={{ p: 0.25, fontSize: '0.7rem', minWidth: 20 }}
                      >
                        {expanded[row.trackKey] ? '▼' : '▶'}
                      </IconButton>
                    )}
                    <span>{row.label}</span>
                  </Box>
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
                        fontWeight: isGroup ? 'bold' : 'normal',
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
