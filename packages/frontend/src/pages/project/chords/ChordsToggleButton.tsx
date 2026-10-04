import PianoOutlinedIcon from '@mui/icons-material/PianoOutlined';
import { Box, Stack, ToggleButton, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../store.js';

export const ChordsToggleButton: FC = () => {
  const { t } = useTranslation();
  const chordsOpen = useProjectStore((state) => state.chordsOpen);
  const setChordsOpen = useProjectStore((state) => state.setChordsOpen);

  return (
    <Box display='flex' borderRadius={1} bgcolor='background.default'>
      <ToggleButton
        size='small'
        color='primary'
        value='chords'
        selected={chordsOpen}
        sx={{ py: 0, px: 1.5 }}
        onClick={() => {
          setChordsOpen(!chordsOpen);
        }}
      >
        <Stack direction='row' alignItems='center' gap={1}>
          <PianoOutlinedIcon sx={{ fontSize: 14 }} />
          <Typography variant='caption' lineHeight={1} textTransform='none'>
            {t('pages.project.chords.title')}
          </Typography>
        </Stack>
      </ToggleButton>
    </Box>
  );
};
