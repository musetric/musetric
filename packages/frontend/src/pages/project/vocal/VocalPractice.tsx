import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import {
  alpha,
  Box,
  Button,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { type VocalMark } from '@musetric/spectrogram';
import { type FC, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import {
  findPlace,
  practicePlaces,
  stencilFadeOf,
  usePracticeStore,
} from './practiceStore.js';
import { showPracticePlace, tryPracticeFragment } from './practiceTry.js';
import { TakeVersionButtons } from './TakeVersionButtons.js';
import { createVocalListener } from './vocalListen.js';
import {
  describeVocalMark,
  vocalKindLabel,
  vocalStatusLabel,
} from './vocalMarkText.js';

const percent = 100;

type PracticeVerdictProps = {
  place: VocalMark;
  analyzing: boolean;
};

const PracticeVerdict: FC<PracticeVerdictProps> = (props) => {
  const { place, analyzing } = props;
  const { t } = useTranslation();
  const text = describeVocalMark(t, place);

  if (analyzing) {
    return (
      <Typography variant='body2' color='text.secondary'>
        {t('pages.project.vocal.practice.analyzing')}
      </Typography>
    );
  }
  if (!place.take) {
    return (
      <Typography variant='body2' color='text.secondary'>
        {t('pages.project.vocal.practice.notSung')}
      </Typography>
    );
  }
  return (
    <Stack sx={{ gap: 0.5 }}>
      <Typography
        variant='body2'
        color={place.status === 'match' ? 'success.main' : 'warning.main'}
        sx={{ fontWeight: 600 }}
      >
        {vocalStatusLabel(t, place.status)}
      </Typography>
      {text.you?.map((fact) => (
        <Typography key={fact} variant='body2'>
          {fact}
        </Typography>
      ))}
      {place.status !== 'match' && text.tip && (
        <Typography variant='body2' color='text.secondary'>
          {text.tip}
        </Typography>
      )}
    </Stack>
  );
};

export const VocalPractice: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const kind = usePracticeStore((state) => state.kind);
  const time = usePracticeStore((state) => state.time);
  const attempts = usePracticeStore((state) => state.attempts);
  const trying = usePracticeStore((state) => state.trying);
  const fade = usePracticeStore(stencilFadeOf);
  const marks = useEngineStore((state) => state.vocalMarks);
  const analyzing = useEngineStore(
    (state) => state.vocalCoachStatus === 'analyzing',
  );
  const playerBusy = useEngineStore(
    (state) => state.playerCommandPending || state.isSlave,
  );
  const [listener] = useState(createVocalListener);
  const places = useMemo(
    () => (kind ? practicePlaces(marks, kind) : []),
    [marks, kind],
  );
  const place = findPlace(places, time);
  const index = place ? places.indexOf(place) : -1;

  useEffect(() => listener.dispose, [listener]);

  if (!kind) {
    return undefined;
  }

  const store = usePracticeStore.getState();
  const goTo = (next: VocalMark | undefined) => {
    if (!next) {
      return;
    }
    store.goTo(next.start);
    showPracticePlace(next.start);
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
            {t('pages.project.vocal.practice.title', {
              technique: vocalKindLabel(t, kind),
            })}
          </Typography>
          <Typography variant='caption' color='text.secondary'>
            {index >= 0
              ? t('pages.project.vocal.practice.place', {
                  index: index + 1,
                  count: places.length,
                })
              : ''}
          </Typography>
          <IconButton
            size='small'
            disabled={index <= 0 || trying}
            aria-label={t('pages.project.vocal.practice.previous')}
            onClick={() => {
              goTo(places[index - 1]);
            }}
          >
            <ChevronLeftRoundedIcon fontSize='small' />
          </IconButton>
          <IconButton
            size='small'
            disabled={index < 0 || index >= places.length - 1 || trying}
            aria-label={t('pages.project.vocal.practice.next')}
            onClick={() => {
              goTo(places[index + 1]);
            }}
          >
            <ChevronRightRoundedIcon fontSize='small' />
          </IconButton>
          <IconButton
            size='small'
            disabled={trying}
            aria-label={t('pages.project.vocal.practice.close')}
            onClick={() => {
              store.close();
            }}
          >
            <CloseRoundedIcon fontSize='small' />
          </IconButton>
        </Stack>
        {place ? (
          <>
            <Stack sx={{ gap: 0.25 }}>
              <Typography
                variant='overline'
                color='text.secondary'
                sx={{ lineHeight: 1.5 }}
              >
                {t('pages.project.vocal.card.singer')}
              </Typography>
              {describeVocalMark(t, place).singer.map((fact) => (
                <Typography key={fact} variant='body2'>
                  {fact}
                </Typography>
              ))}
            </Stack>
            <PracticeVerdict place={place} analyzing={analyzing} />
            <Stack direction='row' sx={{ gap: 1, alignItems: 'center' }}>
              <Button
                size='small'
                variant='outlined'
                disabled={trying || playerBusy}
                onClick={() => {
                  listener.listen('lead', place.start, place.end);
                }}
              >
                {t('pages.project.vocal.practice.listen')}
              </Button>
              <Button
                size='small'
                variant='contained'
                color='error'
                disabled={trying || playerBusy}
                onClick={() => {
                  store.setTrying(true);
                  void tryPracticeFragment({
                    projectId,
                    start: place.start,
                    end: place.end,
                    onFinish: () => {
                      store.setTrying(false);
                      store.countAttempt();
                    },
                  });
                }}
              >
                {trying
                  ? t('pages.project.vocal.practice.trying')
                  : t('pages.project.vocal.practice.try')}
              </Button>
              <Button
                size='small'
                variant='outlined'
                disabled={trying || playerBusy || !place.take}
                onClick={() => {
                  listener.listen('recording', place.start, place.end);
                }}
              >
                {t('pages.project.vocal.practice.me')}
              </Button>
            </Stack>
            {place.take && (
              <TakeVersionButtons mark={place} listener={listener} />
            )}
            <Typography variant='caption' color='text.secondary'>
              {t('pages.project.vocal.practice.attempts', {
                count: attempts,
                stencil: Math.round(fade * percent),
              })}
            </Typography>
          </>
        ) : (
          <Typography variant='body2' color='text.secondary'>
            {t('pages.project.vocal.practice.empty')}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};
