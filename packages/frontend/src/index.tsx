import { assertDefined } from '@musetric/utils';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/index.js';
import { engine } from './engine/engine.js';
import { initI18next } from './translations/index.js';

const runApp = async () => {
  const rootElement = assertDefined(
    document.getElementById('root'),
    'Root element not found',
  );
  const splashScreen = assertDefined(
    document.getElementById('splashScreen'),
    'Splash screen not found',
  );
  await initI18next();
  await engine.boot();

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  splashScreen.remove();
};

await runApp();
