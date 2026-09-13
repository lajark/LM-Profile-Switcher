/**
 * Shared locators and interactions for browser-mode specs (M6-004).
 * Text-based locators intentionally mirror what a human user sees; every flow
 * therefore also proves the localized copy for the active language.
 */
import { browser } from '@wdio/globals';
import type { ChainablePromiseElement } from 'webdriverio';
import { LABELS, LOCALE_BUTTON, type Locale } from './labels.js';

type Element = ChainablePromiseElement;

/** XPath-safe quoting for literal text (labels may contain apostrophes). */
export function xpathString(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  const parts = value.split("'");
  return `concat('${parts.join("',\"'\",'")}')`;
}

export async function openApp(scenario?: string): Promise<void> {
  await browser.url(scenario ? `/e2e.html?scenario=${scenario}` : '/e2e.html');
  await browser.$('nav.tabs').waitForDisplayed();
  // The badge text is also the fastest "first data painted" signal.
  await browser.$('.header .badge').waitForDisplayed();
}

export function buttonByText(text: string): Element {
  return browser.$(`//button[normalize-space()=${xpathString(text)}]`);
}

/** Substring regex for `toHaveText` assertions (dashes/braces stay literal). */
export function containing(part: string): RegExp {
  return new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

export async function clickNav(tab: 'profiles' | 'optimize' | 'benchmark' | 'hardware' | 'help', locale: Locale): Promise<void> {
  await buttonByText(LABELS[locale].nav[tab]).click();
}

/**
 * The candidate head button's normalized text also includes the score/
 * confidence/safety pills, so locate its dedicated title span instead.
 */
export function candidateTitle(text: string): Element {
  return browser.$(
    `//span[contains(@class,'candidate-title')][normalize-space()=${xpathString(text)}]`,
  );
}

export async function switchLocale(target: Locale): Promise<void> {
  await buttonByText(LOCALE_BUTTON[target]).click();
  // The i18n service does not write <html lang>; the localized Profiles nav
  // button is the observable "language actually switched" signal.
  await browser.waitUntil(
    () => buttonByText(LABELS[target].nav.profiles).isDisplayed().catch(() => false),
    { timeout: 5000, timeoutMsg: `locale never switched to ${target}` },
  );
}

export function profileCard(id: string): Element {
  return browser.$(
    `//li[contains(@class,'profile-card')][.//p[contains(@class,'mono-card-id') and normalize-space()=${xpathString(id)}]]`,
  );
}

/** Input nested in a <label> whose <span> is the localized field caption. */
export function inputByLabel(label: string): Element {
  return browser.$(
    `//label[.//span[normalize-space()=${xpathString(label)}]]//input`,
  );
}

/** <select> nested in a labelled field. */
export function selectByLabel(label: string): Element {
  return browser.$(
    `//label[.//span[normalize-space()=${xpathString(label)}]]//select`,
  );
}

/**
 * Selects an <option> by value in a labelled field and dispatches the change
 * event React binds to. wdio v9's classic selectOption helper is unavailable
 * against tauri-driver/WebView2, so the native setter + change event path is
 * used (the value is a real option value, not free text).
 */
export async function setSelectByLabel(label: string, value: string): Promise<void> {
  await browser.execute(
    (labelText: string, next: string) => {
      const span = Array.from(document.querySelectorAll('label.field > span')).find(
        (candidate) => candidate.textContent?.trim() === labelText,
      );
      const selectElement = span?.closest('label')?.querySelector('select');
      if (!selectElement) {
        throw new Error(`select not found for label: ${labelText}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (descriptor?.set) {
        descriptor.set.call(selectElement, next);
      } else {
        selectElement.value = next;
      }
      selectElement.dispatchEvent(new Event('change', { bubbles: true }));
    },
    label,
    value,
  );
}

export const CONTROL = '\uE009'; // WebDriver Control key
const ZOOM_KEY = '=';
const RESET_KEY = '0';

/** Sets Chromium page zoom via Ctrl+= and resets it in `after`. */
export async function withZoom(steps: number, body: () => Promise<void>): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await browser.keys([CONTROL, ZOOM_KEY]);
  }
  try {
    await body();
  } finally {
    await browser.keys([CONTROL, RESET_KEY]);
  }
}

/** True when the page has no horizontal overflow at the current viewport. */
export async function hasHorizontalOverflow(): Promise<boolean> {
  const result = await browser.execute(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  return Boolean(result);
}
