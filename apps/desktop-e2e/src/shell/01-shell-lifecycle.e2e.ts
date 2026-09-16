/**
 * Windows-shell E2E (M6-004 Slice B): real tauri-driver -> WebView2 ->
 * lmps-desktop.exe -> real sidecar SEA, mock adapter, throwaway LMPS_HOME.
 *
 * Covers: production-bundle boot, connected supervisor status, real profile
 * write into the isolated home, hardware rendering, and the supervisor's
 * automatic restart of a killed sidecar. The native tray is deliberately not
 * driven here: it is covered by Rust unit tests plus a documented manual
 * checklist (no stable WebDriver surface for tray menus).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser, expect } from '@wdio/globals';
import { LABELS, type Locale } from '../lib/labels.js';
import { containing, inputByLabel, profileCard, setSelectByLabel } from '../lib/page.js';
import {
  badge,
  buttonEither,
  CONNECTED_RE,
  detectLocale,
  killNewestShellSidecar,
  waitConnected,
  waitLeavesConnected,
} from '../lib/shell-page.js';

const PROFILE_ID = 'e2e-shell-one';
const MIN_PROFILE_ID = 'e2e-shell-minimal';
const ALT_PROFILE_ID = 'e2e-shell-alt';
const FAIL_PROFILE_ID = 'e2e-shell-fail';
const GOOD_PROFILE_ID = 'e2e-shell-good';
const ZH_NAME = '外壳端到端档案'; // i18n-ignore
const MIN_ZH_NAME = '最小外壳档案'; // i18n-ignore
const EN_NAME = 'Shell E2E profile';
const MIN_EN_NAME = 'Minimal shell profile';
const ALT_ZH_NAME = '备用外壳档案'; // i18n-ignore
const ALT_EN_NAME = 'Alternate shell profile';

async function createShellProfile(current: Locale, profileId: string, modelKey: string): Promise<void> {
  const labels = LABELS[current];
  const fallback = LABELS[current === 'zh-CN' ? 'en' : 'zh-CN'];
  await buttonEither(labels.nav.profiles, fallback.nav.profiles).click();
  await buttonEither(labels.profiles.new, fallback.profiles.new).click();
  await inputByLabel(labels.editor.id).setValue(profileId);
  await inputByLabel(labels.editor.zhName).setValue(profileId);
  await inputByLabel(labels.editor.enName).setValue(profileId);
  await inputByLabel(labels.editor.modelKey).setValue(modelKey);
  await inputByLabel(labels.editor.taskType).setValue('quick-chat');
  await buttonEither(labels.editor.save, fallback.editor.save).click();
  await profileCard(profileId).waitForDisplayed({ timeout: 15_000 });
}
describe('windows-shell: real shell + sidecar lifecycle', () => {
  let locale: Locale;

  before(async () => {
    await waitConnected(60_000);
  });

  it('boots the production bundle with a connected sidecar and the top-level tabs', async () => {
    expect(await browser.getTitle()).toBe('LM Profile Switcher');
    await expect(badge()).toHaveText(CONNECTED_RE);
    for (const tab of ['models', 'settings', 'profiles', 'optimize', 'benchmark', 'hardware', 'help'] as const) {
      await expect(
        buttonEither(LABELS['zh-CN'].nav[tab], LABELS.en.nav[tab]),
      ).toBeDisplayed();
    }
  });

  it('uses the model-first home with independent readiness cards', async () => {
    const current = await detectLocale();
    await buttonEither(LABELS['zh-CN'].nav.models, LABELS.en.nav.models).click();
    await expect(browser.$('.models-view h2')).toHaveText(containing(LABELS[current].models.title));
    await expect(browser.$$('.readiness-card')).toBeElementsArrayOfSize(3);
  });

  it('writes a created profile through the real sidecar into the isolated LMPS_HOME', async () => {
    locale = await detectLocale();
    await buttonEither(LABELS[locale].nav.profiles, LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'].nav.profiles).click();
    const labels = LABELS[locale];

    await buttonEither(labels.profiles.new, LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'].profiles.new).click();
    await expect(browser.$('.editor-view h2')).toBeDisplayed();

    await inputByLabel(labels.editor.id).setValue(PROFILE_ID);
    await inputByLabel(labels.editor.zhName).setValue(ZH_NAME);
    await inputByLabel(labels.editor.enName).setValue(EN_NAME);
    await inputByLabel(labels.editor.modelKey).setValue('vendor/e2e-shell-q4');
    await inputByLabel(labels.editor.taskType).setValue('quick-chat');
    // The v2 contract requires runtime/generation/behavior section objects;
    // fill one field in each so the editor emits all three sections.
    await inputByLabel(labels.editor.contextLength).setValue('4096');
    await inputByLabel(labels.editor.temperature).setValue('0.7');
    await setSelectByLabel(labels.editor.behaviorMode, 'coexist');
    await buttonEither(labels.editor.save, LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'].editor.save).click();

    const card = profileCard(PROFILE_ID);
    await card.waitForDisplayed({ timeout: 15_000 });
    const expectedName = locale === 'zh-CN' ? ZH_NAME : EN_NAME;
    await expect(card.$('.//h3')).toHaveText(containing(expectedName));

    const home = process.env.LMPS_HOME;
    if (!home) throw new Error('LMPS_HOME was not propagated to the worker process');
    // Sidecar SEA truth, not just React state: the versioned JSON exists and
    // the values typed into the real UI reached the store unchanged.
    const profileFile = join(home, 'profiles', `${PROFILE_ID}.json`);
    expect(existsSync(profileFile)).toBe(true);
    const stored = JSON.parse(readFileSync(profileFile, 'utf8')) as {
      schemaVersion: number;
      runtime: { contextLength: number };
      generation: { temperature: number };
      behavior: { mode: string };
    };
    expect(stored.schemaVersion).toBe(2);
    expect(stored.runtime.contextLength).toBe(4096);
    expect(stored.generation.temperature).toBe(0.7);
    expect(stored.behavior.mode).toBe('coexist');

    await buttonEither(LABELS[locale].nav.models, LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'].nav.models).click();
    const modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/e2e-shell-q4"]]');
    await modelCard.waitForDisplayed({ timeout: 15_000 });
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    await expect(browser.$('.model-context-view h2')).toHaveText('vendor/e2e-shell-q4');
    await buttonEither(LABELS[locale].models.back, LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'].models.back).click();
  });

  it('requires explicit default selection for multiple profiles in one model context', async () => {
    const labels = LABELS[locale];
    const fallback = LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'];
    await buttonEither(labels.nav.profiles, fallback.nav.profiles).click();
    await buttonEither(labels.profiles.new, fallback.profiles.new).click();
    await inputByLabel(labels.editor.id).setValue(ALT_PROFILE_ID);
    await inputByLabel(labels.editor.zhName).setValue(ALT_ZH_NAME);
    await inputByLabel(labels.editor.enName).setValue(ALT_EN_NAME);
    await inputByLabel(labels.editor.modelKey).setValue('vendor/e2e-shell-q4');
    await inputByLabel(labels.editor.taskType).setValue('quick-chat');
    await buttonEither(labels.editor.save, fallback.editor.save).click();
    await profileCard(ALT_PROFILE_ID).waitForDisplayed({ timeout: 15_000 });

    await buttonEither(labels.nav.models, fallback.nav.models).click();
    const modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/e2e-shell-q4"]]');
    await modelCard.waitForDisplayed({ timeout: 15_000 });
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    await expect(browser.$$('.context-profile')).toBeElementsArrayOfSize(2);
    await expect(browser.$('.launch-panel')).toHaveText(containing(labels.models.default.choose));
    await expect(browser.$('.launch-panel button.primary')).not.toBeDisplayed();
    await buttonEither(labels.models.setDefault, fallback.models.setDefault).click();
    await browser.$('.launch-panel button.primary').waitForDisplayed({ timeout: 15_000 });
    await buttonEither(labels.models.back, fallback.models.back).click();
  });
  it('runs the model-scoped optimization flow in the production bundle', async () => {
    const current = locale ?? (await detectLocale());
    const initialLabels = LABELS[current];
    const initialFallback = LABELS[current === 'zh-CN' ? 'en' : 'zh-CN'];
    await buttonEither(initialLabels.nav.settings, initialFallback.nav.settings).click();
    await buttonEither(initialLabels.nav.models, initialFallback.nav.models).click();
    const labels = LABELS[current];
    const fallback = LABELS[current === 'zh-CN' ? 'en' : 'zh-CN'];
    await buttonEither(labels.nav.models, fallback.nav.models).click();
    const modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/e2e-shell-q4"]]');
    await modelCard.waitForDisplayed({ timeout: 15_000 });
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    await buttonEither(labels.models.optimize, fallback.models.optimize).click();
    await expect(browser.$('.optimization-workspace')).toBeDisplayed();
    await buttonEither(labels.optimizeFlow.prepare, fallback.optimizeFlow.prepare).click();
    await expect(browser.$('.optimization-result')).toBeDisplayed();
    const result = browser.$(".optimization-result");
    await expect(result).toBeDisplayed();
    const saveButton = buttonEither(labels.optimizeFlow.save, fallback.optimizeFlow.save);
    const home = process.env.LMPS_HOME;
    if (!home) throw new Error("LMPS_HOME was not propagated to the worker process");
    let saved = false;
    if (await saveButton.isEnabled()) {
      await saveButton.click();
      const saveSuccess = browser.$(".optimization-workspace p.success");
      const saveError = browser.$(".optimization-workspace p.error");
      await browser.waitUntil(async () => (await saveSuccess.isDisplayed()) || (await saveError.isDisplayed()), { timeout: 15_000, timeoutMsg: "optimization save did not finish" });
      if (await saveError.isDisplayed()) throw new Error("optimization save failed: " + await saveError.getText());
      expect(existsSync(join(home, "profiles", `${PROFILE_ID}-optimized.json`))).toBe(true);
      saved = true;
    } else {
      await expect(saveButton).toBeDisabled();
      expect(existsSync(join(home, "profiles", `${PROFILE_ID}-optimized.json`))).toBe(false);
    }
    await buttonEither(
      saved ? labels.optimizeFlow.done : labels.profiles.cancel,
      saved ? fallback.optimizeFlow.done : fallback.profiles.cancel,
    ).click();
    await expect(browser.$('.model-context-view')).toBeDisplayed();
  });
  it('cancels optimization before preparation without creating a profile', async () => {
    const current = locale ?? (await detectLocale());
    const labels = LABELS[current];
    const fallback = LABELS[current === 'zh-CN' ? 'en' : 'zh-CN'];
    await expect(browser.$('.model-context-view')).toBeDisplayed();
    await buttonEither(labels.models.optimize, fallback.models.optimize).click();
    await expect(browser.$('.optimization-workspace')).toBeDisplayed();
    await buttonEither(labels.profiles.cancel, fallback.profiles.cancel).click();
    await expect(browser.$('.model-context-view')).toBeDisplayed();
    const home = process.env.LMPS_HOME;
    if (!home) throw new Error('LMPS_HOME was not propagated to the worker process');
    expect(existsSync(join(home, 'profiles', 'e2e-shell-cancelled.json'))).toBe(false);
  });

  it('shows failed optimization evidence and keeps saving disabled', async () => {
    await createShellProfile(locale, FAIL_PROFILE_ID, 'vendor/e2e-shell-fail');
    const current = locale ?? (await detectLocale());
    const labels = LABELS[current];
    const fallback = LABELS[current === 'zh-CN' ? 'en' : 'zh-CN'];
    await buttonEither(labels.nav.models, fallback.nav.models).click();
    const modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/e2e-shell-fail"]]');
    await modelCard.waitForDisplayed({ timeout: 15_000 });
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    await buttonEither(labels.models.optimize, fallback.models.optimize).click();
    await buttonEither(labels.optimizeFlow.prepare, fallback.optimizeFlow.prepare).click();
    await expect(browser.$('.optimization-result')).toBeDisplayed();
    await expect(browser.$('.optimization-evidence .pill')).toBeDisplayed();
    await expect(browser.$('.optimization-save-row button.primary')).toBeDisabled();
    const home = process.env.LMPS_HOME;
    if (!home) throw new Error('LMPS_HOME was not propagated to the worker process');
    expect(existsSync(join(home, 'profiles', FAIL_PROFILE_ID + '-optimized.json'))).toBe(false);
    await buttonEither(labels.profiles.cancel, fallback.profiles.cancel).click();
    await expect(browser.$('.model-context-view')).toBeDisplayed();
  });

  it('recovers the previous model when activation health check fails', async () => {
    await createShellProfile(locale, GOOD_PROFILE_ID, 'vendor/e2e-shell-good');
    let current = locale ?? (await detectLocale());
    let labels = LABELS[current];
    let fallback = LABELS[current === 'zh-CN' ? 'en' : 'zh-CN'];
    await buttonEither(labels.nav.models, fallback.nav.models).click();
    let modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/e2e-shell-good"]]');
    await modelCard.waitForDisplayed({ timeout: 15_000 });
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    await browser.$('.context-profile button.primary').click();
    await browser.$('.model-context-view p.success').waitForDisplayed({ timeout: 30_000 });
    await buttonEither(labels.models.back, fallback.models.back).click();

    await createShellProfile(locale, FAIL_PROFILE_ID + '-activation', 'vendor/e2e-shell-fail');
    current = locale ?? (await detectLocale());
    labels = LABELS[current];
    fallback = LABELS[current === 'zh-CN' ? 'en' : 'zh-CN'];
    await buttonEither(labels.nav.models, fallback.nav.models).click();
    modelCard = browser.$('//li[contains(@class,"model-card")][.//h3[normalize-space()="vendor/e2e-shell-fail"]]');
    await modelCard.waitForDisplayed({ timeout: 15_000 });
    await modelCard.$('.//button[contains(@class,"primary")]').click();
    const targetProfile = browser.$('//li[contains(@class,"context-profile")][.//p[contains(@class,"mono-card-id") and normalize-space()="e2e-shell-fail-activation"]]');
    await targetProfile.$('.//button[contains(@class,"primary")]').click();
    await expect(browser.$('.confirm-row')).toBeDisplayed();
    await browser.$('.confirm-row button').click();
    await browser.$('.model-context-view p.error').waitForDisplayed({ timeout: 30_000 });

    const home = process.env.LMPS_HOME;
    if (!home) throw new Error('LMPS_HOME was not propagated to the worker process');
    const txPath = join(home, 'logs', 'transactions.ndjson');
    expect(existsSync(txPath)).toBe(true);
    const lines = readFileSync(txPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    const transaction = JSON.parse(lines.at(-1) ?? '{}') as {
      targetProfileId?: string;
      previousProfileId?: string | null;
      status?: string;
      stages?: Array<{ name: string; outcome?: string }>;
    };
    expect(transaction.targetProfileId).toBe(FAIL_PROFILE_ID + '-activation');
    expect(transaction.status).toBe('failed-but-recovered');
    expect(transaction.stages?.some((stage) => stage.name === 'restoring-previous-profile' && stage.outcome === 'completed')).toBe(true);
  });
  it('accepts a minimal profile (required fields only) through the real sidecar', async () => {
    // M6-004 regression: an editor document that never touched the
    // runtime/generation/behavior sections was sent without those keys (and
    // behavior.mode is a required enum), so the real sidecar rejected it with
    // PROFILE_INVALID. The editor now always emits all three sections and
    // defaults behavior.mode to exclusive.
    const labels = LABELS[locale];
    const fallback = LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'];

    await buttonEither(labels.nav.profiles, fallback.nav.profiles).click();

    await buttonEither(labels.profiles.new, fallback.profiles.new).click();
    await expect(browser.$('.editor-view h2')).toBeDisplayed();

    await inputByLabel(labels.editor.id).setValue(MIN_PROFILE_ID);
    await inputByLabel(labels.editor.zhName).setValue(MIN_ZH_NAME);
    await inputByLabel(labels.editor.enName).setValue(MIN_EN_NAME);
    await inputByLabel(labels.editor.modelKey).setValue('vendor/e2e-shell-min');
    await inputByLabel(labels.editor.taskType).setValue('quick-chat');
    await buttonEither(labels.editor.save, fallback.editor.save).click();

    await profileCard(MIN_PROFILE_ID).waitForDisplayed({ timeout: 15_000 });

    const home = process.env.LMPS_HOME;
    if (!home) throw new Error('LMPS_HOME was not propagated to the worker process');
    const profileFile = join(home, 'profiles', `${MIN_PROFILE_ID}.json`);
    expect(existsSync(profileFile)).toBe(true);
    const stored = JSON.parse(readFileSync(profileFile, 'utf8')) as {
      schemaVersion: number;
      runtime: { gpuOffload?: string };
      generation: Record<string, never>;
      behavior: { mode: string };
    };
    expect(stored.schemaVersion).toBe(2);
    // The editor draft carries the product default gpuOffload:'auto'; all
    // other optional runtime/generation fields stay omitted, and behavior is
    // emitted with the default exclusive mode instead of being dropped.
    expect(stored.runtime).toEqual({ gpuOffload: 'auto' });
    expect(stored.generation).toEqual({});
    expect(stored.behavior).toEqual({ mode: 'exclusive' });
  });

  it('renders the hardware probe from the real sidecar', async () => {
    const current = locale ?? (await detectLocale());
    await buttonEither(LABELS['zh-CN'].nav.hardware, LABELS.en.nav.hardware).click();
    const heading = browser.$('.hardware-view h2');
    await heading.waitForDisplayed();
    await expect(heading).toHaveText(containing(LABELS[current].hardware.title));
  });

  it('supervisor restarts the killed sidecar and the app reconnects', async () => {
    await buttonEither(LABELS['zh-CN'].nav.profiles, LABELS.en.nav.profiles).click();
    await profileCard(PROFILE_ID).waitForDisplayed();

    const killed = await killNewestShellSidecar();
    expect(killed).toBeGreaterThan(0);

    await waitLeavesConnected();
    await waitConnected(45_000);
    await expect(badge()).toHaveText(CONNECTED_RE);
    // The view survives the restart and the stored profile is still available.
    await profileCard(PROFILE_ID).waitForDisplayed({ timeout: 15_000 });
  });
});
