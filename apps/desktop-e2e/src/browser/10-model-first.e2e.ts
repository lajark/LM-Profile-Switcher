/**
 * Model-first desktop flow (M7-005): the default surface is the model list,
 * readiness remains split into independent states, and profile actions live in
 * a selected model/scenario context.
 */
import { browser, expect } from '@wdio/globals';
import { LABELS } from '../lib/labels.js';
import {
  buttonByText,
  clickNav,
  containing,
  hasHorizontalOverflow,
  openApp,
  switchLocale,
  withZoom,
} from '../lib/page.js';

describe('browser-mode: model-first home and model context', () => {
  beforeEach(async () => {
    await openApp();
    await browser.execute(() => window.localStorage.clear());
    await openApp();
  });

  it('shows models and independent preparation cards on the default home', async () => {
    const zh = LABELS['zh-CN'];
    await expect(browser.$('.models-view h2')).toHaveText(zh.models.title);
    await expect(browser.$$('.readiness-card')).toBeElementsArrayOfSize(3);
    await expect(browser.$$('.model-card')).toBeElementsArrayOfSize(2);
    await expect(browser.$$('.profiles-view')).not.toBeElementsArrayOfSize(1);
  });

  it('keeps the model-first surface usable in narrow windows and scaled pages', async () => {
    const widths = [
      [640, 480],
      [480, 640],
    ] as const;

    for (const [width, height] of widths) {
      await browser.setWindowSize(width, height);
      await expect(browser.$('.models-view')).toBeDisplayed();
      await expect(browser.$('.readiness-grid')).toBeDisplayed();
      await expect(browser.$$('.model-card')).toBeElementsArrayOfSize(2);
      expect(await hasHorizontalOverflow()).toBe(false);
    }

    await withZoom(2, async () => {
      await expect(browser.$('.models-view')).toBeDisplayed();
      expect(await hasHorizontalOverflow()).toBe(false);
    });
    await withZoom(3, async () => {
      await expect(browser.$('.models-view')).toBeDisplayed();
      expect(await hasHorizontalOverflow()).toBe(false);
    });
  });
  it('offers safe start and profile-free optimization for a model without profiles', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('no-profiles');
    const modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/empty-7b-q4_k_m"]]');
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    await expect(browser.$('.no-profile-panel')).toBeDisplayed();
    await expect(buttonByText(zh.models.safeStart)).toBeDisplayed();

    await buttonByText(zh.models.safeStart).click();
    await expect(browser.$('.model-context-view p.success')).toHaveText(zh.models.started);

    await buttonByText(zh.models.optimize).click();
    await expect(browser.$('.optimization-workspace')).toBeDisplayed();
    await expect(browser.$('.optimization-workspace .notice-warning')).toBeDisplayed();
    await buttonByText(zh.optimizeFlow.prepare).click();
    await expect(browser.$('.optimization-result')).toBeDisplayed();
    await buttonByText(zh.optimizeFlow.save).click();
    await expect(browser.$('.optimization-workspace p.success')).toBeDisplayed();
    await buttonByText(zh.optimizeFlow.done).click();
    await browser.waitUntil(async () => { const profiles = await browser.$$('.context-profile'); return (await profiles.length) === 1; }, {
      timeout: 5000,
      timeoutMsg: 'profile-free optimization did not create the first scenario profile',
    });
  });
  it('confirms safe-start replacement before launching', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('no-profiles-replace');
    const modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/empty-7b-q4_k_m"]]');
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    await expect(browser.$('.no-profile-panel')).toBeDisplayed();
    await buttonByText(zh.models.safeStart).click();
    await expect(browser.$('.confirm-row')).toBeDisplayed();
    await buttonByText(zh.profiles.confirm).click();
    await expect(browser.$('.model-context-view p.success')).toHaveText(zh.models.started);
  });

  it('opens one model context, marks the explicit default, and starts it', async () => {
    const zh = LABELS['zh-CN'];
    await buttonByText(zh.models.viewDetails).click();
    await expect(browser.$('.model-context-view')).toBeDisplayed();
    await expect(browser.$('.context-profile-list')).toBeDisplayed();
    await expect(browser.$('.context-profile')).toHaveText(containing(zh.models.defaultBadge));

    const start = buttonByText(zh.models.start);
    await start.click();
    await expect(browser.$('.model-context-view p.success')).toHaveText(zh.models.started);
  });

  it('can select a different default without making the home a profile grid', async () => {
    const zh = LABELS['zh-CN'];
    await browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/code-27b-q4_k_m"]]//button[contains(@class,"primary")]').click();
    await expect(browser.$('.model-context-view h2')).toHaveText('vendor/code-27b-q4_k_m');
    await expect(buttonByText(zh.models.setDefault)).toBeDisplayed();
    await buttonByText(zh.models.setDefault).click();
    await expect(browser.$('.model-context-view p.success')).toHaveText(/默认档案已更新。/);
    await buttonByText(zh.models.back).click();
    await expect(browser.$('.models-view')).toBeDisplayed();
    await expect(browser.$('.profiles-view')).not.toBeDisplayed();
  });

  it('runs the model-scoped optimization loop and saves without activation', async () => {
    const zh = LABELS['zh-CN'];
    await buttonByText(zh.models.viewDetails).click();
    await buttonByText(zh.models.optimize).click();
    await expect(browser.$('.optimization-workspace')).toBeDisplayed();
    await buttonByText(zh.optimizeFlow.prepare).click();
    await expect(browser.$('.optimization-result')).toBeDisplayed();
    await expect(browser.$('.optimization-result')).toHaveText(containing(zh.optimizeFlow.evidenceMeasured));
    await buttonByText(zh.optimizeFlow.save).click();
    await expect(browser.$('.optimization-workspace p.success')).toHaveText(containing(zh.optimizeFlow.saved));
    await buttonByText(zh.optimizeFlow.done).click();
    await expect(browser.$('.model-context-view')).toBeDisplayed();
    await browser.waitUntil(async () => { const profiles = await browser.$$('.context-profile'); return (await profiles.length) >= 2; }, { timeout: 5000, timeoutMsg: 'saved optimization profile never appeared in model context' });
  });
  it('lets the user choose another candidate before re-measurement', async () => {
    const zh = LABELS['zh-CN'];
    await buttonByText(zh.models.viewDetails).click();
    await buttonByText(zh.models.optimize).click();
    await buttonByText(zh.optimizeFlow.prepare).click();
    await expect(browser.$('.optimization-result')).toBeDisplayed();
    const secondCandidate = browser.$('ul.candidate-list li.candidate-card:nth-child(2)');
    await secondCandidate.$('button.candidate-head').click();
    await expect(buttonByText(zh.optimizeFlow.retestSelected)).toBeDisplayed();
    await buttonByText(zh.optimizeFlow.retestSelected).click();
    await expect(browser.$('.optimization-result')).toHaveText(containing(zh.optimizeFlow.evidenceMeasured));
  });
  it('keeps optimization phase cards visible in the active theme', async () => {
    const zh = LABELS['zh-CN'];
    await buttonByText(zh.models.viewDetails).click();
    await buttonByText(zh.models.optimize).click();

    const background = await browser.execute(() => {
      const card = document.querySelector('.phase-card');
      return card ? window.getComputedStyle(card).backgroundColor : '';
    });
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  });
  it('renders the model-first surface in English', async () => {
    await switchLocale('en');
    const en = LABELS.en;
    await expect(browser.$('.models-view h2')).toHaveText(en.models.title);
    await clickNav('models', 'en');
    await buttonByText(en.models.viewDetails).click();
    await expect(browser.$('.model-context-view')).toHaveText(containing(en.models.defaultBadge));
  });

  it('keeps LM Studio failure separate and recoverable', async () => {
    await openApp('list-error');
    await expect(browser.$('.models-view .empty-panel')).toBeDisplayed();
    await expect(browser.$('.models-view')).toHaveText(containing(LABELS['zh-CN'].error.lmUnreachable));
  });

  it('requires an explicit default when several profiles share a model and scenario', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('no-default');
    await browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/chat-9b-q4_k_m"]]//button[contains(@class,"primary")]').click();
    await expect(browser.$('.context-profile-list')).toBeDisplayed();
    await expect(browser.$$('.context-profile')).toBeElementsArrayOfSize(2);
    await expect(browser.$('.launch-panel')).toHaveText(containing(zh.models.default.choose));
    await expect(browser.$('.launch-panel button.primary')).not.toBeDisplayed();
    await buttonByText(zh.models.setDefault).click();
    await expect(browser.$('.model-context-view p.success')).toHaveText(/默认档案已更新。/);
    await expect(browser.$('.launch-panel button.primary')).toBeDisplayed();
  });

  it('keeps a canceled candidate unmeasured and unsavable', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('optimization-canceled');
    await buttonByText(zh.models.viewDetails).click();
    await buttonByText(zh.models.optimize).click();
    await buttonByText(zh.optimizeFlow.prepare).click();
    await expect(browser.$('.optimization-result')).toHaveText(containing(zh.optimizeFlow.evidenceCanceled));
    await expect(buttonByText(zh.optimizeFlow.save)).toBeDisabled();
    await buttonByText(zh.profiles.cancel).click();
    await expect(browser.$('.model-context-view')).toBeDisplayed();
  });

  it('surfaces optimization failure without creating a profile', async () => {
    const zh = LABELS['zh-CN'];
    await openApp('optimization-failed');
    await buttonByText(zh.models.viewDetails).click();
    await buttonByText(zh.models.optimize).click();
    await buttonByText(zh.optimizeFlow.prepare).click();
    await expect(browser.$('.optimization-workspace p.error')).toHaveText(zh.error.optimizeRefused);
    await expect(browser.$('.optimization-result')).not.toBeDisplayed();
    await buttonByText(zh.profiles.cancel).click();
    await expect(browser.$('.model-context-view')).toBeDisplayed();
  });
});