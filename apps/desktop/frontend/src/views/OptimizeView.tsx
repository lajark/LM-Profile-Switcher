/**
 * Candidate optimizer wizard (M3-002): pick a baseline profile → preview the
 * recommendation → inspect candidate diffs and bilingual rationale → save the
 * rule-recommended profile. The save policy lives in the sidecar (mirrors the
 * CLI `--yes` path): it refuses on no-safe-candidate / low-confidence, so the
 * UI mirrors those states and surfaces the same codes when a save is refused.
 */
import { useEffect, useState } from 'react';
import type { I18nService, ResourceKey } from '@lmps/i18n/browser';
import { rpc } from '../api';
import { useTypedRpc } from '../hooks';
import type { CandidateView, ProfilesList, RecommendationView } from '../types';
import { displayNameOf, rpcFailureText } from './ProfilesView';

interface OptimizeViewProps {
  i18n: I18nService;
  initialProfileId: string | null;
  /** Clears the App-level handoff once the initial profile has been consumed. */
  onConsumed: () => void;
  /** Bumps the profiles list so a freshly-saved recommended profile shows up. */
  onProfilesChanged: () => void;
}

const GIB = 1024 ** 3;

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

export function OptimizeView({
  i18n,
  initialProfileId,
  onConsumed,
  onProfilesChanged,
}: OptimizeViewProps) {
  const t = i18n.t;
  const [pid, setPid] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saveStartPid, setSaveStartPid] = useState<string | null>(null);

  const profiles = useTypedRpc<ProfilesList>();
  const preview = useTypedRpc<{ recommendation: RecommendationView }>();
  const save = useTypedRpc<{ appliedProfileId: string; recommendation: RecommendationView }>();

  useEffect(() => {
    profiles.run(() => rpc.profilesList());
  }, []);

  useEffect(() => {
    if (initialProfileId !== null && !consumed) {
      setPid(initialProfileId);
      setConsumed(true);
      onConsumed();
    }
  }, [initialProfileId, consumed, onConsumed]);

  // Selecting a baseline triggers a fresh preview (wizard step 2).
  useEffect(() => {
    if (pid === null) return;
    preview.run(() => rpc.optimizePreview(pid));
  }, [pid]);

  useEffect(() => {
    if (save.state.kind !== 'done') return;
    onProfilesChanged();
  }, [save.state.kind, onProfilesChanged]);

  const recommendation = preview.state.kind === 'done' ? preview.state.value.recommendation : null;
  const candidates = recommendation?.candidates ?? [];

  const canSave =
    recommendation !== null &&
    recommendation.selectedIndex !== null &&
    candidates.length > 0 &&
    candidates[recommendation.selectedIndex]?.score.confidence === 'high';

  const saveReason =
    recommendation === null
      ? null
      : recommendation.selectedIndex === null || candidates.length === 0
        ? t('desktop.optimize.refused.noSafe')
        : candidates[recommendation.selectedIndex]?.score.confidence !== 'high'
          ? t('desktop.optimize.refused.lowConfidence')
          : null;

  const onSave = () => {
    if (pid === null || preview.state.kind !== 'done') return;
    setSaveStartPid(pid);
    save.run(() => rpc.optimizeSave(pid));
  };

  const taskLabel = (kind: string | null): string => {
    if (kind === null) return '';
    const key = `desktop.tasks.${kind}` as ResourceKey;
    const label = t(key);
    return label === key ? kind : label;
  };

  const renderCandidate = (candidate: CandidateView, index: number) => {
    const key = candidate.id;
    const isExpanded = expanded === index;
    const rationale = candidate.rationale;
    return (
      <li key={key} className={`candidate-card${isExpanded ? ' expanded' : ''}`}>
        <button type="button" className="candidate-head" onClick={() => setExpanded(isExpanded ? null : index)}>
          <span className="candidate-title">
            {t('candidate.head', { index: index + 1, id: candidate.id })}
          </span>
          <span className="candidate-metrics">
            <span className="pill pill-score">{t('candidate.score', { score: candidate.score.total })}</span>
            <span className={`pill ${candidate.score.confidence === 'high' ? 'pill-high' : 'pill-low'}`}>
              {t(
                candidate.score.confidence === 'high' ? 'optimize.confidenceHigh' : 'optimize.confidenceLow',
              )}
            </span>
            {candidate.safety.safe ? (
              <span className="pill pill-safe">{t('optimizer.safe')}</span>
            ) : (
              <span className="pill pill-low">{t('candidate.unsafe')}</span>
            )}
          </span>
        </button>

        {isExpanded && (
          <div className="candidate-body">
            <p className="muted">
              {candidate.safety.safe && candidate.safety.headroomBytes !== null
                ? t('optimize.headroom', { value: (candidate.safety.headroomBytes / GIB).toFixed(2) })
                : candidate.safety.reason ?? ''}
            </p>

            {candidate.diff !== null && candidate.diff.length > 0 && (
              <table className="diff-table">
                <thead>
                  <tr>
                    <th>{t('desktop.optimize.diff.path')}</th>
                    <th>{t('desktop.optimize.diff.baseline')}</th>
                    <th>{t('desktop.optimize.diff.candidate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.diff.map((row, rowIndex) => (
                    <tr key={`${row.path}-${rowIndex}`}>
                      <td className="mono">{row.path}</td>
                      <td className="mono">{formatValue(row.baseline)}</td>
                      <td className="mono">{formatValue(row.candidate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {rationale !== null && (
              <div className="rationale">
                <p>
                  <strong>{t('desktop.optimize.rationale.zh')}</strong> {rationale['zh-CN']}
                </p>
                <p>
                  <strong>{t('desktop.optimize.rationale.en')}</strong> {rationale.en}
                </p>
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="optimize-view">
      {profiles.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, profiles.state.failure)}</p>}

      <div className="field">
        <label htmlFor="optimize-baseline">{t('desktop.optimize.select')}</label>
        <select
          id="optimize-baseline"
          value={pid ?? ''}
          disabled={profiles.state.kind !== 'done'}
          onChange={(event) => setPid(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">{t('desktop.optimize.select')}</option>
          {profiles.state.kind === 'done' &&
            profiles.state.value.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {displayNameOf(i18n, profile.displayName)} ({profile.id})
              </option>
            ))}
        </select>
      </div>

      {pid !== null && (
        <div className="field">
          <button
            type="button"
            disabled={preview.state.kind === 'running'}
            onClick={() => preview.run(() => rpc.optimizePreview(pid))}
          >
            {t('desktop.optimize.preview')}
          </button>
        </div>
      )}

      {preview.state.kind === 'running' && (
        <p className="running" aria-live="polite">
          …
        </p>
      )}
      {preview.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, preview.state.failure)}</p>}

      {recommendation !== null && (
        <>
          <div className="view-head">
            <h2>{t('desktop.optimize.title')}</h2>
            <span className="muted">{t('desktop.optimize.rules', { version: recommendation.ruleVersion })}</span>
          </div>

          {recommendation.warnings.length > 0 && (
            <ul className="warnings">
              {recommendation.warnings.map((warning) => (
                <li key={warning} className="muted">
                  {t('desktop.optimize.warning', { code: warning })}
                </li>
              ))}
            </ul>
          )}

          {candidates.length === 0 ? (
            <p className="muted">{t('desktop.optimize.none')}</p>
          ) : (
            <>
              <h3 className="subsection">{t('desktop.optimize.candidates')}</h3>
              <ul className="candidate-list">{candidates.map(renderCandidate)}</ul>
            </>
          )}

          <div className="save-row">
            {recommendation !== null && recommendation.taskKind !== null && (
              <span className="pill pill-era">{taskLabel(recommendation.taskKind)}</span>
            )}
            <button
              type="button"
              className="primary"
              disabled={!canSave || save.state.kind === 'running'}
              onClick={onSave}
            >
              {t('desktop.optimize.save')}
            </button>
          </div>
          {saveReason !== null && <p className="muted">{saveReason}</p>}
          {save.state.kind === 'error' && (
            <p className="error">
              {save.state.failure.code === 'OPTIMIZE_REFUSED'
                ? save.state.failure.message.includes('no-safe-candidate')
                  ? t('desktop.optimize.refused.noSafe')
                  : t('desktop.optimize.refused.lowConfidence')
                : rpcFailureText(i18n, save.state.failure)}
            </p>
          )}
          {save.state.kind === 'done' && saveStartPid === pid && (
            <p className="success" role="status">
              {t('desktop.optimize.saved', { id: save.state.value.appliedProfileId })}
              <br />
              {t('desktop.optimize.notActivated')}
            </p>
          )}
        </>
      )}
    </div>
  );
}