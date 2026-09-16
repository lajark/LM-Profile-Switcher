import { useEffect, useMemo, useState } from 'react';
import type { I18nService, ResourceKey } from '@lmps/i18n/browser';
import { rpc } from '../api';
import { useTypedRpc } from '../hooks';
import type { ActivationApplyResult, ActivationStatus, ModelContextItem, ModelProfileContext, ProfilesMeta, ScenarioContext } from '../types';
import { displayNameOf, rpcFailureText } from './ProfilesView';
import { ModelOptimizationView } from './ModelOptimizationView';

interface ModelContextViewProps {
  i18n: I18nService;
  item: ModelContextItem;
  needsOrganization: Array<{ id: string; reason: 'unclassifiable-model-or-scenario' }>;
  onBack: () => void;
  onBenchmark: (profileId: string) => void;
  onOpenEditor: (state: { mode: 'create' } | { mode: 'edit'; id: string }) => void;
  onProfilesChanged: () => void;
}

export function ModelContextView({ i18n, item, needsOrganization, onBack, onBenchmark, onOpenEditor, onProfilesChanged }: ModelContextViewProps) {
  const t = i18n.t;
  const [scenarioType, setScenarioType] = useState(item.scenarios[0]?.type ?? 'quick-chat');
  const [confirmProfileId, setConfirmProfileId] = useState<string | null>(null);
  const [confirmSafeStart, setConfirmSafeStart] = useState(false);
  const [lastApplyId, setLastApplyId] = useState<string | null>(null);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [showOptimization, setShowOptimization] = useState(false);
  const setDefault = useTypedRpc<{ default: { profileId: string } }>();
  const active = useTypedRpc<ActivationStatus>();
  const apply = useTypedRpc<ActivationApplyResult>();
  const safeStart = useTypedRpc<ActivationApplyResult>();
  const taskMeta = useTypedRpc<ProfilesMeta>();

  useEffect(() => {
    if (setDefault.state.kind === 'done') onProfilesChanged();
  }, [onProfilesChanged, setDefault.state.kind]);

  useEffect(() => {
    setScenarioType(item.scenarios[0]?.type ?? 'quick-chat');
    setConfirmSafeStart(false);
    active.run(() => rpc.activationStatus());
    taskMeta.run(() => rpc.profilesMeta());
  }, [item.model.modelKey]);

  useEffect(() => {
    if (safeStart.state.kind === 'done') active.run(() => rpc.activationStatus());
  }, [safeStart.state.kind]);

  const scenario = useMemo(
    () => item.scenarios.find((entry) => entry.type === scenarioType) ?? item.scenarios[0] ?? null,
    [item.scenarios, scenarioType],
  );

  const selectedProfile = scenario?.profiles.find((profile) => profile.id === defaultProfileId || (defaultProfileId === null && profile.isDefault))
    ?? (scenario?.profiles.length === 1 ? scenario.profiles[0] ?? null : null);
  const currentActive = active.state.kind === 'done' ? active.state.value.active : null;

  const beginOptimization = () => {
    if (scenario === null || scenario.profiles.length === 0) {
      setShowOptimization(true);
      return;
    }
    if (selectedProfile === null) {
      onOpenEditor({ mode: 'create' });
      return;
    }
    setShowOptimization(true);
  };

  const launchSafe = () => {
    setConfirmSafeStart(false);
    safeStart.run(() => rpc.activationStartSafe(item.model.modelKey, scenario?.type ?? scenarioType));
  };

  const startSafe = () => {
    if (currentActive !== null && currentActive.modelKey !== item.model.modelKey) {
      setConfirmSafeStart(true);
      return;
    }
    launchSafe();
  };


  const applyProfile = (profile: ModelProfileContext) => {
    setConfirmProfileId(null);
    setLastApplyId(profile.id);
    apply.run(() => rpc.activationApply(profile.id));
  };

  const chooseDefault = (profile: ModelProfileContext) => {
    setDefault.run(() => rpc.defaultsSet(profile.id));
    setDefaultProfileId(profile.id);
  };

  const applyOrConfirm = (profile: ModelProfileContext) => {
    if (
      currentActive !== null &&
      (currentActive.profileId !== profile.id || currentActive.modelKey !== item.model.modelKey)
    ) {
      setConfirmProfileId(profile.id);
      return;
    }
    applyProfile(profile);
  };

  const evidenceLabel = (evidence: ScenarioContext['evidence']): ResourceKey => {
    switch (evidence) {
      case 'current': return 'desktop.models.evidence.current';
      case 'stale': return 'desktop.models.evidence.stale';
      case 'changed-environment': return 'desktop.models.evidence.changed';
      case 'partial': return 'desktop.models.evidence.partial';
      default: return 'desktop.models.evidence.unmeasured';
    }
  };

  return (
    <div className="model-context-view">
      <div className="view-head">
        <div>
          <button type="button" className="back-button" onClick={onBack}>{t('desktop.models.back')}</button>
          <h2>{item.model.modelKey}</h2>
          <p className="descriptor">{item.model.family ?? t('desktop.models.modelFamilyUnknown')}</p>
        </div>
        <span className={`pill ${item.availability === 'available' ? 'pill-safe' : 'pill-low'}`}>
          {t(availabilityKey(item.availability))}
        </span>
      </div>

      {item.availability === 'missing' && <div className="notice notice-warning">{t('desktop.models.warning.missing')}</div>}
      {item.availability === 'unknown' && <div className="notice notice-warning">{t('desktop.models.warning.unknown')}</div>}
      {needsOrganization.length > 0 && (
        <div className="notice notice-warning">
          <strong>{t('desktop.models.needsOrganization')}</strong>
          <span>{needsOrganization.map((entry) => entry.id).join(', ')}</span>
        </div>
      )}

      {showOptimization ? (
        <ModelOptimizationView
          i18n={i18n}
          modelKey={item.model.modelKey}
          scenarioType={scenario?.type ?? scenarioType}
          baseline={selectedProfile}
          onCancel={() => setShowOptimization(false)}
          onSaved={() => { setShowOptimization(false); onProfilesChanged(); }}
        />
      ) : item.scenarios.length === 0 ? (
        <section className="empty-panel no-profile-panel">
          <h3>{t('desktop.models.scenario.none')}</h3>
          <p className="muted">{t('desktop.models.empty.noProfiles')}</p>
          <label className="field">
            <span>{t('desktop.models.scenario.select')}</span>
            <select value={scenarioType} onChange={(event) => setScenarioType(event.target.value)}>
              {(taskMeta.state.kind === 'done' && taskMeta.state.value.taskKinds.length > 0 ? taskMeta.state.value.taskKinds : ['quick-chat']).map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <div className="profile-context-actions">
            <button type="button" className="primary" onClick={beginOptimization}>
              {t('desktop.models.optimize')}
            </button>
            <button type="button" disabled={item.availability !== 'available' || safeStart.state.kind === 'running'} onClick={startSafe}>
              {t('desktop.models.launch.safeDefault')}
            </button>
          </div>
          {confirmSafeStart && (
            <div className="confirm-row">
              <span>{t('desktop.models.warning.replace')}</span>
              <button type="button" onClick={launchSafe}>{t('common.confirm')}</button>
              <button type="button" onClick={() => setConfirmSafeStart(false)}>{t('common.cancel')}</button>
            </div>
          )}
          <p className="muted">{t('desktop.models.launch.safeHint')}</p>
        </section>
      ) : scenario !== null ? (
        <>
          <section className="context-toolbar">
            <label className="field">
              <span>{t('desktop.models.scenario.select')}</span>
              <select value={scenario.type} onChange={(event) => setScenarioType(event.target.value)}>
                {item.scenarios.map((entry) => <option key={entry.type} value={entry.type}>{entry.type}</option>)}
              </select>
            </label>
            <div className="scenario-summary">
              <span className={`pill ${scenario.evidence === 'current' ? 'pill-safe' : 'pill-low'}`}>
                {t(evidenceLabel(scenario.evidence))}
              </span>
              <span className="muted">{t('desktop.models.benchmarkCount', { count: scenario.benchmarkCount })}</span>
            </div>
          </section>

          <section className="context-section">
            <div className="section-heading">
              <div>
                <h3>{t('desktop.models.profiles.title')}</h3>
                <p className="muted">{t('desktop.models.profiles.description')}</p>
              </div>
              <button type="button" onClick={beginOptimization}>
                {t('desktop.models.optimize')}
              </button>
            </div>

            {scenario.defaultState === 'stale' && (
              <div className="notice notice-warning">{t('desktop.models.default.stale')}</div>
            )}
            {scenario.profiles.length === 0 ? (
              <div className="empty-panel compact">
                <p className="muted">{t('desktop.models.empty.noProfiles')}</p>
                <button type="button" className="primary" onClick={beginOptimization}>{t('desktop.models.optimize')}</button>
              </div>
            ) : (
              <ul className="context-profile-list">
                {scenario.profiles.map((profile) => (
                  <li key={profile.id} className={`context-profile ${profile.isDefault ? 'is-default' : ''}`}>
                    <div>
                      <div className="context-profile-name">
                        <strong>{displayNameOf(i18n, profile.displayName) || profile.id}</strong>
                        {profile.isDefault && <span className="pill pill-high">{t('desktop.models.default.badge')}</span>}
                      </div>
                      <p className="mono-card-id">{profile.id}</p>
                      <span className={`pill ${profile.evidence === 'current' ? 'pill-safe' : 'pill-low'}`}>
                        {t(evidenceKey(profile.evidence))}
                      </span>
                    </div>
                    <div className="profile-context-actions">
                      <button type="button" onClick={() => onBenchmark(profile.id)}>{t('desktop.models.benchmark')}</button>                      {!profile.isDefault && defaultProfileId !== profile.id && (
                        <button type="button" disabled={setDefault.state.kind === 'running'} onClick={() => chooseDefault(profile)}>
                          {t('desktop.models.default.set')}
                        </button>
                      )}
                      <button type="button" className="primary" disabled={apply.state.kind === 'running'} onClick={() => applyOrConfirm(profile)}>
                        {apply.state.kind === 'running' && lastApplyId === profile.id ? t('desktop.models.starting') : t('desktop.models.start')}
                      </button>
                      {confirmProfileId === profile.id && (
                        <div className="confirm-row">
                          <span>{t('desktop.models.warning.replace')}</span>
                          <button type="button" onClick={() => applyProfile(profile)}>{t('common.confirm')}</button>
                          <button type="button" onClick={() => setConfirmProfileId(null)}>{t('common.cancel')}</button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="launch-panel">
            <div>
              <span className="eyebrow">{t('desktop.models.launch.title')}</span>
              <h3>{selectedProfile ? displayNameOf(i18n, selectedProfile.displayName) : t('desktop.models.launch.none')}</h3>
              <p className="muted">
                {scenario.defaultState === 'available'
                  ? t('desktop.models.launch.defaultHint')
                  : scenario.defaultState === 'stale'
                    ? t('desktop.models.launch.staleHint')
                    : scenario.profiles.length > 1
                      ? t('desktop.models.default.choose')
                      : t('desktop.models.launch.unmeasured')}
              </p>
            </div>
            {selectedProfile !== null && (
              <button type="button" className="primary" disabled={apply.state.kind === 'running'} onClick={() => applyOrConfirm(selectedProfile!)}>
                {t('desktop.models.start')}
              </button>
            )}
          </section>

          {scenario.benchmarks.length > 0 && (
            <section className="context-section">
              <div className="section-heading"><h3>{t('desktop.models.benchmarks.title')}</h3></div>
              <ul className="benchmark-history">
                {scenario.benchmarks.map((benchmark) => (
                  <li key={benchmark.id}>
                    <span className="mono-card-id">{benchmark.id}</span>
                    <span className={`pill ${benchmark.status === 'completed' ? 'pill-safe' : 'pill-low'}`}>{t(benchmarkStatusKey(benchmark.status))}</span>
                    <span className="pill">{t(evidenceKey(benchmark.evidence))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}

      {setDefault.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, setDefault.state.failure)}</p>}
      {setDefault.state.kind === 'done' && <p className="success" role="status">{t('desktop.models.default.saved')}</p>}
      {apply.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, apply.state.failure)}</p>}
      {apply.state.kind === 'done' && lastApplyId !== null && (
        <p className={apply.state.value.outcome === 'active' ? 'success' : 'error'} role="status">
          {apply.state.value.outcome === 'active' ? t('desktop.models.started') : t('desktop.models.startFailed')}
        </p>
      )}
      {safeStart.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, safeStart.state.failure)}</p>}
      {safeStart.state.kind === 'done' && (
        <p className={safeStart.state.value.outcome === 'active' ? 'success' : 'error'} role="status">
          {safeStart.state.value.outcome === 'active' ? t('desktop.models.started') : t('desktop.models.startFailed')}
        </p>
      )}
      {active.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, active.state.failure)}</p>}
      <button type="button" className="text-button" onClick={() => onOpenEditor({ mode: 'create' })}>{t('desktop.models.legacyEdit')}</button>
    </div>
  );
}

function evidenceKey(value: ModelProfileContext['evidence']): ResourceKey {
  if (value === 'current') return 'desktop.models.evidence.current';
  if (value === 'stale') return 'desktop.models.evidence.stale';
  if (value === 'changed-environment') return 'desktop.models.evidence.changed';
  if (value === 'partial') return 'desktop.models.evidence.partial';
  return 'desktop.models.evidence.unmeasured';
}

function benchmarkStatusKey(value: 'completed' | 'failed' | 'canceled'): ResourceKey {
  if (value === 'completed') return 'desktop.benchmark.status.ok';
  if (value === 'failed') return 'desktop.benchmark.status.failed';
  return 'desktop.benchmark.status.canceled';
}

function availabilityKey(value: ModelContextItem['availability']): ResourceKey {
  if (value === 'available') return 'desktop.models.availability.available';
  if (value === 'missing') return 'desktop.models.availability.missing';
  return 'desktop.models.availability.unknown';
}
