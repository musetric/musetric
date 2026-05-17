import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import { initI18next } from './translations/index.js';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

await initI18next();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
