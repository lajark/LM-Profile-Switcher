import { useCallback, useState } from 'react';
import {
  SUPPORTED_LOCALES,
  type I18nService,
  type Locale,
  type ResourceKey,
} from '@lmps/i18n/browser';
import type { SidecarStatusName } from './api';
import { useLocale, useSidecarStatus } from './hooks';
import { ProfilesView } from './views/ProfilesView';
import { EditorView, type EditorState } from './views/EditorView';
import { OptimizeView } from './views/OptimizeView';
import { BenchmarkView } from './views/BenchmarkView';
import { HardwareView } from './views/HardwareView';

export type Tab = 'profiles' | 'optimize' | 'benchmark' | 'hardware';

const NAV_LABELS: Record<Tab, ResourceKey> = {
  profiles: 'desktop.nav.profiles',
  optimize: 'desktop.nav.optimize',
  benchmark: 'desktop.nav.benchmark',
  hardware: 'desktop.nav.hardware',
};

const STATUS_LABELS: Record<SidecarStatusName, ResourceKey> = {
  starting: 'desktop.status.connecting',
  connected: 'desktop.status.connected',
  disconnected: 'desktop.status.disconnected',
  'auth-failed': 'desktop.status.authFailed',
};

const LOCALE_LABELS: Record<Locale, ResourceKey> = {
  'zh-CN': 'desktop.locale.zhCN',
  en: 'desktop.locale.en',
};

/** Cross-view handoff: which profile a wizard tab should start on. */
export interface ProfileHandoff {
  app: 'optimize' | 'benchmark';
  profileId: string;
}

interface AppProps {
  i18n: I18nService;
}

/**
 * Desktop Profile & Wizard shell (M3-002): tab navigation over the four
 * product views. Optimize and Benchmark accept a profile handoff from the
 * Profiles cards; the Editor opens inline inside the profiles tab.
 */
export function App({ i18n }: AppProps) {
  useLocale(i18n);
  const status = useSidecarStatus();
  const [tab, setTab] = useState<Tab>('profiles');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [handoff, setHandoff] = useState<ProfileHandoff | null>(null);
  // Bumped after profile mutations so open lists refetch.
  const [profilesVersion, setProfilesVersion] = useState(0);
  const locale = i18n.getLocale();

  // Stable handlers: views' success-effect deps reference them, so a fresh
  // identity every render would re-trigger (and re-fire) after each mutation.
  const openOptimize = useCallback((profileId?: string) => {
    setHandoff(profileId === undefined ? null : { app: 'optimize', profileId });
    setTab('optimize');
  }, []);

  const openBenchmark = useCallback((profileId?: string) => {
    setHandoff(profileId === undefined ? null : { app: 'benchmark', profileId });
    setTab('benchmark');
  }, []);

  const onProfilesChanged = useCallback(() => setProfilesVersion((version) => version + 1), []);
  const onHandoffConsumed = useCallback(() => setHandoff(null), []);
  const onSaved = useCallback(() => {
    setEditor(null);
    onProfilesChanged();
  }, [onProfilesChanged]);

  const initialOptimizeId = handoff?.app === 'optimize' ? handoff.profileId : null;
  const initialBenchmarkId = handoff?.app === 'benchmark' ? handoff.profileId : null;

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>{i18n.t('app.name')}</h1>
          <p className="descriptor">{i18n.t('app.descriptor')}</p>
        </div>
        <div className="header-right">
          <span className={`badge badge-${status}`}>{i18n.t(STATUS_LABELS[status])}</span>
        </div>
      </header>

      <nav className="tabs" aria-label={i18n.t('app.name')}>
        {(['profiles', 'optimize', 'benchmark', 'hardware'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? 'active' : undefined}
            aria-selected={tab === item}
            onClick={() => {
              setEditor(null);
              setTab(item);
            }}
          >
            {i18n.t(NAV_LABELS[item])}
          </button>
        ))}
        <span className="tabs-spacer" />
        <span className="locale-label">{i18n.t('desktop.locale.label')}</span>
        {SUPPORTED_LOCALES.map((item) => (
          <button
            key={item}
            type="button"
            className={item === locale ? 'active' : undefined}
            disabled={item === locale}
            onClick={() => i18n.setLocale(item)}
          >
            {i18n.t(LOCALE_LABELS[item])}
          </button>
        ))}
      </nav>

      <main className="view">
        {tab === 'profiles' &&
          (editor === null ? (
            <ProfilesView
              i18n={i18n}
              refreshKey={profilesVersion}
              onOpenEditor={setEditor}
              onOptimize={openOptimize}
              onBenchmark={openBenchmark}
              onProfilesChanged={onProfilesChanged}
            />
          ) : (
            <EditorView i18n={i18n} state={editor} onSaved={onSaved} onCancel={() => setEditor(null)} />
          ))}

        {tab === 'optimize' && (
          <OptimizeView
            i18n={i18n}
            initialProfileId={initialOptimizeId}
            onConsumed={onHandoffConsumed}
            onProfilesChanged={onProfilesChanged}
          />
        )}

        {tab === 'benchmark' && (
          <BenchmarkView
            i18n={i18n}
            initialProfileId={initialBenchmarkId}
            onConsumed={onHandoffConsumed}
          />
        )}

        {tab === 'hardware' && <HardwareView i18n={i18n} />}
      </main>

      <footer className="footer-disclaimer">{i18n.t('desktop.footer.disclaimer')}</footer>
    </div>
  );
}