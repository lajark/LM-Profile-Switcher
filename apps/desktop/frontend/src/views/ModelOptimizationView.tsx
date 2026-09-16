import { useEffect, useState } from 'react';
import type { I18nService, ResourceKey } from '@lmps/i18n/browser';
import { rpc } from '../api';
import { useTypedRpc } from '../hooks';
import type {
  ModelProfileContext,
  OptimizationDecision,
  OptimizationPreparationView,
  OptimizationSaveView,
} from '../types';
import { rpcFailureText } from './ProfilesView';

interface ModelOptimizationViewProps {
  i18n: I18nService;
  modelKey: string;
  scenarioType: string;
  baseline: ModelProfileContext | null;
  onCancel: () => void;
  onSaved: () => void;
}

const CANDIDATE_EVIDENCE_LABELS: Record<OptimizationPreparationView['preparation']['candidateEvidence'], ResourceKey> = {
  measured: 'desktop.models.optimizeFlow.evidence.measured',
  unmeasured: 'desktop.models.optimizeFlow.evidence.unmeasured',
  failed: 'desktop.models.optimizeFlow.evidence.failed',
  canceled: 'desktop.models.optimizeFlow.evidence.canceled',
  'not-run': 'desktop.models.optimizeFlow.evidence.notRun',
};

