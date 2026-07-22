import { CssBaseline, ThemeProvider } from '@mui/material';
import { assertDefined } from '@musetric/utils';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './components/App.js';
import { createBenchmarkProcessor } from './processor.js';
import { appTheme } from './theme.js';

const run = async () => {
  const processor = await createBenchmarkProcessor();
  const rootElement = assertDefined(
    document.getElementById('root'),
    'Root element not found',
  );
  const splashScreen = assertDefined(
    document.getElementById('splashScreen'),
    'Splash screen not found',
  );

  createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <App processor={processor} />
      </ThemeProvider>
    </StrictMode>,
  );
  splashScreen.remove();
};

void run();
