import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import i18next from 'i18next';
import { type FC } from 'react';
import { I18nextProvider } from 'react-i18next';
import { queryClient } from '../api/queryClient.js';
import { AppRouter } from './router/AppRouter.js';
import { appTheme } from './theme/index.js';

export const App: FC = () => (
  <I18nextProvider i18n={i18next} defaultNS={'translation'}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <AppRouter />
      </ThemeProvider>
    </QueryClientProvider>
  </I18nextProvider>
);
