import { Chip, Stack, type Theme, Typography, useTheme } from '@mui/material';
import { type api } from '@musetric/api';
import { type TFunction } from 'i18next';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatBytesToUnit,
  formatBytesWithUnit,
} from '../../../../common/formatBytes.js';
import { getShimmerTextSx } from './shimmerTextSx.js';

const getDownloadName = (download: api.project.Download) => {
  if (download.file) {
    return `${download.label} (${download.file})`;
  }
  return download.label;
};

const getDownloadColor = (
  download: api.project.Download,
  theme: Theme,
): string => {
  if (download.status === 'cached') {
    return theme.palette.success.main;
  }
  if (download.status === 'done') {
    return theme.palette.success.main;
  }
  return theme.palette.primary.main;
};

const getDownloadStatusLabel = (
  download: api.project.Download,
  t: TFunction,
): string => {
  if (download.status === 'cached') {
    return t('pages.project.progress.download.cached');
  }

  if (download.status === 'done') {
    return t('pages.project.progress.download.downloaded', {
      downloaded: formatBytesWithUnit(download.downloaded, t),
    });
  }

  return t('pages.project.progress.download.downloading', {
    downloaded: formatBytesToUnit(download.downloaded, download.total ?? 0),
    total: formatBytesWithUnit(download.total ?? 0, t),
  });
};

export type FlowStepDownloadProps = {
  step: api.project.ProcessingStep;
};
export const FlowStepDownload: FC<FlowStepDownloadProps> = (props) => {
  const { step } = props;
  const theme = useTheme();
  const { t } = useTranslation();

  if (step.status !== 'processing' || !step.download) {
    return;
  }

  const { download } = step;
  const color = getDownloadColor(download, theme);

  return (
    <Stack direction='row' alignItems='center' gap={2}>
      <Typography variant='subtitle2' color='text.secondary'>
        {t('pages.project.progress.download.label', {
          name: getDownloadName(download),
        })}
      </Typography>
      <Chip
        size='small'
        variant='outlined'
        sx={{
          color,
          '& .MuiChip-label':
            download.status === 'processing'
              ? getShimmerTextSx(color)
              : undefined,
        }}
        label={getDownloadStatusLabel(download, t)}
      />
    </Stack>
  );
};
