/**
 * Help tab (post-0.2.1): in-window installation and usage guide. Renders only
 * localized copy (every string goes through i18n), and offers a local font
 * size control so the guide stays readable at high DPI / zoom. No navigation
 * away from the app and no external assets are involved.
 */
import { useState } from 'react';
import type { I18nService, ResourceKey } from '@lmps/i18n/browser';

interface HelpViewProps {
  i18n: I18nService;
}

const BASE_FONT_PX = 15;
const MIN_FONT_PX = 12;
const MAX_FONT_PX = 20;
const FONT_STEP_PX = 1;

const INSTALL_STEP_KEYS: ResourceKey[] = [
  'desktop.help.install.step1',
  'desktop.help.install.step2',
  'desktop.help.install.step3',
  'desktop.help.install.step4',
];

const USAGE_STEP_KEYS: ResourceKey[] = [
  'desktop.help.usage.step1',
  'desktop.help.usage.step2',
  'desktop.help.usage.step3',
  'desktop.help.usage.step4',
  'desktop.help.usage.step5',
  'desktop.help.usage.step6',
];

export function HelpView({ i18n }: HelpViewProps) {
  const t = i18n.t;
  const [fontPx, setFontPx] = useState(BASE_FONT_PX);

  return (
    <div className="help-view" style={{ fontSize: `${fontPx}px` }}>
      <div className="view-head">
        <h2>{t('desktop.help.title')}</h2>
        <div className="btn-row font-controls">
          <button
            type="button"
            aria-label={t('desktop.help.font.smaller')}
            disabled={fontPx <= MIN_FONT_PX}
            onClick={() => setFontPx((size) => Math.max(MIN_FONT_PX, size - FONT_STEP_PX))}
          >
            A−
          </button>
          <button
            type="button"
            aria-label={t('desktop.help.font.larger')}
            disabled={fontPx >= MAX_FONT_PX}
            onClick={() => setFontPx((size) => Math.min(MAX_FONT_PX, size + FONT_STEP_PX))}
          >
            A+
          </button>
        </div>
      </div>

      <section className="help-section">
        <h3 className="subsection">{t('desktop.help.intro.heading')}</h3>
        <p>{t('desktop.help.intro.body')}</p>
      </section>

      <section className="help-section">
        <h3 className="subsection">{t('desktop.help.install.heading')}</h3>
        <ol>
          {INSTALL_STEP_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
      </section>

      <section className="help-section">
        <h3 className="subsection">{t('desktop.help.usage.heading')}</h3>
        <ol>
          {USAGE_STEP_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
      </section>

      <section className="help-section">
        <h3 className="subsection">{t('desktop.help.data.heading')}</h3>
        <p>{t('desktop.help.data.body')}</p>
      </section>

      <section className="help-section">
        <h3 className="subsection">{t('desktop.help.limits.heading')}</h3>
        <p>{t('desktop.help.limits.body')}</p>
      </section>
    </div>
  );
}
