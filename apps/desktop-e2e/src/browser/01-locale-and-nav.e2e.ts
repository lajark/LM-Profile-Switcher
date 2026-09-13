/**
 * Bilingual shell + persistence (M6-004): the boot language is the persisted
 * one, every nav/section renders localized copy, and switching survives reload.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS, PROFILE_NAMES } from '../lib/labels.js';
import { buttonByText, clickNav, containing, openApp, profileCard, switchLocale } from '../lib/page.js';

describe('browser-mode: bilingual shell and locale persistence', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('boots into zh-CN with Chinese nav, status badge and fixture names', async () => {
    const zh = LABELS['zh-CN'];
    await expect(browser.$('.header .badge')).toHaveText(zh.connected);
    for (const label of Object.values(zh.nav)) {
      await expect(buttonByText(label)).toBeDisplayed();
    }
    await expect(profileCard('chat-9b').$('.//h3')).toHaveText(containing(PROFILE_NAMES.chat['zh-CN']));
    await expect(profileCard('code-27b').$('.//h3')).toHaveText(containing(PROFILE_NAMES.code['zh-CN']));
  });

  it('switches to English, renders English copy, and persists across reload', async () => {
    await switchLocale('en');
    const en = LABELS.en;
    for (const label of Object.values(en.nav)) {
      await expect(buttonByText(label)).toBeDisplayed();
    }
    await expect(profileCard('chat-9b').$('.//h3')).toHaveText(containing(PROFILE_NAMES.chat.en));
    await expect(browser.$('.header .badge')).toHaveText(en.connected);

    await openApp();
    await expect(buttonByText(en.nav.profiles)).toBeDisplayed();
    await expect(profileCard('code-27b').$('.//h3')).toHaveText(containing(PROFILE_NAMES.code.en));

    await switchLocale('zh-CN');
    await clickNav('hardware', 'zh-CN');
    await expect(browser.$('.hardware-view h2')).toHaveText(LABELS['zh-CN'].hardware.title);
  });
});
