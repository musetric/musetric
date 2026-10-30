import CloseIcon from '@mui/icons-material/Close';
import { Box, Drawer, IconButton, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';
import { FourierModeField } from './FourierModeField.js';
import { HarmonicsField } from './HarmonicsField.js';
import { MaxFrequencyField } from './MaxFrequencyField.js';
import { MinDecibelField } from './MinDecibelField.js';
import { MinFrequencyField } from './MinFrequencyField.js';
import { PlayheadRatioField } from './PlayheadRatioField.js';
import { StencilField } from './StencilField.js';
import { VisibleTimeField } from './VisibleTimeField.js';
import { VocalCoachField } from './VocalCoachField.js';
import { WindowNameField } from './WindowNameField.js';
import { WindowSizeField } from './WindowSizeField.js';
import { ZeroPaddingFactorField } from './ZeroPaddingFactorField.js';

export const ProjectSettings: FC = () => {
  const { t } = useTranslation();

  const open = useSettingsStore((s) => s.open);
  const setOpen = useSettingsStore((s) => s.setOpen);

  return (
    <Drawer anchor='right' open={open} onClose={() => setOpen(false)}>
      <Box role='presentation' sx={{ width: 280, p: 2 }}>
        <Stack sx={{ gap: 4 }}>
          <Stack direction='row' sx={{ alignItems: 'center' }}>
            <Typography variant='h6' sx={{ flexGrow: 1 }}>
              {t('pages.project.settings.title')}
            </Typography>
            <IconButton size='small' onClick={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Stack>
          <HarmonicsField />
          <StencilField />
          <VocalCoachField />
          <FourierModeField />
          <WindowNameField />
          <WindowSizeField />
          <MinFrequencyField />
          <MaxFrequencyField />
          <MinDecibelField />
          <VisibleTimeField />
          <PlayheadRatioField />
          <ZeroPaddingFactorField />
        </Stack>
      </Box>
    </Drawer>
  );
};
