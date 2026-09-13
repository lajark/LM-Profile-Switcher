/**
 * Activation apply flows (M6-004): first apply, idempotent re-apply,
 * explicit replacement confirmation, and the automatic-rollback outcome
 * banner. The desktop UI has no manual rollback button: rollback is the
 * transaction layer's recovery path, surfaced here as the recovered banner.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS, PROFILE_NAMES, type Locale } from '../lib/labels.js';
import { containing, openApp, profileCard, switchLocale } from '../lib/page.js';

async function applyCard(locale: Locale, id: string): Promise<void> {
  const card = profileCard(id);
  await card
    .$(`.//button[contains(@class,'primary')][contains(normalize-space(),'${LABELS[locale].profiles.apply}')]`)
    .click();
}

async function expectBadge(id: string, present: boolean): Promise<void> {
  const badge = profileCard(id).$(`.//span[contains(@class,'pill-active')]`);
  if (present) {
    await expect(badge).toBeDisplayed();
  } else {
    await expect(badge).not.toBeExisting();
  }
}

describe('browser-mode: apply, replacement and rollback banner', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('applies, reports idempotency, replaces with confirmation (zh-CN)', async () => {
    const zh = LABELS['zh-CN'];

    await applyCard('zh-CN', 'chat-9b');
    await expect(browser.$('.profiles-view p.success')).toHaveText(
      containing(zh.profiles.activatedPart),
    );
    await expect(browser.$('.profiles-view p.success')).toHaveText(
      containing(PROFILE_NAMES.chat['zh-CN']),
    );
    await expectBadge('chat-9b', true);

    // Second apply to the same card is the idempotent no-op path.
    await applyCard('zh-CN', 'chat-9b');
    await expect(browser.$('.profiles-view p.success')).toHaveText(
      containing(zh.profiles.idempotentPart),
    );

    // Switching the active profile requires the explicit inline confirmation.
    await applyCard('zh-CN', 'code-27b');
    const codeCard = profileCard('code-27b');
    await expect(codeCard.$('.//div[contains(@class,"confirm-row")]')).toBeDisplayed();
    await expect(codeCard).toHaveText(containing(zh.profiles.applyConfirmPart));
    await codeCard
      .$(`.//div[contains(@class,"confirm-row")]//button[normalize-space()='${zh.profiles.confirm}']`)
      .click();

    await expect(browser.$('.profiles-view p.success')).toHaveText(
      containing(PROFILE_NAMES.code['zh-CN']),
    );
    await expectBadge('code-27b', true);
    await expectBadge('chat-9b', false);
  });

  it('surfaces the recovered (rolled-back) outcome without an active badge', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('apply-recovered');

    await applyCard('zh-CN', 'chat-9b');
    await expect(browser.$('.profiles-view p.error')).toHaveText(
      containing(zh.profiles.recoveredPart),
    );
    await expectBadge('chat-9b', false);
  });

  it('shows the English activation banner after a language switch', async () => {
    const en = LABELS.en;
    await switchLocale('en');

    await applyCard('en', 'chat-9b');
    await expect(browser.$('.profiles-view p.success')).toHaveText(
      containing(en.profiles.activatedPart),
    );
    await expect(browser.$('.profiles-view p.success')).toHaveText(
      containing(PROFILE_NAMES.chat.en),
    );
    await expectBadge('chat-9b', true);
  });
});
