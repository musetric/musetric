import { Box, Button, Popover, Stack, Typography } from '@mui/material';
import { type VocalMark } from '@musetric/spectrogram';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { usePracticeStore } from './practiceStore.js';
import { TakeVersionButtons } from './TakeVersionButtons.js';
import { type VocalListener } from './vocalListen.js';
import { describeVocalMark, vocalStatusLabel } from './vocalMarkText.js';

type FactsProps = {
  title: string;
  facts: string[];
};

const Facts: FC<FactsProps> = (props) => {
  const { title, facts } = props;
  const { t } = useTranslation();

  return (
    <Stack sx={{ gap: 0.25 }}>
      <Typography
        variant='overline'
        color='text.secondary'
        sx={{ lineHeight: 1.5 }}
      >
        {title}
      </Typography>
      {facts.length > 0 ? (
        facts.map((fact) => (
          <Typography key={fact} variant='body2'>
            {fact}
          </Typography>
        ))
      ) : (
        <Typography variant='body2' color='text.secondary'>
          {t('pages.project.vocal.card.plain')}
        </Typography>
      )}
    </Stack>
  );
};

export type VocalMarkSelection = {
  mark: VocalMark;
  anchor: HTMLElement;
};

export type VocalMarkCardProps = {
  selection?: VocalMarkSelection;
  listener: VocalListener;
  onClose: () => void;
};

export const VocalMarkCard: FC<VocalMarkCardProps> = (props) => {
  const { selection, listener, onClose } = props;
  const { t } = useTranslation();

  if (!selection) {
    return undefined;
  }
  const { mark, anchor } = selection;
  const text = describeVocalMark(t, mark);

  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{ paper: { sx: { maxWidth: 360 } } }}
    >
      <Stack sx={{ gap: 1.5, p: 2 }}>
        <Stack direction='row' sx={{ alignItems: 'baseline', gap: 1 }}>
          <Typography variant='subtitle1' sx={{ fontWeight: 600, flexGrow: 1 }}>
            {text.title}
          </Typography>
          <Typography variant='caption' color='text.secondary'>
            {vocalStatusLabel(t, mark.status)}
          </Typography>
        </Stack>
        <Facts
          title={t('pages.project.vocal.card.singer')}
          facts={text.singer}
        />
        {text.you && (
          <Facts title={t('pages.project.vocal.card.you')} facts={text.you} />
        )}
        {text.tip && mark.status !== 'match' && (
          <Box
            sx={{
              borderLeft: 3,
              px: 1.5,
              py: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
              borderColor: 'primary.main',
            }}
          >
            <Typography
              variant='overline'
              color='primary'
              sx={{ lineHeight: 1.5 }}
            >
              {t('pages.project.vocal.card.tip')}
            </Typography>
            <Typography variant='body2'>{text.tip}</Typography>
          </Box>
        )}
        <Stack sx={{ gap: 0.25 }}>
          <Typography
            variant='overline'
            color='text.secondary'
            sx={{ lineHeight: 1.5 }}
          >
            {t('pages.project.vocal.card.look')}
          </Typography>
          <Typography variant='body2'>{text.look}</Typography>
        </Stack>
        <Typography variant='caption' color='text.secondary'>
          {text.why}
        </Typography>
        {mark.take && <TakeVersionButtons mark={mark} listener={listener} />}
        <Stack direction='row' sx={{ gap: 1 }}>
          <Button
            size='small'
            variant='outlined'
            onClick={() => listener.listen('lead', mark.start, mark.end)}
          >
            {t('pages.project.vocal.card.listenSinger')}
          </Button>
          {mark.take && (
            <Button
              size='small'
              variant='outlined'
              onClick={() => listener.listen('recording', mark.start, mark.end)}
            >
              {t('pages.project.vocal.card.listenYou')}
            </Button>
          )}
          <Button
            size='small'
            variant='contained'
            onClick={() => {
              usePracticeStore.getState().open(mark.kind, mark.start);
              onClose();
            }}
          >
            {t('pages.project.vocal.card.practice')}
          </Button>
        </Stack>
      </Stack>
    </Popover>
  );
};
