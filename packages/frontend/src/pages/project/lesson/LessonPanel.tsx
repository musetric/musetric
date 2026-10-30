import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import {
  alpha,
  Box,
  Button,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { getActiveRecording } from '@musetric/engine';
import { type VocalLessonPhrase } from '@musetric/spectrogram';
import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import {
  findLessonPhrase,
  lessonSingRange,
  type LessonSpan,
  lessonVerdictOf,
} from './lessonPhrase.js';
import {
  createLessonPlayer,
  type LessonPlayer,
  showLessonSpan,
} from './lessonPlay.js';
import {
  closeLesson,
  subscribeLessonPlaces,
  waitForLessonAnalysis,
} from './lessonSession.js';
import {
  isWholePass,
  type LessonPlace,
  useLessonStore,
} from './lessonStore.js';
import { lessonConceptText, lessonDifferenceText } from './lessonText.js';

type LessonMessageProps = {
  phrase?: VocalLessonPhrase;
  attempts: number;
};

const LessonMessage: FC<LessonMessageProps> = (props) => {
  const { phrase, attempts } = props;
  const { t } = useTranslation();
  const explained = useLessonStore((state) => state.explained);
  const verdict = lessonVerdictOf(phrase);
  const difference = phrase?.difference;

  if (verdict === 'unsung') {
    return (
      <Typography variant='body2' color='text.secondary'>
        {t('pages.project.lesson.unsung')}
      </Typography>
    );
  }
  if (!difference) {
    return (
      <Typography variant='body2' color='success.main' sx={{ fontWeight: 600 }}>
        {attempts > 0
          ? t('pages.project.lesson.clean')
          : t('pages.project.lesson.cleanAlready')}
      </Typography>
    );
  }
  return (
    <Stack sx={{ gap: 0.5 }}>
      {!explained.includes(difference.concept) && (
        <Typography variant='body2' color='text.secondary'>
          {lessonConceptText(t, difference.concept)}
        </Typography>
      )}
      <Typography variant='body2' color='warning.main' sx={{ fontWeight: 600 }}>
        {lessonDifferenceText(t, difference)}
      </Typography>
    </Stack>
  );
};

const listenInLesson = (player: LessonPlayer, span: LessonSpan) => {
  const id = useLessonStore.getState().startActivity('listening');
  void player.listen(span).finally(() => {
    useLessonStore.getState().endActivity(id);
  });
};

const wholeSpan = (places: readonly LessonPlace[]): LessonSpan => ({
  start: places[0]?.start ?? 0,
  end: places.at(-1)?.end ?? 0,
});

export const LessonPanel: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const open = useLessonStore((state) => state.open);
  const chosen = useLessonStore((state) => state.chosen);
  const places = useLessonStore((state) => state.places);
  const index = useLessonStore((state) => state.index);
  const attempts = useLessonStore((state) => state.attempts);
  const activity = useLessonStore((state) => state.activity);
  const whole = useLessonStore(isWholePass);
  const phrases = useEngineStore((state) => state.vocalLessonPhrases);
  const sung = phrases.some((phrase) => phrase.sung);
  const canRecord = useEngineStore(
    (state) =>
      Boolean(state.frameCount) &&
      getActiveRecording(state) !== undefined &&
      state.statuses.realtime !== 'error' &&
      !state.isSlave &&
      !state.playerCommandPending,
  );
  const [player] = useState(createLessonPlayer);
  const place = whole ? undefined : places.at(index);
  const phrase = place ? findLessonPhrase(phrases, place) : undefined;
  const recordingBusy = activity === 'singing' || activity === 'waiting';

  useEffect(() => {
    if (!open) {
      return;
    }
    return subscribeLessonPlaces();
  }, [open]);

  useEffect(() => player.cancel, [player]);

  useEffect(() => {
    if (!open || !chosen || !place) {
      return;
    }
    listenInLesson(player, place);
  }, [open, chosen, place, player]);

  if (!open) {
    return undefined;
  }

  const lesson = useLessonStore.getState();
  const sing = (span: LessonSpan) => {
    if (phrase?.difference) {
      lesson.explain(phrase.difference.concept);
    }
    const id = lesson.startActivity('singing');
    void player
      .sing({ projectId, ...span, ...lessonSingRange(phrases, span) })
      .then(async () => {
        useLessonStore.getState().continueActivity(id, 'waiting');
        await waitForLessonAnalysis();
      })
      .finally(() => {
        const current = useLessonStore.getState();
        current.countAttempt();
        current.endActivity(id);
        if (
          current.activityId === id &&
          current.open &&
          !isWholePass(current)
        ) {
          listenInLesson(player, span);
        }
      });
  };
  const singDisabled = recordingBusy || !canRecord;
  const singButton = (span: LessonSpan, label: string) => (
    <Button
      size='small'
      variant='contained'
      color='error'
      disabled={singDisabled}
      onClick={() => {
        sing(span);
      }}
    >
      {label}
    </Button>
  );

  const header = () => {
    if (whole) {
      return t('pages.project.lesson.wholeTitle');
    }
    if (place) {
      return t('pages.project.lesson.placeTitle', {
        index: index + 1,
        count: places.length,
      });
    }
    return t('pages.project.lesson.title');
  };

  const body = () => {
    if (activity === 'waiting' || !chosen) {
      return (
        <Typography variant='body2' color='text.secondary'>
          {t('pages.project.lesson.analyzing')}
        </Typography>
      );
    }
    if (places.length === 0) {
      return (
        <Typography variant='body2' color='text.secondary'>
          {sung
            ? t('pages.project.lesson.nothingToFix')
            : t('pages.project.lesson.singFirst')}
        </Typography>
      );
    }
    if (whole) {
      const span = wholeSpan(places);
      return (
        <Stack sx={{ gap: 1 }}>
          <Typography variant='body2'>
            {attempts > 0
              ? t('pages.project.lesson.wholeResult')
              : t('pages.project.lesson.wholeIntro')}
          </Typography>
          <Stack direction='row' sx={{ gap: 1, flexWrap: 'wrap' }}>
            {singButton(span, t('pages.project.lesson.singWhole'))}
            {attempts > 0 && (
              <Button
                size='small'
                variant='outlined'
                disabled={recordingBusy}
                onClick={() => {
                  lesson.setOpen(true);
                }}
              >
                {t('pages.project.lesson.again')}
              </Button>
            )}
          </Stack>
        </Stack>
      );
    }
    if (!place) {
      return undefined;
    }
    const clean = lessonVerdictOf(phrase) === 'clean';
    return (
      <Stack sx={{ gap: 1 }}>
        <LessonMessage phrase={phrase} attempts={attempts} />
        <Stack direction='row' sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button
            size='small'
            variant='outlined'
            disabled={recordingBusy}
            onClick={() => {
              listenInLesson(player, place);
            }}
          >
            {activity === 'listening'
              ? t('pages.project.lesson.listening')
              : t('pages.project.lesson.listen')}
          </Button>
          {singButton(
            place,
            activity === 'singing'
              ? t('pages.project.lesson.singing')
              : t('pages.project.lesson.sing'),
          )}
          <Button
            size='small'
            variant={clean ? 'contained' : 'text'}
            disabled={recordingBusy}
            onClick={() => {
              player.cancel();
              if (index + 1 >= places.length) {
                showLessonSpan(wholeSpan(places));
              }
              lesson.goTo(index + 1);
            }}
          >
            {index + 1 < places.length
              ? t('pages.project.lesson.next')
              : t('pages.project.lesson.toWhole')}
          </Button>
        </Stack>
      </Stack>
    );
  };

  return (
    <Box
      sx={(theme) => ({
        position: 'absolute',
        top: 40,
        right: 8,
        zIndex: 2,
        width: 340,
        maxWidth: 'calc(100% - 16px)',
        p: 1.5,
        borderRadius: 2,
        backgroundColor: alpha(theme.palette.background.paper, 0.95),
        boxShadow: theme.shadows[8],
        pointerEvents: 'auto',
      })}
    >
      <Stack sx={{ gap: 1 }}>
        <Stack direction='row' sx={{ alignItems: 'center', gap: 0.5 }}>
          <Typography variant='subtitle2' sx={{ fontWeight: 600, flexGrow: 1 }}>
            {header()}
          </Typography>
          <IconButton
            size='small'
            aria-label={t('pages.project.lesson.close')}
            onClick={() => {
              player.cancel();
              closeLesson();
            }}
          >
            <CloseRoundedIcon fontSize='small' />
          </IconButton>
        </Stack>
        {body()}
      </Stack>
    </Box>
  );
};
