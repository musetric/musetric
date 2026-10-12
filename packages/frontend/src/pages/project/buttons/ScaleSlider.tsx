import { Box, Slider, Stack, Typography } from '@mui/material';
import { type FC, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const blank = ' ';

type ScaleSliderLabel = {
  value: number;
  label: string;
};

export type ScaleSliderProps = {
  title: string;
  value: number;
  min: number;
  max: number;
  original: number;
  valueText: string;
  unit: string;
  info?: string;
  originalInfo?: string;
  labels: ScaleSliderLabel[];
  disabled: boolean;
  onChange: (value: number) => void;
};

export const ScaleSlider: FC<ScaleSliderProps> = (props) => {
  const {
    title,
    value,
    min,
    max,
    original,
    valueText,
    unit,
    info,
    originalInfo,
    labels,
    disabled,
    onChange,
  } = props;
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const changed = value !== original;
  const getLeft = (tick: number) => `${((tick - min) / (max - min)) * 100}%`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <Stack gap={3.5}>
      <Typography fontSize={15} fontWeight={700}>
        {title}
      </Typography>
      <Stack alignItems='center' gap={1}>
        <Stack direction='row' alignItems='baseline' gap={1}>
          <Typography
            fontSize={32}
            fontWeight={700}
            lineHeight={1}
            color={changed ? 'primary' : 'text.primary'}
          >
            {valueText}
          </Typography>
          <Typography fontSize={14} fontWeight={600} color='text.secondary'>
            {unit}
          </Typography>
        </Stack>
        <Typography fontSize={13} lineHeight='16px' color='text.secondary'>
          {info ?? blank}
        </Typography>
      </Stack>
      <Stack gap={1}>
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
        <Box position='relative' height={12}>
          {Array.from({ length: max - min + 1 }, (_, index) => {
            const tick = min + index;
            const labelled = labels.some((label) => label.value === tick);
            const tickStyle =
              tick === original
                ? { width: '2px', height: 12, bgcolor: 'text.primary' }
                : {
                    width: '1px',
                    height: labelled ? 9 : 5,
                    bgcolor: labelled ? 'text.disabled' : 'action.disabled',
                  };
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
        <Box position='relative' height={30}>
          {labels.map((label) => (
            <Typography
              key={label.value}
              fontSize={11}
              lineHeight='14px'
              color='text.secondary'
              noWrap
              sx={{
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
            alignItems='center'
            sx={{
              position: 'absolute',
              top: 0,
              left: getLeft(original),
              transform: 'translateX(-50%)',
            }}
          >
            <Typography
              fontSize={11}
              lineHeight='14px'
              color='text.secondary'
              noWrap
            >
              {t('pages.project.player.controls.original')}
            </Typography>
            <Typography
              fontSize={12}
              lineHeight='16px'
              color='text.primary'
              noWrap
            >
              {changed && originalInfo !== undefined ? originalInfo : blank}
            </Typography>
          </Stack>
        </Box>
      </Stack>
    </Stack>
  );
};
