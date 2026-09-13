/**
 * Hardware tab (M6-004): redacted probe rendering in both languages,
 * including the GiB formatting for available/total VRAM.
 */
import { browser, expect } from '@wdio/globals';
import { FIXTURE_GPU_NAME, FIXTURE_OS, LABELS } from '../lib/labels.js';
import { clickNav, containing, openApp, switchLocale } from '../lib/page.js';

describe('browser-mode: hardware panel', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('renders the fixture probe with zh-CN labels and GiB formatting', async () => {
    await clickNav('hardware', 'zh-CN');
    const view = browser.$('.hardware-view');
    await expect(view.$('.//h2')).toHaveText(LABELS['zh-CN'].hardware.title);
    await expect(view).toHaveText(containing(LABELS['zh-CN'].hardware.os));
    await expect(view).toHaveText(containing(FIXTURE_OS));
    await expect(view).toHaveText(containing(FIXTURE_GPU_NAME));
    // 16_380_317_696 available / 17_179_869_184 total bytes.
    await expect(view).toHaveText(containing('15.3 GiB'));
    await expect(view).toHaveText(containing('16.0 GiB'));
  });

  it('renders English labels after a language switch', async () => {
    await switchLocale('en');
    await clickNav('hardware', 'en');
    const view = browser.$('.hardware-view');
    await expect(view.$('.//h2')).toHaveText(LABELS.en.hardware.title);
    await expect(view).toHaveText(containing(LABELS.en.hardware.gpus));
    await expect(view).toHaveText(containing(FIXTURE_GPU_NAME));
  });
});
