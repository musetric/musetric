import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { type SpectrogramZeroPaddingFactor } from '@musetric/spectrogram';
import { type FC } from 'react';
import {
  fourierModes,
  type ViewSizePresetKey,
  viewSizePresetKeys,
  type VisibleTime,
  visibleTimes,
  zeroPaddingFactors,
} from '../constants.js';
import { useProcessingStore } from '../store.js';

export const Controls: FC = () => {
  const params = useProcessingStore((state) => state.params);
  const setParam = useProcessingStore((state) => state.setParam);
  const showFirst = useProcessingStore((state) => state.showFirst);
  const showPercent = useProcessingStore((state) => state.showPercent);
  const showDeviations = useProcessingStore((state) => state.showDeviations);
  const mode = useProcessingStore((state) => state.mode);
  const setShowFirst = useProcessingStore((state) => state.setShowFirst);
  const setShowPercent = useProcessingStore((state) => state.setShowPercent);
  const setShowDeviations = useProcessingStore(
    (state) => state.setShowDeviations,
  );
  const setMode = useProcessingStore((state) => state.setMode);

  const onViewSizeChange = (event: SelectChangeEvent<ViewSizePresetKey>) => {
    const raw = event.target.value;
    const match = viewSizePresetKeys.find((k) => k === raw);
    if (!match) return;
    setParam('viewSizeKey', match);
  };
  const onVisibleTimeChange = (event: SelectChangeEvent<VisibleTime>) => {
    const numeric = Number(event.target.value);
    const match = visibleTimes.find((v) => v === numeric);
    if (match === undefined) return;
    setParam('visibleTime', match);
  };
  const onZpfChange = (
    event: SelectChangeEvent<SpectrogramZeroPaddingFactor>,
  ) => {
    const numeric = Number(event.target.value);
    const match = zeroPaddingFactors.find((v) => v === numeric);
    if (match === undefined) return;
    setParam('zeroPaddingFactor', match);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        alignItems: 'center',
      }}
    >
      <FormControl size='small' sx={{ minWidth: 110 }}>
        <InputLabel>viewSize</InputLabel>
        <Select<ViewSizePresetKey>
          label='viewSize'
          value={params.viewSizeKey}
          onChange={onViewSizeChange}
        >
          {viewSizePresetKeys.map((key) => (
            <MenuItem key={key} value={key}>
              {key}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size='small' sx={{ minWidth: 110 }}>
        <InputLabel>visibleTime</InputLabel>
        <Select<VisibleTime>
          label='visibleTime'
          value={params.visibleTime}
          onChange={onVisibleTimeChange}
        >
          {visibleTimes.map((value) => (
            <MenuItem key={value} value={value}>
              {`${String(value)}s`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size='small' sx={{ minWidth: 110 }}>
        <InputLabel>zeroPad</InputLabel>
        <Select<SpectrogramZeroPaddingFactor>
          label='zeroPad'
          value={params.zeroPaddingFactor}
          onChange={onZpfChange}
        >
          {zeroPaddingFactors.map((value) => (
            <MenuItem key={value} value={value}>
              {`x${String(value)}`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

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
          label='Show spread'
        />
      </Box>

      <Box sx={{ width: '100%', overflowX: 'auto' }}>
        <ToggleButtonGroup
          value={mode}
          exclusive
          sx={{ minWidth: 'max-content' }}
        >
          {fourierModes.map((fourierMode) => (
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
    </Box>
  );
};
