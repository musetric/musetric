import { alpha, Box, Stack, type Theme, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { recordingLatencyCalibrationClickCount } from '@musetric/audio/calibration';
import { type CalibrationClick } from '@musetric/engine';
import { type FC, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { getLastJudgedClick } from './clicks.js';
import { type CalibrationPhase } from './useCalibrationFlow.js';

const size = 272;
const center = 100;
const arcRadius = 88;
const innerRadius = 70;
const arcGapDegrees = 7;
const flashMs = 650;
const wavePeriod = 70;

const pulse = keyframes`
  50% {
    opacity: 0.35;
  }
`;

const drift = keyframes`
  to {
    transform: translateX(-${wavePeriod}px);
  }
`;

const wavePath = `M-40 0 q${wavePeriod / 4} -7 ${wavePeriod / 2} 0 ${Array.from(
  { length: 8 },
  () => `t${wavePeriod / 2} 0`,
).join(' ')} V200 H-40 Z`;

const toPoint = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return `${center + arcRadius * Math.cos(radians)} ${center + arcRadius * Math.sin(radians)}`;
};

const getArcPath = (index: number, count: number) => {
  const span = 360 / count;
  const from = -90 + index * span + arcGapDegrees;
  const to = -90 + (index + 1) * span - arcGapDegrees;
  return `M ${toPoint(from)} A ${arcRadius} ${arcRadius} 0 0 1 ${toPoint(to)}`;
};

const getClickColor = (theme: Theme, click: CalibrationClick) => {
  const colors: Record<CalibrationClick, string> = {
    pending: alpha(theme.palette.text.primary, 0.14),
    clear: theme.palette.success.main,
    faint: theme.palette.warning.main,
    stray: theme.palette.warning.main,
    missed: theme.palette.error.main,
  };
  return colors[click];
};

const pendingClicks: CalibrationClick[] = Array.from(
  { length: recordingLatencyCalibrationClickCount },
  () => 'pending',
);

const useClickFlash = (clicks: CalibrationClick[]) => {
  const [flash, setFlash] = useState<CalibrationClick>();
  const judgedCountRef = useRef(0);
  useEffect(() => {
    const count = clicks.filter((click) => click !== 'pending').length;
    const previous = judgedCountRef.current;
    judgedCountRef.current = count;
    const last = getLastJudgedClick(clicks);
    if (count <= previous || !last) {
      return undefined;
    }
    setFlash(last.click);
    const timeout = window.setTimeout(() => {
      setFlash(undefined);
    }, flashMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [clicks]);
  return flash;
};

export type CalibrationGaugeProps = {
  phase: CalibrationPhase;
  figure: ReactNode;
  gutter: number;
};

export const CalibrationGauge: FC<CalibrationGaugeProps> = (props) => {
  const { phase, figure, gutter } = props;
  const { t } = useTranslation();
  const clicks = useEngineStore((state) => state.calibrationClicks);
  const clickIndex = useEngineStore((state) => state.calibrationClickIndex);
  const level = useEngineStore((state) => state.calibrationLevel);
  const flash = useClickFlash(clicks);
  const measuring = phase === 'measuring';
  const shownClicks =
    phase === 'ask' || clicks.length === 0 ? pendingClicks : clicks;
  const judged = shownClicks.filter((click) => click !== 'pending').length;
  const figureOpacities: Record<CalibrationPhase, number> = {
    ask: 1,
    measuring: 0.3,
    done: 0,
    noisy: 1,
    quiet: 1,
    unsteady: 1,
    silent: 1,
    failed: 1,
  };
  const liquidTop = center + innerRadius - level * 2 * innerRadius;

  return (
    <Stack sx={{ px: gutter, pt: 3, alignItems: 'center' }}>
      <Box
        role='progressbar'
        aria-label={t('pages.project.calibration.measuring.label')}
        aria-valuemin={0}
        aria-valuemax={shownClicks.length}
        aria-valuenow={judged}
        sx={{ position: 'relative', width: size, height: size }}
      >
        <Box
          sx={(theme) => ({
            position: 'absolute',
            inset: ((center - innerRadius) / 200) * size,
            borderRadius: '50%',
            overflow: 'hidden',
            bgcolor: alpha(theme.palette.text.primary, 0.05),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: figureOpacities[phase],
            transition: 'opacity 300ms',
            '& > svg': { width: '100%', height: '100%' },
          })}
        >
          {figure}
        </Box>
        <Box
          component='svg'
          viewBox='0 0 200 200'
          aria-hidden
          sx={(theme) => ({
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            '& .arc': {
              fill: 'none',
              strokeWidth: 8,
              strokeLinecap: 'round',
              transition: 'stroke 250ms',
            },
            '& .listening': {
              stroke: theme.palette.primary.main,
              animation: `${pulse} 1s ease-in-out infinite`,
            },
            '& .wave': {
              animation: `${drift} 1.6s linear infinite`,
              transition: 'fill 250ms',
            },
            '@media (prefers-reduced-motion: reduce)': {
              '& .listening, & .wave': { animation: 'none' },
            },
          })}
        >
          <defs>
            <clipPath id='calibration-gauge-inner'>
              <circle cx={center} cy={center} r={innerRadius} />
            </clipPath>
          </defs>
          {measuring && (
            <g clipPath='url(#calibration-gauge-inner)'>
              <g transform={`translate(0 ${liquidTop})`}>
                <Box
                  component='path'
                  className='wave'
                  d={wavePath}
                  sx={(theme) => ({
                    fill: flash
                      ? alpha(getClickColor(theme, flash), 0.6)
                      : alpha(theme.palette.primary.main, 0.35),
                  })}
                />
              </g>
            </g>
          )}
          {shownClicks.map((click, index) => (
            <Box
              key={index}
              component='path'
              className={
                measuring && click === 'pending' && index === clickIndex
                  ? 'arc listening'
                  : 'arc'
              }
              d={getArcPath(index, shownClicks.length)}
              sx={(theme) => ({ stroke: getClickColor(theme, click) })}
            />
          ))}
          {phase === 'done' && (
            <Box
              component='g'
              sx={(theme) => ({
                color: theme.palette.success.contrastText,
                fill: theme.palette.success.main,
              })}
            >
              <circle cx={center} cy={center} r={32} />
              <path
                d='M86 101 l9 9 l19 -21'
                fill='none'
                stroke='currentColor'
                strokeWidth={5}
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </Box>
          )}
        </Box>
        {measuring && (
          <Stack
            sx={{
              position: 'absolute',
              inset: 0,
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography
              variant='h3'
              component='span'
              sx={{ fontWeight: 500, lineHeight: 1 }}
            >
              {clickIndex < 0
                ? ''
                : Math.min(shownClicks.length, clickIndex + 1)}
            </Typography>
            <Typography variant='body2' sx={{ color: 'text.secondary' }}>
              {clickIndex < 0
                ? ''
                : t('pages.project.calibration.measuring.of', {
                    total: shownClicks.length,
                  })}
            </Typography>
          </Stack>
        )}
      </Box>
    </Stack>
  );
};
