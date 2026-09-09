/**
 * Benchmark tab (M3-002): pick a profile, tune samples/maxTokens/battery, and
 * run the bounded benchmark through the sidecar (300s RPC budget). The result
 * is show-only — nothing is stamped back onto the profile. Measurement failure
 * arrives inside the result (`status: 'failed'`) rather than as an RPC error;
 * guard failures (battery, lock) arrive as RPC errors.
 */
import { useEffect, useState } from 'react';
import type { I18nService } from '@lmps/i18n/browser';
import { rpc } from '../api';
import { useTypedRpc } from '../hooks';
import type { BenchmarkBody, BenchmarkResultView, ProfilesList } from '../types';
import { displayNameOf, rpcFailureText } from './ProfilesView';

interface BenchmarkViewProps {
  i18n: I18nService;
  initialProfileId: string | null;
  /** Clears the App-level handoff once the initial profile has been consumed. */
  onConsumed: () => void;
}

const GIB = 1024 ** 3;

interface MetricName {
  label: string;
  /** Formats the raw metric value for display. */
  format: (value: number) => string;
}

export function BenchmarkView({ i18n, initialProfileId, onConsumed }: BenchmarkViewProps) {
  const t = i18n.t;
  const [pid, setPid] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(false);
  const [samples, setSamples] = useState('3');
  const [maxTokens, setMaxTokens] = useState('64');
  const [allowBattery, setAllowBattery] = useState(true);

  const profiles = useTypedRpc<ProfilesList>();
  const run = useTypedRpc<BenchmarkBody>();

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

  const doRun = () => {
    if (pid === null) return;
    const sampleCount = Number(samples);
    const tokenBudget = Number(maxTokens);
    const body: { samples?: number; maxTokens?: number; allowBattery?: boolean } = {};
    if (Number.isFinite(sampleCount)) body.samples = sampleCount;
    if (Number.isFinite(tokenBudget)) body.maxTokens = tokenBudget;
    body.allowBattery = allowBattery;
    run.run(() => rpc.benchmarkRun(pid, body));
  };

  const result = run.state.kind === 'done' ? run.state.value.result : null;

  const metricNames: Record<string, MetricName> = {
    tokensPerSecond: {
      label: t('desktop.benchmark.metric.tokensPerSecond'),
      format: (value) => value.toFixed(1),
    },
    latencyP50Ms: {
      label: t('desktop.benchmark.metric.latencyP50Ms'),
      format: (value) => `${Math.round(value)} ms`,
    },
    loadMs: {
      label: t('desktop.benchmark.metric.loadMs'),
      format: (value) => `${Math.round(value)} ms`,
    },
    ttftMs: {
      label: t('desktop.benchmark.metric.ttftMs'),
      format: (value) => `${Math.round(value)} ms`,
    },
    prefillTokensPerSecond: {
      label: t('desktop.benchmark.metric.prefillTokensPerSecond'),
      format: (value) => value.toFixed(1),
    },
    decodeTokensPerSecond: {
      label: t('desktop.benchmark.metric.decodeTokensPerSecond'),
      format: (value) => value.toFixed(1),
    },
    memoryPeakBytes: {
      label: t('desktop.benchmark.metric.memoryPeakBytes'),
      format: (value) => `${(value / GIB).toFixed(2)} GiB`,
    },
    samples: {
      label: t('desktop.benchmark.metric.samples'),
      format: (value) => String(Math.round(value)),
    },
  };

  const metricRows: { label: string; value: string | null }[] = result
    ? Object.entries(metricNames).map(([key, metric]) => {
        const raw = result.metrics[key];
        if (typeof raw !== 'number') return { label: metric.label, value: null };
        return { label: metric.label, value: metric.format(raw) };
      })
    : [];

  const statusPill = (value: BenchmarkResultView) => {
    if (value.status === 'completed') return <span className="pill pill-safe">{t('desktop.benchmark.status.ok')}</span>;
    if (value.status === 'canceled') return <span className="pill pill-low">{t('desktop.benchmark.status.canceled')}</span>;
    return <span className="pill pill-low">{t('desktop.benchmark.status.failed')}</span>;
  };

  return (
    <div className="benchmark-view">
      <div className="view-head">
        <h2>{t('desktop.benchmark.title')}</h2>
      </div>

      {profiles.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, profiles.state.failure)}</p>}

      <div className="form-grid">
        <label className="field">
          <span>{t('desktop.benchmark.select')}</span>
          <select
            value={pid ?? ''}
            disabled={profiles.state.kind !== 'done'}
            onChange={(event) => setPid(event.target.value === '' ? null : event.target.value)}
          >
            <option value="">{t('desktop.benchmark.select')}</option>
            {profiles.state.kind === 'done' &&
              profiles.state.value.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {displayNameOf(i18n, profile.displayName)} ({profile.id})
                </option>
              ))}
          </select>
        </label>

        <label className="field">
          <span>{t('desktop.benchmark.samples')}</span>
          <input
            type="number"
            min={1}
            max={10}
            value={samples}
            onChange={(event) => setSamples(event.target.value)}
          />
        </label>

        <label className="field">
          <span>{t('desktop.benchmark.maxTokens')}</span>
          <input
            type="number"
            min={1}
            max={512}
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
          />
        </label>

        <label className="field checkbox">
          <input type="checkbox" checked={allowBattery} onChange={(event) => setAllowBattery(event.target.checked)} />
          <span>{t('desktop.benchmark.allowBattery')}</span>
        </label>
      </div>

      <div className="btn-row">
        <button type="button" className="primary" disabled={pid === null || run.state.kind === 'running'} onClick={doRun}>
          {t('desktop.benchmark.run')}
        </button>
      </div>

      {run.state.kind === 'running' && (
        <p className="running" aria-live="polite">
          {t('desktop.benchmark.running')}
        </p>
      )}
      {run.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, run.state.failure)}</p>}

      {run.state.kind === 'done' && result !== null && (
        <div className="benchmark-result">
          <div className="meta-row">
            {statusPill(result)}
            <span className="pill pill-era">{t('desktop.benchmark.taskType', { type: result.taskType })}</span>
            {result.quantization !== null && <span className="pill">{result.quantization}</span>}
            {result.lmStudioVersion !== null && result.lmStudioVersion !== undefined && (
              <span className="pill">{t('desktop.benchmark.lmStudio', { version: result.lmStudioVersion })}</span>
            )}
            {result.errorCode !== null && result.errorCode !== undefined && (
              <span className="pill pill-low">{t('desktop.benchmark.errorCode', { code: result.errorCode })}</span>
            )}
          </div>
          {result.hardwareFingerprint !== null && result.hardwareFingerprint !== undefined && (
            <p className="mono-card-id muted">{t('desktop.benchmark.fingerprint')}: {result.hardwareFingerprint}</p>
          )}
          {result.promptSuiteId !== null && result.promptSuiteId !== undefined && (
            <p className="muted">
              {t('desktop.benchmark.promptSuite', { version: result.promptSuiteVersion ?? result.promptSuiteId })}
            </p>
          )}

          {result.status === 'completed' ? (
            <>
              <h3 className="subsection">{t('desktop.benchmark.metrics')}</h3>
              <table className="diff-table">
                <thead>
                  <tr>
                    <th>{t('desktop.benchmark.field')}</th>
                    <th>{t('desktop.benchmark.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {metricRows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="mono">{row.value === null ? '—' : row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted">{t('desktop.benchmark.noResult')}</p>
          )}

          <p className="muted note">{t('desktop.benchmark.notValidated')}</p>
        </div>
      )}

      {run.state.kind !== 'done' && run.state.kind !== 'error' && (
        <p className="muted">{t('desktop.benchmark.noResult')}</p>
      )}
    </div>
  );
}