export function ModelOptimizationView({ i18n, modelKey, scenarioType, baseline, onCancel, onSaved }: ModelOptimizationViewProps) {
  const t = i18n.t;
  const [baselineDecision, setBaselineDecision] = useState<OptimizationDecision>('run');
  const [candidateDecision, setCandidateDecision] = useState<OptimizationDecision>('run');
  const [candidateId, setCandidateId] = useState<string | undefined>(undefined);
  const [saveId, setSaveId] = useState('optimized-profile');
  const [setDefault, setSetDefault] = useState(false);
  const preparation = useTypedRpc<OptimizationPreparationView>();
  const save = useTypedRpc<OptimizationSaveView>();

  useEffect(() => {
    setSaveId(defaultSaveId(modelKey, scenarioType, baseline?.id));
    setCandidateId(undefined);
  }, [baseline?.id, modelKey, scenarioType]);

  const runPrepare = () => {
    const options = {
      baselineBenchmark: baselineDecision,
      candidateBenchmark: candidateDecision,
      ...(candidateId === undefined ? {} : { candidateId }),
    };
    preparation.run(() => baseline === null
      ? rpc.optimizationPrepareModel(modelKey, scenarioType, options)
      : rpc.optimizationPrepare(baseline.id, options));
  };

  const prepared = preparation.state.kind === 'done' ? preparation.state.value : null;
  const body = prepared?.preparation ?? null;
  const candidates = body?.recommendation?.candidates ?? [];
  const selectedCandidateId = candidateId ?? body?.selectedCandidate?.id ?? null;
  const candidateNeedsRetest = body !== null && candidateId !== undefined && candidateId !== body.selectedCandidate?.id;
  const canSave = body?.selectedCandidate !== null && body?.selectedCandidate !== undefined &&
    body.candidateEvidence !== 'failed' && body.candidateEvidence !== 'canceled' && body.candidateEvidence !== 'not-run' && saveId.trim() !== '';

  const onSave = () => {
    if (prepared === null || !canSave) return;
    save.run(() => rpc.optimizationSave(prepared.preparationId, saveId.trim(), setDefault));
  };

  return (
    <section className="optimization-workspace" aria-label={t('desktop.models.optimizeFlow.title')}>
      <div className="view-head">
        <div>
          <button type="button" className="back-button" onClick={onCancel}>{t('desktop.models.back')}</button>
          <h2>{t('desktop.models.optimizeFlow.title')}</h2>
          <p className="descriptor">{modelKey} · {scenarioType}</p>
        </div>
        <span className="pill">{baseline?.id ?? t('desktop.models.optimizeFlow.unsavedBaseline')}</span>
      </div>

      <p className="muted">{t('desktop.models.optimizeFlow.intro')}</p>
      {baseline === null && <div className="notice notice-warning">{t('desktop.models.optimizeFlow.unsavedHint')}</div>}
      <div className="optimization-phases">
        <fieldset className="phase-card">
          <legend>{t('desktop.models.optimizeFlow.baseline')}</legend>
          <p className="muted">{t('desktop.models.optimizeFlow.baselineHint')}</p>
          <label><input type="radio" name="baseline-decision" checked={baselineDecision === 'run'} onChange={() => setBaselineDecision('run')} /> {t('desktop.models.optimizeFlow.run')}</label>
          <label><input type="radio" name="baseline-decision" checked={baselineDecision === 'skip'} onChange={() => setBaselineDecision('skip')} /> {t('desktop.models.optimizeFlow.skip')}</label>
        </fieldset>
        <fieldset className="phase-card">
          <legend>{t('desktop.models.optimizeFlow.candidate')}</legend>
          <p className="muted">{t('desktop.models.optimizeFlow.candidateHint')}</p>
          <label><input type="radio" name="candidate-decision" checked={candidateDecision === 'run'} onChange={() => setCandidateDecision('run')} /> {t('desktop.models.optimizeFlow.run')}</label>
          <label><input type="radio" name="candidate-decision" checked={candidateDecision === 'skip'} onChange={() => setCandidateDecision('skip')} /> {t('desktop.models.optimizeFlow.skip')}</label>
        </fieldset>
      </div>

      <div className="optimization-actions">
        <button type="button" className="primary" disabled={preparation.state.kind === 'running'} onClick={runPrepare}>
          {preparation.state.kind === 'running'
            ? t('desktop.models.optimizeFlow.preparing')
            : candidateNeedsRetest
              ? t('desktop.models.optimizeFlow.retestSelected')
              : t('desktop.models.optimizeFlow.prepare')}
        </button>
        {prepared !== null && <span className="pill">{t('desktop.models.optimizeFlow.status', { value: prepared.preparation.status })}</span>}
      </div>

      {preparation.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, preparation.state.failure)}</p>}
      {body !== null && (
        <div className="optimization-result">
          {body.recommendation === null ? (
            <p className="notice notice-warning">{t('desktop.models.optimizeFlow.noRecommendation')}</p>
          ) : (
            <>
              <div className="section-heading"><h3>{t('desktop.optimize.candidates')}</h3><span className="muted">{t('desktop.optimize.rules', { version: body.recommendation.ruleVersion })}</span></div>
              <ul className="candidate-list compact">
                {candidates.map((candidate) => (
                  <li key={candidate.id} className={`candidate-card ${selectedCandidateId === candidate.id ? 'selected' : ''}`}>
                    <button type="button" className="candidate-head" onClick={() => setCandidateId(candidate.id)}>
                      <span className="candidate-title">{candidate.id}</span>
                      <span className="candidate-metrics"><span className="pill pill-score">{t('candidate.score', { score: candidate.score.total })}</span><span className="pill">{candidate.score.confidence}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
              {body.selectedCandidate !== null && body.selectedCandidate !== undefined && (
                <p className="muted">{t('desktop.models.optimizeFlow.selected', { id: body.selectedCandidate.id })}</p>
              )}
            </>
          )}
          <div className="optimization-evidence">
            <span className="eyebrow">{t('desktop.models.optimizeFlow.evidence.label')}</span>
            <span className="pill">{t(CANDIDATE_EVIDENCE_LABELS[body.candidateEvidence])}</span>
          </div>
          <div className="save-row optimization-save-row">
            <label className="field"><span>{t('desktop.models.optimizeFlow.saveId')}</span><input value={saveId} onChange={(event) => setSaveId(event.target.value)} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={setDefault} onChange={(event) => setSetDefault(event.target.checked)} /> {t('desktop.models.optimizeFlow.setDefault')}</label>
            <button type="button" className="primary" disabled={!canSave || save.state.kind === 'running'} onClick={onSave}>{t('desktop.models.optimizeFlow.save')}</button>
          </div>
          {!canSave && <p className="muted">{t('desktop.models.optimizeFlow.notReady')}</p>}
        </div>
      )}

      {save.state.kind === 'error' && <p className="error">{rpcFailureText(i18n, save.state.failure)}</p>}
      {save.state.kind === 'done' && <p className="success" role="status">{t('desktop.models.optimizeFlow.saved', { id: save.state.value.profileId })}</p>}
      <button type="button" className="text-button" onClick={onCancel}>{t('common.cancel')}</button>
      {save.state.kind === 'done' && <button type="button" className="primary" onClick={onSaved}>{t('desktop.models.optimizeFlow.done')}</button>}
    </section>
  );
}

function defaultSaveId(modelKey: string, scenarioType: string, baselineId?: string): string {
  if (baselineId !== undefined) return `${baselineId}-optimized`;
  const slug = `${modelKey}-${scenarioType}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${(slug === '' ? 'model' : slug).slice(0, 52)}-optimized`;
}