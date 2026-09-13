/**
 * Responsive layout regression (M6-004): no horizontal overflow and the
 * primary navigation stays operable at narrow window widths and at Chromium
 * page zoom 125%/150% (the browser-mode proxy for desktop display scaling;
 * native OS DPI is exercised by the Windows-shell suite).
 */
import { browser, expect } from '@wdio/globals';
import { LABELS } from '../lib/labels.js';
import { buttonByText, clickNav, hasHorizontalOverflow, openApp, withZoom } from '../lib/page.js';

describe('browser-mode: narrow windows and zoom scaling', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
    await browser.setWindowSize(1280, 800);
  });

  for (const [width, height] of [
    [1280, 800],
    [960, 640],
    [640, 480],
  ] as const) {
    it(`keeps navigation usable with no horizontal overflow at ${width}x${height}`, async () => {
      await browser.setWindowSize(width, height);

      await expect(buttonByText(LABELS['zh-CN'].nav.profiles)).toBeClickable();
      expect(await hasHorizontalOverflow()).toBe(false);

      await clickNav('optimize', 'zh-CN');
      await expect(buttonByText(LABELS['zh-CN'].nav.benchmark)).toBeClickable();
      expect(await hasHorizontalOverflow()).toBe(false);

      await clickNav('hardware', 'zh-CN');
      expect(await hasHorizontalOverflow()).toBe(false);

      // The editor form stays inside the viewport at the narrowest width.
      await clickNav('profiles', 'zh-CN');
      await buttonByText(LABELS['zh-CN'].profiles.new).click();
      expect(await hasHorizontalOverflow()).toBe(false);
    });
  }

  it('has no horizontal overflow at 125% and 150% page zoom', async () => {
    await withZoom(2, async () => {
      await expect(buttonByText(LABELS['zh-CN'].nav.profiles)).toBeClickable();
      expect(await hasHorizontalOverflow()).toBe(false);
    });
    await withZoom(3, async () => {
      await expect(buttonByText(LABELS['zh-CN'].nav.hardware)).toBeClickable();
      await clickNav('hardware', 'zh-CN');
      expect(await hasHorizontalOverflow()).toBe(false);
    });
  });
});
