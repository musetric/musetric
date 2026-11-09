import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  Box,
  Button,
  Divider,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import { getActiveRecording, getTrackProgress } from '@musetric/engine';
import { useIsMutating, useMutation } from '@tanstack/react-query';
import { type FC, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { formatDuration } from '../../../common/formatDuration.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';
import { getRecordingColumns, getRecordingLayout } from './recordingLayout.js';
import { getRecordingNameFormId } from './recordingNameForm.js';
import { RecordingRow } from './RecordingRow.js';

const lastTickRatio = 0.98;
const endTickRatio = 0.8;

const tickSteps = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const labelCharWidth = 7;
const labelPadding = 9;

const getMinTickGap = (duration: number): number =>
  2 * (formatDuration(duration).length * labelCharWidth + labelPadding);

const getTickStep = (duration: number, width: number): number => {
  const minTickGap = getMinTickGap(duration);
  return (
    tickSteps.find((step) => (step / duration) * width >= minTickGap) ??
    tickSteps[tickSteps.length - 1]
  );
};

const getRulerTicks = (duration: number, width: number) => {
  if (duration <= 0 || width <= 0) return [];
  const step = getTickStep(duration, width);
  return Array.from(
    { length: Math.floor(duration / step) + 1 },
    (_, index) => index * step,
  )
    .map((seconds) => ({ seconds, ratio: seconds / duration }))
    .filter((tick) => tick.ratio <= lastTickRatio);
};

export type RecordingListProps = {
  compact: boolean;
  onClose: () => void;
};

export const RecordingList: FC<RecordingListProps> = (props) => {
  const { compact, onClose } = props;
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const layout = getRecordingLayout(compact);
  const recordings = useEngineStore((state) => state.recordings);
  const active = useEngineStore(getActiveRecording);
  const duration = useEngineStore((state) => state.duration);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [rulerWidth, setRulerWidth] = useState(0);
  const progress = useEngineStore(getTrackProgress);
  const setRenamingRecordingId = useProjectStore(
    (state) => state.setRenamingRecordingId,
  );
  const setDeletingRecordingId = useProjectStore(
    (state) => state.setDeletingRecordingId,
  );
  const renaming = useProjectStore(
    (state) => state.renamingRecordingId !== undefined,
  );
  const creatingRecordingId = useProjectStore(
    (state) => state.creatingRecordingId,
  );
  const setCreatingRecordingId = useProjectStore(
    (state) => state.setCreatingRecordingId,
  );
  const created = useMutation(endpoints.recording.create(projectId));
  const naming =
    useIsMutating({
      mutationKey: endpoints.recording.edit(projectId).mutationKey,
    }) > 0;
  const waveLeft = layout.sidePadding + layout.checkWidth + layout.nameWidth;
  const actionSx = {
    typography: compact ? 'body1' : 'body2',
    minHeight: compact ? 48 : 36,
    px: 3,
  };
  const hiddenOnShortScreen = renaming
    ? { '@media (max-height: 500px)': { display: 'none' } }
    : undefined;
  const listRef = useRef<HTMLDivElement>(null);
  const keyboardKeeperRef = useRef<HTMLInputElement>(null);
  const activeIndex = recordings.findIndex((recording) => recording.active);

  useLayoutEffect(() => {
    const ruler = rulerRef.current;
    if (!ruler) return undefined;
    setRulerWidth(ruler.clientWidth);
    const observer = new ResizeObserver(() => {
      setRulerWidth(ruler.clientWidth);
    });
    observer.observe(ruler);
    return () => {
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || activeIndex < 0) return;
    const rowTop = activeIndex * layout.rowHeight;
    list.scrollTop = Math.min(
      rowTop,
      Math.max(
        list.scrollTop,
        layout.rulerHeight + rowTop + layout.rowHeight - list.clientHeight,
      ),
    );
  }, [activeIndex, layout.rowHeight, layout.rulerHeight]);

  return (
    <Stack
      sx={{
        py: 2,
        position: 'relative',
        maxHeight:
          'min(60dvh, calc(var(--visible-height, 100dvh) - env(safe-area-inset-top) - 8px))',
      }}
    >
      <Box
        component='input'
        ref={keyboardKeeperRef}
        type='text'
        tabIndex={-1}
        aria-hidden
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <IconButton
        size='small'
        aria-label={t('pages.project.recording.close')}
        onClick={onClose}
        sx={{ position: 'absolute', top: 4, left: 11, zIndex: 2 }}
      >
        <CloseRoundedIcon fontSize='small' />
      </IconButton>
      <Box
        ref={listRef}
        sx={{
          overflowX: 'hidden',
          overflowY: 'auto',
          scrollPaddingTop: layout.rulerHeight,
        }}
      >
        <Box sx={{ position: 'relative' }}>
          <Box
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              display: 'grid',
              gridTemplateColumns: getRecordingColumns(layout),
              height: layout.rulerHeight,
              px: `${layout.sidePadding}px`,
              bgcolor: 'background.paper',
              backgroundImage: 'var(--Paper-overlay)',
            }}
          >
            <Box ref={rulerRef} sx={{ gridColumn: 3, position: 'relative' }}>
              {getRulerTicks(duration, rulerWidth).map((tick) => (
                <Typography
                  key={tick.seconds}
                  variant='caption'
                  sx={[
                    {
                      color: 'text.secondary',
                      position: 'absolute',
                      top: 2,
                      left: `${tick.ratio * 100}%`,
                      lineHeight: 1.2,
                    },
                    tick.ratio > endTickRatio
                      ? {
                          pr: 1,
                          borderRight: 1,
                          borderColor: 'divider',
                          transform: 'translateX(-100%)',
                        }
                      : { pl: 1, borderLeft: 1, borderColor: 'divider' },
                  ]}
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
            sx={{
              position: 'absolute',
              top: layout.rulerHeight,
              bottom: 0,
              left: waveLeft,
              right: layout.sidePadding,
              pointerEvents: 'none',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${progress * 100}%`,
                width: '1px',
                bgcolor: 'primary.main',
              }}
            />
          </Box>
        </Box>
      </Box>
      <Divider sx={{ my: 2, ...hiddenOnShortScreen }} />
      <Stack
        direction='row'
        sx={{ alignItems: 'center', gap: 1, px: 2, ...hiddenOnShortScreen }}
      >
        {creatingRecordingId === undefined ? (
          <Button
            key='new'
            color='inherit'
            startIcon={<AddRoundedIcon />}
            loading={created.isPending}
            onClick={() => {
              keyboardKeeperRef.current?.focus();
              created.mutate(undefined, {
                onSuccess: (response) => {
                  setCreatingRecordingId(
                    response.recordings.find((recording) => recording.active)
                      ?.id,
                  );
                },
                onError: () => {
                  keyboardKeeperRef.current?.blur();
                },
              });
            }}
            sx={actionSx}
          >
            {t('pages.project.recording.new')}
          </Button>
        ) : (
          <Button
            key='create'
            type='submit'
            form={getRecordingNameFormId(creatingRecordingId)}
            variant='contained'
            color='success'
            startIcon={<CheckRoundedIcon />}
            loading={naming}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            sx={actionSx}
          >
            {t('pages.project.recording.create')}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
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
