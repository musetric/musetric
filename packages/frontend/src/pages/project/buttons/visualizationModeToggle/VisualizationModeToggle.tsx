import { ToggleButtonGroup } from '@mui/material';
import { type FC } from 'react';
import { NotesButton } from './NotesButton.js';
import { SpectrumButton } from './SpectrumButton.js';
import { TracksButton } from './TracksButton.js';

export const VisualizationModeToggle: FC = () => {
  return (
    <ToggleButtonGroup
      exclusive
      size='small'
      color='primary'
      sx={{
        display: 'grid',
        gridAutoColumns: '1fr',
        gridAutoFlow: 'column',
        width: 'max-content',
        '& .MuiToggleButtonGroup-grouped': {
          py: 0,
        },
      }}
    >
      <TracksButton />
      <NotesButton />
      <SpectrumButton />
    </ToggleButtonGroup>
  );
};
