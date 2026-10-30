import { Button, Stack, Typography } from '@mui/material';
import { type TakeVersion, type VocalMark } from '@musetric/spectrogram';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { type VocalListener } from './vocalListen.js';

export type TakeVersionButtonsProps = {
  mark: VocalMark;
  listener: VocalListener;
};

export const TakeVersionButtons: FC<TakeVersionButtonsProps> = (props) => {
  const { mark, listener } = props;
  const { t } = useTranslation();
  const versions: { version: TakeVersion; label: string }[] = [
    { version: 'pitch', label: t('pages.project.vocal.versions.pitch') },
    { version: 'timing', label: t('pages.project.vocal.versions.timing') },
    { version: 'level', label: t('pages.project.vocal.versions.level') },
    { version: 'all', label: t('pages.project.vocal.versions.all') },
  ];

  return (
    <Stack sx={{ gap: 0.5 }}>
      <Typography
        variant='overline'
        color='text.secondary'
        sx={{ lineHeight: 1.5 }}
      >
        {t('pages.project.vocal.versions.title')}
      </Typography>
      <Stack direction='row' sx={{ gap: 0.5, flexWrap: 'wrap' }}>
        {versions.map((item) => (
          <Button
            key={item.version}
            size='small'
            variant='outlined'
            onClick={() => {
              listener.listenVersion(item.version, mark.start, mark.end);
            }}
          >
            {item.label}
          </Button>
        ))}
      </Stack>
    </Stack>
  );
};
