/**
 * RPC failure surface (M6-004): a rejected profiles.list renders the mapped,
 * localized error copy rather than a raw code, in both languages.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS } from '../lib/labels.js';
import { openApp, switchLocale } from '../lib/page.js';

describe('browser-mode: RPC error mapping', () => {
  beforeEach(async () => {
    await openApp('list-error');
    await browser.execute(() => window.localStorage.clear());
    await openApp('list-error');
  });

  it('shows the localized LM-unreachable message in zh-CN and English', async () => {
    await expect(browser.$('.profiles-view p.error')).toHaveText(
      LABELS['zh-CN'].error.lmUnreachable,
    );

    await switchLocale('en');
    await expect(browser.$('.profiles-view p.error')).toHaveText(LABELS.en.error.lmUnreachable);
  });
});
