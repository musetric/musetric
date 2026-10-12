import { Slider, Stack, Typography } from '@mui/material';
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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const marks = Array.from({ length: max - min + 1 }, (_, index) => {
    const markValue = min + index;
    if (markValue !== original) {
      return {
        value: markValue,
        label: labels.find((label) => label.value === markValue)?.label,
      };
    }
    return {
      value: markValue,
      label: (
        <Stack component='span' alignItems='center'>
          {t('pages.project.player.controls.original')}
          <Typography component='span' variant='caption' color='text.primary'>
            {changed && originalInfo !== undefined ? originalInfo : blank}
          </Typography>
        </Stack>
      ),
    };
  });

  return (
    <Stack gap={2}>
      <Typography variant='h6' textAlign='center'>
        {title}
      </Typography>
      <Stack alignItems='center'>
        <Stack direction='row' alignItems='baseline' gap={0.5}>
          <Typography
            variant='h4'
            fontWeight={700}
            lineHeight={1}
            color={changed ? 'primary' : 'text.primary'}
          >
            {valueText}
          </Typography>
          <Typography variant='subtitle2' color='text.secondary'>
            {unit}
          </Typography>
        </Stack>
        <Typography variant='body2' color='text.secondary'>
          {info ?? blank}
        </Typography>
      </Stack>
      <Slider
        aria-label={title}
        getAriaValueText={() =>
          info === undefined
            ? `${valueText} ${unit}`
            : `${valueText} ${unit}, ${info}`
        }
        disabled={disabled}
        min={min}
        max={max}
        step={1}
        marks={marks}
        track={false}
        value={value}
        slotProps={{ input: { ref: inputRef } }}
        onChange={(_, nextValue) => {
          onChange(nextValue);
        }}
        sx={{
          width: 'auto',
          mx: 3,
          mb: 11,
          '& .MuiSlider-mark': { height: 8 },
          '@media (any-pointer: coarse)': {
            py: 5,
            '& .MuiSlider-markLabel': { top: 40 },
          },
        }}
      />
    </Stack>
  );
};
