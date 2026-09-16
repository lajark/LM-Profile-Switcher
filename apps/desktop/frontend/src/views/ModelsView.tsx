import { useEffect, useMemo, useState } from 'react';
import type { I18nService, ResourceKey } from '@lmps/i18n/browser';
import { rpc } from '../api';
import { useTypedRpc } from '../hooks';
import type { ModelContextItem, ModelContextProjection, ReadinessStatus } from '../types';
import { ModelContextView } from './ModelContextView';
import { rpcFailureText } from './ProfilesView';

interface ModelsViewProps {
  i18n: I18nService;
  refreshKey: number;
  onBenchmark: (profileId: string) => void;
  onOpenEditor: (state: { mode: 'create' } | { mode: 'edit'; id: string }) => void;
  onProfilesChanged: () => void;
}

const STATUS_LABELS: Record<ReadinessStatus, ResourceKey> = {
  ready: 'desktop.models.status.ready',
  partial: 'desktop.models.status.partial',
  offline: 'desktop.models.status.offline',
  unavailable: 'desktop.models.status.unavailable',
  unknown: 'desktop.models.status.unknown',
};

function modelLabel(model: ModelContextItem['model']): string {
  const parts = [model.family, model.quantization].filter((part): part is string => part !== null && part !== '');
  return parts.length === 0 ? '' : parts.join(' · ');
}

