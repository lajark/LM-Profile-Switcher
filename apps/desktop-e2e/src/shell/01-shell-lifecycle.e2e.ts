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
const ZH_NAME = '外壳端到端档案'; // i18n-ignore
const MIN_ZH_NAME = '最小外壳档案'; // i18n-ignore
const EN_NAME = 'Shell E2E profile';
const MIN_EN_NAME = 'Minimal shell profile';

describe('windows-shell: real shell + sidecar lifecycle', () => {
  let locale: Locale;

  before(async () => {
    await waitConnected(60_000);
  });

  it('boots the production bundle with a connected sidecar and the four tabs', async () => {
    expect(await browser.getTitle()).toBe('LM Profile Switcher');
    await expect(badge()).toHaveText(CONNECTED_RE);
    for (const tab of ['profiles', 'optimize', 'benchmark', 'hardware'] as const) {
      await expect(
        buttonEither(LABELS['zh-CN'].nav[tab], LABELS.en.nav[tab]),
      ).toBeDisplayed();
    }
  });

  it('writes a created profile through the real sidecar into the isolated LMPS_HOME', async () => {
    locale = await detectLocale();
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
  });

  it('accepts a minimal profile (required fields only) through the real sidecar', async () => {
    // M6-004 regression: an editor document that never touched the
    // runtime/generation/behavior sections was sent without those keys (and
    // behavior.mode is a required enum), so the real sidecar rejected it with
    // PROFILE_INVALID. The editor now always emits all three sections and
    // defaults behavior.mode to exclusive.
    const labels = LABELS[locale];
    const fallback = LABELS[locale === 'zh-CN' ? 'en' : 'zh-CN'];

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
