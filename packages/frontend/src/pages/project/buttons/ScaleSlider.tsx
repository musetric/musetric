import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, Slider, Stack, Typography } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const blank = ' ';

type ScaleSliderLabel = {
  value: number;
  label: string;
};

export type ScaleSliderProps = {
  title: string;
  caption?: string;
  value: number;
  min: number;
  max: number;
  original: number;
  largeTickEvery: number;
  mediumTickEvery: number;
  valueText: string;
  unit: string;
  info?: string;
  originalInfo?: string;
  labels: ScaleSliderLabel[];
  disabled: boolean;
  onChange: (value: number) => void;
  onReset?: () => void;
};

export const ScaleSlider: FC<ScaleSliderProps> = (props) => {
  const {
    title,
    caption,
    value,
    min,
    max,
    original,
    largeTickEvery,
    mediumTickEvery,
    valueText,
    unit,
    info,
    originalInfo,
    labels,
    disabled,
    onChange,
    onReset,
  } = props;
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const changed = value !== original;
  const getLeft = (tick: number) => `${((tick - min) / (max - min)) * 100}%`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <Stack sx={{ gap: 3.5 }}>
      <Stack
        direction='row'
        sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 2 }}
      >
        <Stack direction='row' sx={{ alignItems: 'baseline', gap: 2 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
            {title}
          </Typography>
          {caption !== undefined && (
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {caption}
            </Typography>
          )}
        </Stack>
        {onReset !== undefined && (
          <Button
            size='small'
            color='primary'
            disabled={disabled}
            startIcon={<RestartAltIcon fontSize='small' />}
            onClick={onReset}
            sx={{ my: -1, fontSize: 14 }}
          >
            {t('pages.project.player.controls.reset')}
          </Button>
        )}
      </Stack>
      <Stack sx={{ alignItems: 'center', gap: 1 }}>
        <Stack direction='row' sx={{ alignItems: 'baseline', gap: 1 }}>
          <Typography
            color={changed ? 'primary' : 'textPrimary'}
            sx={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}
          >
            {valueText}
          </Typography>
          <Typography
            sx={{ fontSize: 14, fontWeight: 600, color: 'text.secondary' }}
          >
            {unit}
          </Typography>
        </Stack>
        <Typography
          sx={{ fontSize: 13, lineHeight: '16px', color: 'text.secondary' }}
        >
          {info ?? blank}
        </Typography>
      </Stack>
      <Stack sx={{ gap: 1 }}>
        <Slider
          aria-label={title}
          getAriaValueText={() =>
            info === undefined
              ? `${valueText} ${unit}`
              : `${valueText} ${unit}, ${info}`
          }
          color='primary'
          disabled={disabled}
          min={min}
          max={max}
          step={1}
          value={value}
          slotProps={{ input: { ref: inputRef } }}
          onChange={(_, nextValue) => {
            onChange(nextValue);
          }}
          sx={{
            height: 8,
            py: '14px',
            '& .MuiSlider-rail': { bgcolor: 'action.selected', opacity: 1 },
            '& .MuiSlider-track': { border: 'none' },
            '& .MuiSlider-thumb': {
              width: 16,
              height: 16,
              '&::before': { width: '100%', height: '100%' },
            },
            '@media (any-pointer: coarse)': { py: '20px' },
          }}
        />
        <Box sx={{ position: 'relative', height: 14 }}>
          {Array.from({ length: max - min + 1 }, (_, index) => {
            const tick = min + index;
            const fromOriginal = tick - original;
            const tickStyle = {
              width: '1px',
              height: 4,
              bgcolor: 'action.disabled',
            };
            if (fromOriginal % mediumTickEvery === 0) {
              tickStyle.height = 8;
              tickStyle.bgcolor = 'text.disabled';
            }
            if (fromOriginal % largeTickEvery === 0) {
              tickStyle.height = 14;
              tickStyle.bgcolor = 'text.secondary';
            }
            if (tick === original) {
              tickStyle.width = '2px';
              tickStyle.bgcolor = 'text.primary';
            }
            return (
              <Box
                key={tick}
                sx={{
                  ...tickStyle,
                  position: 'absolute',
                  bottom: 0,
                  left: getLeft(tick),
                  transform: 'translateX(-50%)',
                }}
              />
            );
          })}
        </Box>
        <Box sx={{ position: 'relative', height: 30 }}>
          {labels.map((label) => (
            <Typography
              key={label.value}
              noWrap
              sx={{
                fontSize: 11,
                lineHeight: '14px',
                color: 'text.secondary',
                position: 'absolute',
                top: 0,
                left: getLeft(label.value),
                transform: 'translateX(-50%)',
              }}
            >
              {label.label}
            </Typography>
          ))}
          <Stack
            sx={{
              alignItems: 'center',
              position: 'absolute',
              top: 0,
              left: getLeft(original),
              transform: 'translateX(-50%)',
            }}
          >
            <Typography
              noWrap
              sx={{ fontSize: 11, lineHeight: '14px', color: 'text.secondary' }}
            >
              {t('pages.project.player.controls.original')}
            </Typography>
            <Typography
              noWrap
              sx={{ fontSize: 12, lineHeight: '16px', color: 'text.primary' }}
            >
              {changed && originalInfo !== undefined ? originalInfo : blank}
            </Typography>
          </Stack>
        </Box>
      </Stack>
    </Stack>
  );
};
