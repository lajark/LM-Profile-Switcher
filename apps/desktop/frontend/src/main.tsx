import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';
import { App } from './App';
import { createAppI18n } from './i18n';

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('missing #root element');
}

// The i18n service is awaited before the first render so the persisted
// language is applied on the very first paint (no language flash).
void createAppI18n()
  .then((i18n) => {
    createRoot(rootEl).render(
      <StrictMode>
        <App i18n={i18n} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('[lmps-desktop-boot]', error);
  });