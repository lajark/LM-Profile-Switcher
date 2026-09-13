/**
 * E2E-only bootstrap (M6-004): identical to main.tsx, except the fake Tauri
 * internals are installed synchronously before any invoke can fire. This file
 * is referenced only by /e2e.html, which the production build never enters.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app.css';
import { App } from '../App';
import { createAppI18n } from '../i18n';
import { installE2eTauriMock } from './fake-sidecar';

installE2eTauriMock();

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('missing #root element');
}

void createAppI18n()
  .then((i18n) => {
    createRoot(rootEl).render(
      <StrictMode>
        <App i18n={i18n} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('[lmps-desktop-e2e-boot]', error);
  });
