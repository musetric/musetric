import CloseIcon from '@mui/icons-material/Close';
import {
  Drawer,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
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
  const isDesktop = useMediaQuery((theme) => theme.breakpoints.up('sm'));

  const open = useSettingsStore((s) => s.open);
  const setOpen = useSettingsStore((s) => s.setOpen);

  return (
    <Drawer
      anchor={isDesktop ? 'right' : 'bottom'}
      open={open}
      onClose={() => setOpen(false)}
    >
      <Stack
        role='presentation'
        sx={
          isDesktop
            ? {
                width: 280,
                gap: 4,
                p: 2,
                pt: 'max(8px, env(safe-area-inset-top))',
              }
            : {
                width: '100%',
                maxWidth: 460,
                mx: 'auto',
                maxHeight:
                  'min(60dvh, calc(var(--visible-height, 100dvh) - env(safe-area-inset-top) - 8px))',
              }
        }
      >
        <Stack
          direction='row'
          sx={[{ alignItems: 'center' }, !isDesktop && { px: 4, pt: 3, pb: 2 }]}
        >
          <Typography variant='h6' sx={{ flexGrow: 1 }}>
            {t('pages.project.settings.title')}
          </Typography>
          <IconButton size='small' onClick={() => setOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Stack
          sx={[
            { gap: 4 },
            !isDesktop && {
              minHeight: 0,
              overflowY: 'auto',
              scrollPaddingBottom: '8px',
              px: 4,
              pt: 1,
              pb: 'max(18px, calc(env(safe-area-inset-bottom) - (100lvh - var(--visible-height, 100lvh))))',
            },
          ]}
        >
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
      </Stack>
    </Drawer>
  );
};
