/**
 * `lmps optimize <id> [--yes]`: runs the candidate optimizer (M2-002) for a
 * stored baseline profile through the injected `RecommendationSeam`. Without
 * `--yes` it only renders candidates; with `--yes` it saves the head candidate
 * as a new profile (`validation.source = 'rule-recommended'`) and appends an
 * audit record — it never activates (that is `apply --yes`'s job, FR-04). A
 * `--yes` save is refused when no candidate is safe (exit 4) or when the head
 * candidate is only `low` confidence (rough/unknown estimate), so an unmeasured
 * recommendation can never be persisted silently.
 */
import type { Candidate, CompositeProfile, Recommendation } from '@lmps/domain';

import { capabilityUnsupported, CliError } from '../errors.js';
import { parseCommandArgs } from '../options.js';
import type { CliDeps, CommandOutput } from '../seams.js';

const SPEC = { flags: { yes: 'boolean' }, maxPositional: 1 } as const;

export interface OptimizeContext {
  signal?: AbortSignal;
}

export async function runOptimizeCommand(
  deps: CliDeps,
  args: readonly string[],
  context: OptimizeContext,
): Promise<CommandOutput> {
  const parsed = parseCommandArgs(SPEC, args);
  const seam = deps.recommendation;
  // A harness or earlier wiring state may carry `undefined`; treat it as absent.
  if (seam === null || seam === undefined) throw capabilityUnsupported('optimize');

  const id = parsed.positionals[0];
  if (id === undefined) {
    throw new CliError('USAGE', 'optimize requires a profile id', { detail: 'missing profile id' });
  }

  const baseline = deps.store.get(id); // STORE_NOT_FOUND → exit 4
  const recommendation = await seam.service.recommend(baseline, { signal: context.signal });

  if (parsed.flags.yes === true) {
    const selected = selectedCandidate(recommendation); // throws USAGE when none is safe
    if (selected.score.confidence !== 'high') {
      throw new CliError('USAGE', 'refusing to save a low-confidence candidate', {
        params: { key: 'optimize.lowConfidence' },
      });
    }
    const saved = saveCandidate(deps, seam, baseline, recommendation, selected);
    return { text: `${humanSummary(deps, recommendation)}\n${deps.t('optimize.savedButNotActivated', { id: saved.id })}`, data: { recommendation, savedProfileId: saved.id } };
  }

  return { text: humanSummary(deps, recommendation), data: { recommendation } };
}

/** The head candidate, or a USAGE error when the recommendation has none. */
function selectedCandidate(recommendation: Recommendation): Candidate {
  if (recommendation.selectedIndex === null || recommendation.candidates.length === 0) {
    throw new CliError('USAGE', 'no safe candidate to save', { params: { key: 'optimize.noSafeCandidateYes' } });
  }
  const candidate = recommendation.candidates[recommendation.selectedIndex];
  if (candidate === undefined) {
    throw new CliError('USAGE', 'no safe candidate to save', { params: { key: 'optimize.noSafeCandidateYes' } });
  }
  return candidate;
}

function saveCandidate(
  deps: CliDeps,
  seam: NonNullable<CliDeps['recommendation']>,
  baseline: CompositeProfile,
  recommendation: Recommendation,
  selected: Candidate,
): CompositeProfile {
  const now = deps.now();
  const savedId = `${baseline.id}-${recommendation.ruleVersion}`;
  const saved: CompositeProfile = {
    ...selected.profile,
    id: savedId,
    validation: { source: 'rule-recommended', testedAt: now },
    metadata: { ...selected.profile.metadata, createdAt: now, updatedAt: now },
  };
  const created = deps.store.create(saved); // duplicate id → STORE_ALREADY_EXISTS → exit 4

  seam.audit({
    at: now,
    baselineProfileId: baseline.id,
    appliedProfileId: created.id,
    taskKind: recommendation.taskKind,
    ruleVersion: recommendation.ruleVersion,
    confidence: selected.score.confidence,
    candidateId: selected.id,
  });
  return created;
}

function humanSummary(deps: CliDeps, recommendation: Recommendation): string {
  const lines: string[] = [];
  lines.push(deps.t('optimize.title', { id: recommendation.baselineProfileId }));
  lines.push(deps.t('optimize.ruleVersion', { version: recommendation.ruleVersion }));

  recommendation.candidates.forEach((candidate, index) => {
    const score = deps.t('candidate.score', { score: candidate.score.total.toFixed(3) });
    const confidence =
      candidate.score.confidence === 'high' ? deps.t('optimize.confidenceHigh') : deps.t('optimize.confidenceLow');
    const headroom =
      candidate.safety.headroomBytes === null
        ? ''
        : ` · ${deps.t('optimize.headroom', { value: (candidate.safety.headroomBytes / GIB).toFixed(1) })}`;
    lines.push(`  ${deps.t('candidate.head', { index: String(index + 1), id: candidate.id })} · ${score} · ${confidence}${headroom}`);
    for (const diff of candidate.diff) {
      lines.push(
        `    ${deps.t('diff.field', {
          path: diff.path,
          baseline: String(diff.baseline ?? ''),
          candidate: String(diff.candidate ?? ''),
        })}`,
      );
    }
  });

  if (recommendation.selectedIndex === null) {
    lines.push(deps.t('optimize.noSafeCandidate'));
  }
  for (const warning of recommendation.warnings) {
    lines.push(`warn: ${warningText(deps, warning)}`);
  }
  return lines.join('\n');
}

function warningText(deps: CliDeps, code: string): string {
  if (code.startsWith('estimate-failed')) return deps.t('error.optimizeEstimateFailed');
  if (code.startsWith('unsafe-drop')) return deps.t('candidate.unsafe');
  if (code === 'unknown-capability') return deps.t('candidate.unsafe');
  return code;
}

const GIB = 1024 ** 3;