import { Stack, Typography } from '@mui/material';
import { type LoopTry, type LoopTryPhase } from '@musetric/engine';
import { type TFunction } from 'i18next';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { applyLoopTry, closeLoop } from './loopActions.js';
import { getBeatsToFrom } from './loopCountdown.js';
import { LoopFinishButton } from './LoopFinishButton.js';
import { formatLoopTime } from './loopRange.js';
import { LoopTakeSwitch } from './LoopTakeSwitch.js';

type LoopCaption = {
  phase: LoopTryPhase | undefined;
  beats: number | undefined;
  tries: LoopTry[];
  from: string;
  to: string;
};

const getLoopCaption = (
  t: TFunction,
  caption: LoopCaption,
): string | undefined => {
  const { phase, beats, tries, from, to } = caption;
  if (phase === 'armed') {
    return beats === undefined
      ? t('pages.project.loop.armed', { from })
      : t('pages.project.loop.armedBeats', { from, count: beats });
  }
  if (phase === 'writing') {
    const number = (tries.at(-1)?.number ?? 0) + 1;
    return t('pages.project.loop.writing', { number, to });
  }
  if (tries.length === 0) {
    return t('pages.project.loop.empty');
  }
  return undefined;
};

export const LoopTries: FC = () => {
  const { projectId } = routes.project.useAssertMatch();
  const { t } = useTranslation();
  const singing = useEngineStore((state) => state.loopStage === 'sing');
  const range = useEngineStore((state) => state.range);
  const tries = useEngineStore((state) => state.loopTries);
  const phase = useEngineStore((state) => state.loopTryPhase);
  const beats = useEngineStore((state) =>
    state.loopTryPhase === 'armed'
      ? getBeatsToFrom(state, engine.context.sampleRate)
      : undefined,
  );
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!singing || !range) {
    return undefined;
  }

  const { sampleRate } = engine.context;
  const from = formatLoopTime(range.fromFrame / sampleRate);
  const to = formatLoopTime(range.toFrame / sampleRate);
  const busy = pending || phase !== undefined;
  const caption = failed
    ? t('pages.project.loop.insertFailed')
    : getLoopCaption(t, { phase, beats, tries, from, to });

  const keepTry = async () => {
    setPending(true);
    setFailed(false);
    const applied = await applyLoopTry(projectId);
    setPending(false);
    setFailed(!applied);
  };

  return (
    <Stack
      sx={{
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        rowGap: 1,
        columnGap: 3,
        px: { xs: 2, sm: 4 },
        py: { xs: 1, sm: 2 },
      }}
    >
      <LoopTakeSwitch disabled={pending} deletable={!busy} />
      <Stack
        direction='row'
        sx={{ alignItems: 'center', gap: 2, flexGrow: 1, minWidth: 0 }}
      >
        <Typography
          variant='caption'
          noWrap
          sx={{
            flexGrow: 1,
            color: phase || failed ? 'error.light' : 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {caption}
        </Typography>
        <LoopFinishButton
          busy={busy}
          onKeepTry={() => {
            void keepTry();
          }}
          onKeepOriginal={() => {
            setFailed(false);
            closeLoop();
          }}
        />
      </Stack>
    </Stack>
  );
};
