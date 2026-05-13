import CloseIcon from '@mui/icons-material/Close';
import { Box, Drawer, IconButton, Stack, Typography } from '@mui/material';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../store.js';
import { FourierModeField } from './FourierModeField.js';
import { MaxFrequencyField } from './MaxFrequencyField.js';
import { MinDecibelField } from './MinDecibelField.js';
import { MinFrequencyField } from './MinFrequencyField.js';
import { PlayheadRatioField } from './PlayheadRatioField.js';
import { VisibleTimeField } from './VisibleTimeField.js';
import { WindowNameField } from './WindowNameField.js';
import { WindowSizeField } from './WindowSizeField.js';
import { ZeroPaddingFactorField } from './ZeroPaddingFactorField.js';

export const ProjectSettings: FC = () => {
  const { t } = useTranslation();

  const open = useSettingsStore((s) => s.open);
  const setOpen = useSettingsStore((s) => s.setOpen);

  return (
    <Drawer anchor='right' open={open} onClose={() => setOpen(false)}>
      <Box width={280} p={2} role='presentation'>
        <Stack gap={4}>
          <Stack direction='row' alignItems='center'>
            <Typography variant='h6' sx={{ flexGrow: 1 }}>
              {t('pages.project.settings.title')}
            </Typography>
            <IconButton size='small' onClick={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Stack>
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
