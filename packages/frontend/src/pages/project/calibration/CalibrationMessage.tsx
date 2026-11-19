import { Stack, Typography } from '@mui/material';
import {
  type CalibrationClick,
  getOutputLatencyFrameCount,
} from '@musetric/engine';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { type CalibrationTexts } from './calibrationTexts.js';
import { getLastJudgedClick } from './clicks.js';
import { type CalibrationPhase } from './useCalibrationFlow.js';

const bodyLines = 3;
const bodyLineHeight = 1.43;

type Message = {
  headline: string;
  body: string;
  color: string;
};

const useListeningMessage = (texts: CalibrationTexts): Message => {
  const { t } = useTranslation();
  const clicks = useEngineStore((state) => state.calibrationClicks);
  const last = getLastJudgedClick(clicks);
  if (!last) {
    return {
      headline: t('pages.project.calibration.listening.ready'),
      body: texts.hold,
      color: 'text.primary',
    };
  }
  const click = last.index + 1;
  const messages: Record<CalibrationClick, Message> = {
    pending: {
      headline: t('pages.project.calibration.listening.ready'),
      body: texts.hold,
      color: 'text.primary',
    },
    clear: {
      headline: t('pages.project.calibration.listening.clear', { click }),
      body: texts.hold,
      color: 'success.main',
    },
    faint: {
      headline: t('pages.project.calibration.listening.faint.title', {
        click,
      }),
      body: texts.faint,
      color: 'warning.main',
    },
    stray: {
      headline: t('pages.project.calibration.listening.ready'),
      body: texts.hold,
      color: 'text.primary',
    },
    missed: {
      headline: t('pages.project.calibration.listening.missed.title', {
        click,
      }),
      body: texts.missed,
      color: 'error.light',
    },
  };
  return messages[last.click];
};

export type CalibrationMessageProps = {
  phase: CalibrationPhase;
  texts: CalibrationTexts;
  headphones: boolean;
  gutter: number;
};

export const CalibrationMessage: FC<CalibrationMessageProps> = (props) => {
  const { phase, texts, headphones, gutter } = props;
  const { t } = useTranslation();
  const listening = useListeningMessage(texts);
  const outputFrameCount = useEngineStore(getOutputLatencyFrameCount);
  const seconds = (outputFrameCount / engine.context.sampleRate).toFixed(2);
  const result = headphones
    ? t('pages.project.calibration.result.headphones', { seconds })
    : t('pages.project.calibration.result.output', { seconds });
  const failure = (headline: string, body: string): Message => ({
    headline,
    body,
    color: 'warning.main',
  });
  const messages: Record<CalibrationPhase, Message> = {
    ask: {
      headline: t('pages.project.calibration.ask.title'),
      body: texts.place,
      color: 'text.primary',
    },
    measuring: listening,
    done: {
      headline: t('pages.project.calibration.result.title'),
      body: result,
      color: 'success.main',
    },
    noisy: failure(
      t('pages.project.calibration.noisy.title'),
      t('pages.project.calibration.noisy.text'),
    ),
    quiet: failure(t('pages.project.calibration.quiet.title'), texts.quiet),
    unsteady: failure(
      t('pages.project.calibration.unsteady.title'),
      t('pages.project.calibration.unsteady.text'),
    ),
    silent: failure(t('pages.project.calibration.silent.title'), texts.silent),
    failed: failure(
      t('pages.project.calibration.failed.title'),
      t('pages.project.calibration.failed.text'),
    ),
  };
  const message = messages[phase];

  return (
    <Stack role='status' sx={{ px: gutter, pt: 4, gap: 1 }}>
      <Typography
        variant='subtitle1'
        noWrap
        sx={{ fontWeight: 500, color: message.color }}
      >
        {message.headline}
      </Typography>
      <Typography
        variant='body2'
        sx={{
          color: 'text.secondary',
          lineHeight: bodyLineHeight,
          height: `${bodyLines * bodyLineHeight}em`,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: bodyLines,
        }}
      >
        {message.body}
      </Typography>
    </Stack>
  );
};
