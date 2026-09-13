/**
 * In-window Help guide (post-0.2.1): a top-level tab renders localized
 * installation/usage copy in both languages, and the local font-size control
 * actually changes the guide text size.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS } from '../lib/labels.js';
import { buttonByText, clickNav, openApp, switchLocale } from '../lib/page.js';

async function helpFontPx(): Promise<number> {
  const value = await browser.execute(() => {
    const view = document.querySelector('.help-view');
    return view ? window.getComputedStyle(view).fontSize : '';
  });
  return Number(String(value).replace('px', ''));
}

describe('browser-mode: help guide', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('renders the localized installation and usage guide in zh-CN', async () => {
    const zh = LABELS['zh-CN'];
    await clickNav('help', 'zh-CN');

    await expect(browser.$('.help-view h2')).toHaveText(zh.help.title);
    const headings = await browser.$$('.help-view h3.subsection').map((el) => el.getText());
    expect(headings).toEqual(
      expect.arrayContaining([zh.help.install, zh.help.usage]),
    );
    // Four installation steps and six usage steps, all non-empty.
    const sections = await browser.$$('.help-section ol').map((ol) => ol.$$('li'));
    const counts = await Promise.all(sections.map((items) => items.length));
    expect(counts).toEqual(expect.arrayContaining([4, 6]));
  });

  it('switches the guide to English', async () => {
    const en = LABELS.en;
    await switchLocale('en');
    await clickNav('help', 'en');

    await expect(browser.$('.help-view h2')).toHaveText(en.help.title);
    const headings = await browser.$$('.help-view h3.subsection').map((el) => el.getText());
    expect(headings).toEqual(
      expect.arrayContaining([en.help.install, en.help.usage]),
    );
  });

  it('increases and decreases the guide font size in place', async () => {
    const zh = LABELS['zh-CN'];
    await clickNav('help', 'zh-CN');

    const before = await helpFontPx();
    await buttonByText('A+').click();
    const afterLarger = await helpFontPx();
    expect(afterLarger).toBeGreaterThan(before);

    await buttonByText('A−').click();
    const afterSmaller = await helpFontPx();
    expect(afterSmaller).toBe(before);

    // The control carries an accessible localized label.
    await expect(browser.$(`//button[@aria-label=${`'${zh.help.fontLarger}'`}]`)).toBeDisplayed();
  });
});
