import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Button, LinearProgress, Stack, Typography } from '@mui/material';
import { type TFunction } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type MixdownExport,
  type MixdownExportStage,
} from './mixdownExport.js';

const stageLabels: Record<MixdownExportStage, (t: TFunction) => string> = {
  preparing: (t) => t('pages.project.mixdown.stage.preparing'),
  mixing: (t) => t('pages.project.mixdown.stage.mixing'),
  stretching: (t) => t('pages.project.mixdown.stage.stretching'),
  encoding: (t) => t('pages.project.mixdown.stage.encoding'),
};

export type MixdownProgressProps = {
  progress: MixdownExport;
  onCancel: () => void;
};

export const MixdownProgress: FC<MixdownProgressProps> = (props) => {
  const { progress, onCancel } = props;
  const { t } = useTranslation();
  const stage = stageLabels[progress.stage](t);
  const caption =
    progress.done === undefined
      ? stage
      : t('pages.project.mixdown.progress', {
          stage,
          percent: Math.round(progress.done * 100),
        });

  return (
    <Stack direction='row' sx={{ alignItems: 'center', gap: 2 }}>
      <Stack sx={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Typography variant='caption' noWrap sx={{ color: 'text.secondary' }}>
          {caption}
        </Typography>
        <LinearProgress
          key={progress.stage}
          aria-label={caption}
          variant={
            progress.done === undefined ? 'indeterminate' : 'determinate'
          }
          value={(progress.done ?? 0) * 100}
        />
      </Stack>
      <Button
        color='inherit'
        startIcon={<CloseRoundedIcon />}
        onClick={onCancel}
        sx={{ flexShrink: 0, '@media (any-pointer: coarse)': { height: 48 } }}
      >
        {t('pages.project.mixdown.cancel')}
      </Button>
    </Stack>
  );
};
