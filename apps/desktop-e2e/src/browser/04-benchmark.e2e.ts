/**
 * Benchmark tab (M6-004): run with the mock plane in both languages and
 * assert the completed metrics table, then the failed-status surface.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS, type Locale } from '../lib/labels.js';
import { buttonByText, clickNav, containing, openApp, switchLocale, xpathString } from '../lib/page.js';

async function runBenchmark(locale: Locale, profileId: string): Promise<void> {
  const labels = LABELS[locale];
  await clickNav('benchmark', locale);
  const select = browser.$('.benchmark-view select');
  await select.waitForEnabled();
  await select.selectByAttribute('value', profileId);
  await buttonByText(labels.benchmark.run).click();
  await browser.$('.benchmark-result').waitForDisplayed({ timeout: 15_000 });
}

describe('browser-mode: benchmark run', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('shows completed metrics for a completed run (zh-CN)', async () => {
    const zh = LABELS['zh-CN'];
    await runBenchmark('zh-CN', 'chat-9b');

    const result = browser.$('.benchmark-result');
    await expect(result.$('.//span[contains(@class,"pill-safe")]')).toHaveText(zh.benchmark.completed);
    await expect(result).toHaveText(containing(zh.benchmark.metrics));
    const decodeValue = result.$(
      `//tr[td[normalize-space()=${xpathString(zh.benchmark.decodeMetric)}]]/td[2]`,
    );
    await expect(decodeValue).toHaveText('42.5');
  });

  it('shows the English metrics surface after a language switch', async () => {
    const en = LABELS.en;
    await switchLocale('en');
    await runBenchmark('en', 'chat-9b');

    const result = browser.$('.benchmark-result');
    await expect(result.$('.//span[contains(@class,"pill-safe")]')).toHaveText(en.benchmark.completed);
    const decodeValue = result.$(
      `//tr[td[normalize-space()=${xpathString(en.benchmark.decodeMetric)}]]/td[2]`,
    );
    await expect(decodeValue).toHaveText('42.5');
  });

  it('renders the failed status and stable error code pill', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('benchmark-failed');
    await runBenchmark('zh-CN', 'chat-9b');

    const result = browser.$('.benchmark-result');
    await expect(result.$('.//span[contains(@class,"pill-low")]')).toHaveText(zh.benchmark.failed);
    await expect(result).toHaveText(containing(zh.benchmark.errorCodePart));
  });
});
