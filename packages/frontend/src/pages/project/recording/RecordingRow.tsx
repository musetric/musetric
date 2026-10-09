import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { alpha, Box, ButtonBase, type Theme, Typography } from '@mui/material';
import { type api } from '@musetric/api';
import { useMutation } from '@tanstack/react-query';
import { type FC } from 'react';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { useProjectStore } from '../store.js';
import {
  getRecordingColumns,
  type RecordingLayout,
} from './recordingLayout.js';
import { RecordingNameField } from './RecordingNameField.js';
import { RecordingWave } from './RecordingWave.js';

export type RecordingRowProps = {
  recording: api.recording.Item;
  otherNames: string[];
  layout: RecordingLayout;
};

export const RecordingRow: FC<RecordingRowProps> = (props) => {
  const { recording, otherNames, layout } = props;
  const { projectId } = routes.project.useAssertMatch();
  const renaming = useProjectStore(
    (state) => state.renamingRecordingId === recording.id,
  );
  const activated = useMutation(endpoints.recording.activate(projectId));

  const rowSx = (theme: Theme) => ({
    display: 'grid',
    gridTemplateColumns: getRecordingColumns(layout),
    alignItems: 'center',
    width: '100%',
    height: layout.rowHeight,
    px: `${layout.sidePadding}px`,
    boxSizing: 'border-box' as const,
    textAlign: 'left' as const,
    backgroundColor: recording.active
      ? alpha(theme.palette.primary.main, 0.08)
      : undefined,
  });

  const cells = (
    <>
      <Box display='flex' color='primary.main'>
        {recording.active && <CheckRoundedIcon fontSize='small' />}
      </Box>
      {renaming ? (
        <RecordingNameField recording={recording} otherNames={otherNames} />
      ) : (
        <Typography variant='body2' noWrap pr={3}>
          {recording.name}
        </Typography>
      )}
      <Box
        height={layout.waveHeight}
        borderRadius={1}
        overflow='hidden'
        bgcolor='background.default'
      >
        <RecordingWave
          recordingId={recording.id}
          active={recording.active}
          height={layout.waveHeight}
        />
      </Box>
    </>
  );

  if (renaming) {
    return <Box sx={rowSx}>{cells}</Box>;
  }

  return (
    <ButtonBase
      aria-current={recording.active}
      onClick={() => {
        if (!recording.active) {
          activated.mutate(recording.id);
        }
      }}
      sx={(theme) => ({
        ...rowSx(theme),
        '&:hover': {
          backgroundColor: recording.active
            ? alpha(theme.palette.primary.main, 0.12)
            : theme.palette.action.hover,
        },
      })}
    >
      {cells}
    </ButtonBase>
  );
};
