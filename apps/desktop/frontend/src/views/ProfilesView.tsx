/**
 * Profiles tab (M3-002): card grid over `profiles.list`, inline two-step
 * delete confirm (no blocking browser dialog), and navigation to the editor /
 * wizard / benchmark with the card's id handed off.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { I18nService, ResourceKey } from '@lmps/i18n/browser';
import { rpc } from '../api';
import { useTypedRpc } from '../hooks';
import type { ActivationApplyResult, ActivationStatus, LocalizedText, ProfileCard, ProfilesList } from '../types';

interface ProfilesViewProps {
  i18n: I18nService;
  /** Incremented after profile mutations so the list refetches. */
  refreshKey: number;
  onOpenEditor: (state: { mode: 'create' } | { mode: 'edit'; id: string }) => void;
  onOptimize: (profileId: string) => void;
  onBenchmark: (profileId: string) => void;
  onProfilesChanged: () => void;
}

/** Locale-first display name; falls back to en, then zh-CN. */
export function displayNameOf(i18n: I18nService, name: LocalizedText): string {
  const locale = i18n.getLocale();
  return name[locale] ?? name.en ?? name['zh-CN'] ?? '';
}

export function ProfilesView({
  i18n,
  refreshKey,
  onOpenEditor,
  onOptimize,
  onBenchmark,
  onProfilesChanged,
}: ProfilesViewProps) {
  const t = i18n.t;
  const [filter, setFilter] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Two-step applies mirror the delete-confirm pattern; replacement of a
  // non-empty active run needs the same confirmation the CLI `--yes` demands.
  const [confirmApplyId, setConfirmApplyId] = useState<string | null>(null);
  const [lastApplyId, setLastApplyId] = useState<string | null>(null);

  const list = useTypedRpc<ProfilesList>();
  const refetch = useCallback(() => list.run(() => rpc.profilesList()), [list]);
  useEffect(refetch, [refreshKey]);

  const active = useTypedRpc<ActivationStatus>();
  const apply = useTypedRpc<ActivationApplyResult>();
  useEffect(() => {
    // Same refreshKey cadence as the list: a deleted or edited profile can end
    // the active run, so the badge follows the storage truth.
    active.run(() => rpc.activationStatus());
  }, [refreshKey]);
  useEffect(() => {
    if (apply.state.kind !== 'done') return;
    active.run(() => rpc.activationStatus());
  }, [apply.state]);

  const remove = useTypedRpc<{ id: string }>();
  useEffect(() => {
    if (remove.state.kind !== 'done') return;
    setConfirmId(null);
    onProfilesChanged();
  }, [remove.state, onProfilesChanged]);

  const profiles = list.state.kind === 'done' ? list.state.value.profiles : [];
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return profiles;
    return profiles.filter(
      (profile) =>
        profile.id.toLowerCase().includes(needle) ||
        displayNameOf(i18n, profile.displayName).toLowerCase().includes(needle),
    );
  }, [profiles, filter, i18n]);

  const onDeleteConfirm = (id: string) => {
    setConfirmId(null);
    remove.run(() => rpc.profilesDelete(id));
  };

  const startApply = (card: ProfileCard) => {
    setConfirmApplyId(null);
    setLastApplyId(card.id);
    apply.run(() => rpc.activationApply(card.id));
  };

  const confirmOrApply = (card: ProfileCard) => {
    const current = active.state.kind === 'done' ? active.state.value.active : null;
    if (current !== null && current.profileId !== card.id) setConfirmApplyId(card.id);
    else startApply(card);
  };

  /** A card is current when its id matches, or (mock adapter reports none) the loaded model. */
  const isActive = (card: ProfileCard): boolean => {
    const current = active.state.kind === 'done' ? active.state.value.active : null;
    if (current === null) return false;
    if (current.profileId !== null) return current.profileId === card.id;
    return current.modelKey === card.model.modelKey;
  };

  const taskLabel = (card: ProfileCard): string => {
    // TASK_KINDS all carry desktop.tasks.* labels; unknown kinds fall back to
    // i18next returning the raw key, so show the free-form task.type instead.
    if (card.task.kind === null) return card.task.type;
    const key = `desktop.tasks.${card.task.kind}` as ResourceKey;
    const label = t(key);
    return label === key ? card.task.type : label;
  };

  const lastApplyCard = lastApplyId === null ? null : (profiles.find((p) => p.id === lastApplyId) ?? null);

  const applyBanner = () => {
    if (apply.state.kind === 'done' && lastApplyCard !== null) {
      const name = displayNameOf(i18n, lastApplyCard.displayName) || lastApplyCard.id;
      const result = apply.state.value;
      if (result.outcome === 'active') {
        return (
          <p className="success" role="status">
            {result.alreadyActive ? t('apply.idempotent', { name }) : t('apply.activated', { name })}
          </p>
        );
      }
      return (
        <p className="error" role="status">
          {result.outcome === 'canceled' && t('apply.canceled')}
          {result.outcome === 'failed-but-recovered' && t('apply.recovered', { name })}
          {result.outcome === 'failed' && t('apply.failed')}
        </p>
      );
    }
    return null;
  };

  return (
    <div className="profiles-view">
      <div className="view-head">
        <h2>{t('desktop.profiles.title')}</h2>
        <button type="button" onClick={() => onOpenEditor({ mode: 'create' })}>
          {t('desktop.profiles.new')}
        </button>
      </div>

      <input
        type="search"
        className="filter"
        placeholder={t('desktop.profiles.filter')}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        aria-label={t('desktop.profiles.filter')}
      />

      {list.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, list.state.failure)}</p>}
      {apply.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, apply.state.failure)}</p>}
      {applyBanner()}
      {list.state.kind === 'running' && profiles.length === 0 && (
        <p className="running" aria-live="polite">…</p>
      )}

      {visible.length === 0 ? (
        <p className="muted">{filter.trim() === '' ? t('desktop.profiles.empty') : t('desktop.profiles.nothing')}</p>
      ) : (
        <ul className="card-grid">
          {visible.map((card) => (
            <li key={card.id} className="profile-card">
              <div className="profile-card-main">
                <h3>
                  {displayNameOf(i18n, card.displayName)}
                  {isActive(card) && <span className="pill pill-active">{t('desktop.profiles.activeBadge')}</span>}
                </h3>
                <p className="mono-card-id">{card.id}</p>
                <p className="muted">
                  {card.model.modelKey}
                  {card.task.kind !== null && <span className="pill">{taskLabel(card)}</span>}
                </p>
                <p className="timestamp">{t('desktop.profiles.updatedAt', { at: card.updatedAt })}</p>
              </div>
              {confirmId === card.id ? (
                <div className="confirm-row">
                  <span>{t('desktop.profiles.confirmDelete', { name: displayNameOf(i18n, card.displayName) })}</span>
                  <span className="btn-row">
                    <button type="button" onClick={() => onDeleteConfirm(card.id)}>
                      {t('common.confirm')}
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)}>
                      {t('common.cancel')}
                    </button>
                  </span>
                </div>
              ) : confirmApplyId === card.id ? (
                <div className="confirm-row">
                  <span>{t('desktop.profiles.applyConfirm', { name: displayNameOf(i18n, card.displayName) })}</span>
                  <span className="btn-row">
                    <button type="button" onClick={() => startApply(card)}>
                      {t('common.confirm')}
                    </button>
                    <button type="button" onClick={() => setConfirmApplyId(null)}>
                      {t('common.cancel')}
                    </button>
                  </span>
                </div>
              ) : (
                <div className="profile-card-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={apply.state.kind === 'running'}
                    onClick={() => confirmOrApply(card)}
                  >
                    {apply.state.kind === 'running' && lastApplyId === card.id
                      ? t('desktop.profiles.applying')
                      : t('desktop.profiles.apply')}
                  </button>
                  <button type="button" onClick={() => onOptimize(card.id)}>
                    {t('desktop.profiles.optimize')}
                  </button>
                  <button type="button" onClick={() => onBenchmark(card.id)}>
                    {t('desktop.profiles.benchmark')}
                  </button>
                  <button type="button" onClick={() => onOpenEditor({ mode: 'edit', id: card.id })}>
                    {t('desktop.profiles.edit')}
                  </button>
                  <button type="button" onClick={() => setConfirmId(card.id)}>
                    {t('desktop.profiles.delete')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders a stable code → i18n message; unknown codes keep their raw text. */
export function rpcFailureText(i18n: I18nService, failure: { code: string; message: string }): string {
  const map: Record<string, ResourceKey> = {
    LM_UNREACHABLE: 'desktop.error.rpc.lmUnreachable',
    STORE_NOT_FOUND: 'desktop.error.rpc.profileNotFound',
    STORE_ALREADY_EXISTS: 'desktop.error.rpc.alreadyExists',
    PROFILE_INVALID: 'desktop.error.rpc.profileInvalid',
    OPTIMIZE_REFUSED: 'desktop.error.rpc.optimizeRefused',
    BENCHMARK_BATTERY_GUARD: 'desktop.error.rpc.batteryGuard',
    BENCHMARK_LOCK_BUSY: 'desktop.error.rpc.lockBusy',
    METHOD_UNSUPPORTED: 'desktop.error.rpc.methodUnsupported',
  };
  const key = map[failure.code];
  if (key !== undefined) return i18n.t(key);
  return i18n.t('desktop.error.rpc.unknown', { message: failure.message });
}