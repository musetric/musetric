import { CssBaseline, GlobalStyles, ThemeProvider } from '@mui/material';
import { LandingPage } from '../pages/LandingPage.js';
import { PrivacyPage } from '../pages/PrivacyPage.js';
import { SupportPage } from '../pages/SupportPage.js';
import { theme } from './theme.js';

const renderPage = (pathname: string) => {
  if (pathname === '/privacy') return <PrivacyPage />;
  if (pathname === '/support') return <SupportPage />;
  return <LandingPage />;
};

export const App = () => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <GlobalStyles
      styles={{
        html: {
          scrollBehavior: 'smooth',
        },
        body: {
          backgroundColor: theme.palette.background.default,
        },
      }}
    />
    {renderPage(window.location.pathname)}
  </ThemeProvider>
);
