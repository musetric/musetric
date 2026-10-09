import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { Box, Button, Divider, Stack, Typography } from '@mui/material';
import { getActiveRecording, getTrackProgress } from '@musetric/engine';
import { useMutation } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { formatDuration } from '../../../common/formatDuration.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import { getRecordingColumns, getRecordingLayout } from './recordingLayout.js';
import { RecordingRow } from './RecordingRow.js';

const lastTickRatio = 0.98;
const endTickRatio = 0.8;

const getTickStep = (duration: number): number => {
  if (duration > 150) return 60;
  if (duration > 60) return 30;
  return 10;
};

const getRulerTicks = (duration: number) => {
  if (duration <= 0) return [];
  const step = getTickStep(duration);
  return Array.from(
    { length: Math.floor(duration / step) + 1 },
    (_, index) => index * step,
  )
    .map((seconds) => ({ seconds, ratio: seconds / duration }))
    .filter((tick) => tick.ratio <= lastTickRatio);
};

export type RecordingListProps = {
  compact: boolean;
};

export const RecordingList: FC<RecordingListProps> = (props) => {
  const { compact } = props;
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const layout = getRecordingLayout(compact);
  const recordings = useEngineStore((state) => state.recordings);
  const active = useEngineStore(getActiveRecording);
  const duration = useEngineStore((state) => state.duration);
  const progress = useEngineStore(getTrackProgress);
  const setRenamingRecordingId = useProjectStore(
    (state) => state.setRenamingRecordingId,
  );
  const setDeletingRecordingId = useProjectStore(
    (state) => state.setDeletingRecordingId,
  );
  const created = useMutation(endpoints.recording.create(projectId));
  const waveLeft = layout.sidePadding + layout.checkWidth + layout.nameWidth;
  const actionSx = {
    typography: compact ? 'body1' : 'body2',
    minHeight: compact ? 48 : 36,
    px: 3,
  };

  return (
    <Stack py={2}>
      <Box position='relative'>
        <Box
          display='grid'
          gridTemplateColumns={getRecordingColumns(layout)}
          height={layout.rulerHeight}
          px={`${layout.sidePadding}px`}
        >
          <Box gridColumn={3} position='relative'>
            {getRulerTicks(duration).map((tick) => (
              <Typography
                key={tick.seconds}
                variant='caption'
                color='text.secondary'
                position='absolute'
                top={2}
                left={`${tick.ratio * 100}%`}
                lineHeight={1.2}
                sx={
                  tick.ratio > endTickRatio
                    ? {
                        pr: 1,
                        borderRight: 1,
                        borderColor: 'divider',
                        transform: 'translateX(-100%)',
                      }
                    : { pl: 1, borderLeft: 1, borderColor: 'divider' }
                }
              >
                {formatDuration(tick.seconds)}
              </Typography>
            ))}
          </Box>
        </Box>
        {recordings.map((recording) => (
          <RecordingRow
            key={recording.id}
            recording={recording}
            layout={layout}
            otherNames={recordings
              .filter((other) => other.id !== recording.id)
              .map((other) => other.name)}
          />
        ))}
        <Box
          position='absolute'
          top={layout.rulerHeight}
          bottom={0}
          left={waveLeft}
          right={layout.sidePadding}
          sx={{ pointerEvents: 'none' }}
        >
          <Box
            position='absolute'
            top={0}
            bottom={0}
            left={`${progress * 100}%`}
            width='1px'
            bgcolor='primary.main'
          />
        </Box>
      </Box>
      <Divider sx={{ my: 2 }} />
      <Stack direction='row' alignItems='center' gap={1} px={2}>
        <Button
          color='inherit'
          startIcon={<AddRoundedIcon />}
          loading={created.isPending}
          onClick={() => {
            created.mutate(undefined, {
              onSuccess: (response) => {
                setRenamingRecordingId(
                  response.recordings.find((recording) => recording.active)?.id,
                );
              },
            });
          }}
          sx={actionSx}
        >
          {t('pages.project.recording.new')}
        </Button>
        <Box flex={1} />
        <Button
          color='inherit'
          startIcon={<EditOutlinedIcon />}
          disabled={!active}
          onClick={() => {
            setRenamingRecordingId(active?.id);
          }}
          sx={actionSx}
        >
          {t('pages.project.recording.rename')}
        </Button>
        <Button
          color='inherit'
          startIcon={<DeleteOutlineRoundedIcon />}
          disabled={!active || recordings.length === 1}
          onClick={() => {
            setDeletingRecordingId(active?.id);
          }}
          sx={actionSx}
        >
          {t('pages.project.recording.delete')}
        </Button>
      </Stack>
    </Stack>
  );
};
