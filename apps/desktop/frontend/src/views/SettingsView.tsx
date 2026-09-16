import type { I18nService } from '@lmps/i18n/browser';

interface SettingsViewProps {
  i18n: I18nService;
}

export function SettingsView({ i18n }: SettingsViewProps) {
  const t = i18n.t;
  return (
    <div className="settings-view">
      <div className="view-head"><h2>{t('desktop.settings.title')}</h2></div>
      <section className="settings-panel">
        <h3>{t('desktop.settings.language')}</h3>
        <p className="muted">{t('desktop.settings.languageHint')}</p>
        <div className="notice">{t('desktop.settings.placeholder')}</div>
      </section>
    </div>
  );
}
