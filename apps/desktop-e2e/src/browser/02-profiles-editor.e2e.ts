/**
 * Profile create/two-step delete through the real editor (M6-004), in both
 * languages: client-side validation, save round-trip, list refresh and the
 * explicit delete confirmation.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS } from '../lib/labels.js';
import {
  buttonByText,
  containing,
  inputByLabel,
  openApp,
  profileCard,
  switchLocale,
} from '../lib/page.js';

describe('browser-mode: profile editor create and delete', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('validates, creates, then two-step deletes a profile (zh-CN)', async () => {
    const zh = LABELS['zh-CN'];

    await buttonByText(zh.profiles.new).click();
    await expect(browser.$('.editor-view h2')).toBeDisplayed();

    // Empty submit surfaces the bilingual client-side validation.
    await buttonByText(zh.editor.save).click();
    await expect(browser.$('.errors')).toHaveText(containing(zh.editor.displayNameRequired));

    await inputByLabel(zh.editor.id).setValue('e2e-made-one');
    await inputByLabel(zh.editor.zhName).setValue('端到端新建档案'); // i18n-ignore
    await inputByLabel(zh.editor.enName).setValue('E2E created profile');
    await inputByLabel(zh.editor.modelKey).setValue('vendor/e2e-made-q4');
    await inputByLabel(zh.editor.taskType).setValue('quick-chat');
    await buttonByText(zh.editor.save).click();

    const card = profileCard('e2e-made-one');
    await card.waitForDisplayed();
    await expect(card.$('.//h3')).toHaveText(containing('端到端新建档案')); // i18n-ignore

    // Two-step delete: the confirm row must appear before anything is removed.
    await card.$(`.//button[contains(normalize-space(),'${zh.profiles.delete}')]`).click();
    await expect(card.$('.//div[contains(@class,"confirm-row")]')).toBeDisplayed();
    await card
      .$(`.//div[contains(@class,"confirm-row")]//button[normalize-space()='${zh.profiles.confirm}']`)
      .click();
    await card.waitForExist({ reverse: true, timeout: 10_000 });
  });

  it('creates a profile through the English editor', async () => {
    const en = LABELS.en;
    await switchLocale('en');

    await buttonByText(en.profiles.new).click();
    await inputByLabel(en.editor.id).setValue('e2e-made-two');
    await inputByLabel(en.editor.zhName).setValue('第二个端到端档案'); // i18n-ignore
    await inputByLabel(en.editor.enName).setValue('Second E2E profile');
    await inputByLabel(en.editor.modelKey).setValue('vendor/e2e-two-q4');
    await inputByLabel(en.editor.taskType).setValue('quick-chat');
    await buttonByText(en.editor.save).click();

    const card = profileCard('e2e-made-two');
    await card.waitForDisplayed();
    await expect(card.$('.//h3')).toHaveText(containing('Second E2E profile'));
  });
});
