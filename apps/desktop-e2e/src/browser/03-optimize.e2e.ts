/**
 * Optimize wizard (M6-004): baseline selection, candidate preview with the
 * bilingual rationale/diff surface, high-confidence save, and the no-safe
 * refusal state — deterministic mock data in both language tracks.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS } from '../lib/labels.js';
import { buttonByText, candidateTitle, clickNav, containing, openApp, switchLocale } from '../lib/page.js';

async function previewFirstCandidate(locale: 'zh-CN' | 'en'): Promise<void> {
  const labels = LABELS[locale];
  await clickNav('optimize', locale);
  await browser.$('#optimize-baseline').waitForEnabled();
  await browser.$('#optimize-baseline').selectByAttribute('value', 'chat-9b');
  await buttonByText(labels.optimize.preview).click();
  await expect(browser.$('.candidate-list')).toBeDisplayed();
  const head = candidateTitle(labels.optimize.firstHead);
  await head.waitForDisplayed();
}

describe('browser-mode: optimize wizard', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('previews candidates, expands rationale/diff and saves (zh-CN)', async () => {
    const zh = LABELS['zh-CN'];
    await previewFirstCandidate('zh-CN');

    const firstCard = browser.$('.candidate-list li');
    await expect(firstCard.$('.//span[contains(@class,"pill-score")]')).toHaveText(
      containing(zh.optimize.scorePart),
    );
    await expect(firstCard).toHaveText(containing(zh.optimize.highConfidence));
    await expect(firstCard).toHaveText(containing(zh.optimize.safe));

    await candidateTitle(zh.optimize.firstHead).click();
    await expect(firstCard.$('.//th')).toHaveText(zh.optimize.diffPath);
    await expect(firstCard).toHaveText(containing(zh.optimize.rationaleZh));
    await expect(firstCard).toHaveText(containing('缩短上下文可保留全部层在显存内')); // i18n-ignore

    const save = buttonByText(zh.optimize.save);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(browser.$('.optimize-view p.success')).toHaveText(containing('chat-9b-loop-max'));
    await expect(browser.$('.optimize-view p.success')).toHaveText(containing(zh.optimize.savedPart));
  });

  it('renders the same surface in English after a language switch', async () => {
    const en = LABELS.en;
    await switchLocale('en');
    await previewFirstCandidate('en');

    const firstCard = browser.$('.candidate-list li');
    await expect(firstCard).toHaveText(containing(en.optimize.scorePart));
    await candidateTitle(en.optimize.firstHead).click();
    await expect(firstCard.$('.//th')).toHaveText(en.optimize.diffPath);
    await expect(firstCard).toHaveText(containing(en.optimize.rationaleEn));
    await expect(buttonByText(en.optimize.save)).toBeEnabled();
  });

  it('disables saving and explains the refusal when no candidate is safe', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('no-safe');
    await clickNav('optimize', 'zh-CN');
    await browser.$('#optimize-baseline').selectByAttribute('value', 'chat-9b');
    await buttonByText(zh.optimize.preview).click();

    await expect(browser.$('.optimize-view')).toHaveText(containing(zh.optimize.none));
    await expect(buttonByText(zh.optimize.save)).toBeDisabled();
    await expect(browser.$('.save-row + p, .save-row')).toBeDisplayed();
    await expect(browser.$('.optimize-view')).toHaveText(containing(zh.optimize.refusedNoSafe));
  });
});