export function ModelsView({ i18n, refreshKey, onBenchmark, onOpenEditor, onProfilesChanged }: ModelsViewProps) {
  const t = i18n.t;
  const [filter, setFilter] = useState('');
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const context = useTypedRpc<ModelContextProjection>();

  useEffect(() => {
    context.run(() => rpc.modelsContext());
  }, [refreshKey]);

  const models = context.state.kind === 'done' ? context.state.value.models : [];
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return models;
    return models.filter((item) => {
      const modelName = item.model.modelKey.toLowerCase();
      const family = item.model.family?.toLowerCase() ?? '';
      return modelName.includes(needle) || family.includes(needle);
    });
  }, [filter, models]);

  const selected = selectedModelKey === null ? null : models.find((item) => item.model.modelKey === selectedModelKey) ?? null;

  if (selected !== null) {
    return (
      <ModelContextView
        i18n={i18n}
        item={selected}
        needsOrganization={context.state.kind === 'done' ? context.state.value.needsOrganization : []}
        onBack={() => setSelectedModelKey(null)}
        onBenchmark={onBenchmark}
        onOpenEditor={onOpenEditor}
        onProfilesChanged={onProfilesChanged}
      />
    );
  }

  const readiness = context.state.kind === 'done' ? context.state.value.readiness : null;
  const statusCard = (
    key: 'hardware' | 'lmStudio' | 'discovery',
    status: ReadinessStatus | null,
    detail: string,
  ) => (
    <article className="readiness-card" data-status={status ?? 'unknown'}>
      <span className="status-dot" aria-hidden="true" />
      <div>
        <h3>{t(`desktop.models.readiness.${key}` as ResourceKey)}</h3>
        <strong>{t(status === null ? 'desktop.models.status.unknown' : STATUS_LABELS[status])}</strong>
        <p className="muted">{detail}</p>
      </div>
    </article>
  );

  return (
    <div className="models-view">
      <div className="view-head models-heading">
        <div>
          <h2>{t('desktop.models.title')}</h2>
          <p className="descriptor">{t('desktop.models.subtitle')}</p>
        </div>
        <button type="button" onClick={() => context.run(() => rpc.modelsContext())} disabled={context.state.kind === 'running'}>
          {t('desktop.models.refresh')}
        </button>
      </div>

      <div className="models-toolbar">
        <input
          type="search"
          className="filter"
          placeholder={t('desktop.models.filter')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label={t('desktop.models.filter')}
        />
        {context.state.kind === 'running' && <span className="muted">{t('desktop.models.refreshing')}</span>}
      </div>

      {context.state.kind === 'error' && (
        <div className="empty-panel">
          <p className="error">{rpcFailureText(i18n, context.state.failure)}</p>
          <button type="button" onClick={() => context.run(() => rpc.modelsContext())}>{t('desktop.models.retry')}</button>
        </div>
      )}

      <section className="readiness-grid" aria-label={t('desktop.models.preparation')}>
        {statusCard(
          'hardware',
          readiness?.hardware.status ?? null,
          readiness?.hardware.status === 'ready' ? t('desktop.models.readiness.hardwareReady') : t('desktop.models.readiness.hardwareHelp'),
        )}
        {statusCard(
          'lmStudio',
          readiness?.lmStudio.status ?? null,
          readiness?.lmStudio.version
            ? t('desktop.models.readiness.version', { version: readiness.lmStudio.version })
            : t('desktop.models.readiness.lmStudioHelp'),
        )}
        {statusCard(
          'discovery',
          readiness?.discovery.status ?? null,
          models.length > 0
            ? t('desktop.models.readiness.modelCount', { count: models.length })
            : t('desktop.models.readiness.discoveryHelp'),
        )}
      </section>

      <section className="runtime-card">
        <div>
          <span className="eyebrow">{t('desktop.models.runtime.title')}</span>
          <h3>
            {readiness?.runtime.active?.modelKey ?? t('desktop.models.runtime.none')}
          </h3>
        </div>
        <span className="pill">{t(readyRuntimeKey(readiness?.runtime.status))}</span>
      </section>

      {context.state.kind === 'done' && context.state.value.needsOrganization.length > 0 && (
        <div className="notice notice-warning">
          <strong>{t('desktop.models.needsOrganization')}</strong>
          <span>{context.state.value.needsOrganization.map((entry) => entry.id).join(', ')}</span>
        </div>
      )}

      {context.state.kind === 'done' && models.length === 0 ? (
        <div className="empty-panel">
          <h3>{t('desktop.models.empty.title')}</h3>
          <p className="muted">{t('desktop.models.empty.body')}</p>
          <button type="button" onClick={() => context.run(() => rpc.modelsContext())}>{t('desktop.models.retry')}</button>
        </div>
      ) : visible.length === 0 ? (
        <p className="muted">{t('desktop.models.empty.filtered')}</p>
      ) : (
        <section>
          <div className="section-heading">
            <h3>{t('desktop.models.listTitle')}</h3>
            <span className="muted">{t('desktop.models.listCount', { count: visible.length })}</span>
          </div>
          <ul className="model-grid">
            {visible.map((item) => (
              <li key={item.model.modelKey} className="model-card">
                <div className="model-card-main">
                  <div className="model-card-title">
                    <h3>{item.model.modelKey}</h3>
                    {item.model.loaded === true && <span className="pill pill-active">{t('desktop.models.status.running')}</span>}
                  </div>
                  <p className="muted">{modelLabel(item.model) || t('desktop.models.modelDetailsUnknown')}</p>
                  <p className="mono-card-id">{item.model.parametersB === null ? t('desktop.models.parametersUnknown') : t('desktop.models.parameters', { value: item.model.parametersB })}</p>
                  <div className="meta-row">
                    <span className={`pill ${item.availability === 'available' ? 'pill-safe' : 'pill-low'}`}>
                      {t(availabilityKey(item.availability))}
                    </span>
                    <span className="pill">{t('desktop.models.scenarioCount', { count: item.scenarios.length })}</span>
                  </div>
                </div>
                <div className="model-card-actions">
                  <button type="button" className="primary" onClick={() => setSelectedModelKey(item.model.modelKey)}>
                    {t('desktop.models.viewDetails')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function availabilityKey(value: ModelContextItem['availability']): ResourceKey {
  if (value === 'available') return 'desktop.models.availability.available';
  if (value === 'missing') return 'desktop.models.availability.missing';
  return 'desktop.models.availability.unknown';
}

function readyRuntimeKey(value: 'idle' | 'running' | 'unknown' | undefined): ResourceKey {
  if (value === 'running') return 'desktop.models.status.running';
  if (value === 'idle') return 'desktop.models.status.idle';
  return 'desktop.models.status.unknown';
}
