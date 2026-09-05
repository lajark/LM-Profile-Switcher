/**
 * Static scoring, parameter diff and rationale assembly (PRD FR-07 step 5,
 * M2-002). Pure module; everything is a deterministic heuristic proxy — there is
 * no measurement here, so `score.measured` is always false (real calibration is
 * M2-003 Benchmark). `confidence` is `high` only when the estimate was `exact`,
 * the safety margin was safe, and no `unknown` capability forced a downgrade.
 *
 * The proxy sub-scores (0..1 per dimension) are deliberately crude rules of
 * thumb over a model's own fields: VRAM efficiency is free headroom, latency
 * prefers high GPU offload and shorter context, throughput favours a larger
 * eval batch, quality rewards wide context and low temperature. They exist to
 * rank candidates, never to be quoted as measured.
 */
import type { CandidateScore, CompositeProfile, LoadEstimate, ParameterDiffEntry, Rule } from '@lmps/domain';

import type { SafetyMargin } from './safe-margin.js';
import { CONFIDENCE_LABEL, HEADROOM_NOTE, RATIONALE_NOTE } from './notes.js';

const GIB = 1024 ** 3;
const MAX_CONTEXT = 131072;
const MAX_BATCH = 512;
const MAX_TEMP = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 6): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

function contextOf(profile: CompositeProfile): number | null {
  const value = profile.runtime.contextLength;
  return value === null || value === undefined ? null : value;
}

function gpuOffloadOf(profile: CompositeProfile): number | null {
  const value = profile.runtime.gpuOffload;
  if (typeof value === 'number') return value;
  // Enum-form offload ('auto'/'max'/'off') has no numeric fraction; neutral.
  return null;
}

interface ProxyInputs {
  contextLength: number | null;
  gpuOffload: number | null;
  evalBatchSize: number | null;
  temperature: number | null;
}

function proxiesOf(profile: CompositeProfile): ProxyInputs {
  return {
    contextLength: contextOf(profile),
    gpuOffload: gpuOffloadOf(profile),
    evalBatchSize: profile.runtime.evalBatchSize ?? null,
    temperature: profile.generation.temperature ?? null,
  };
}

function weightedBreakdown(inputs: ProxyInputs): CandidateScore['breakdown'] {
  const context = inputs.contextLength === null ? null : clamp(inputs.contextLength, 0, MAX_CONTEXT);
  const contextFrac = context === null ? 0.5 : context / MAX_CONTEXT;
  const contextLatency = context === null ? 0.5 : 1 - contextFrac; // shorter context lowers latency

  const offload = inputs.gpuOffload;
  const offloadFrac = offload === null ? 0.5 : clamp(offload, 0, 1);
  const latency = round(0.5 * offloadFrac + 0.5 * contextLatency);

  const batch = inputs.evalBatchSize;
  const throughput = round(batch === null ? 0.5 : clamp(batch / MAX_BATCH, 0, 1));

  const temperature = inputs.temperature;
  const tempQuality = temperature === null ? 0.5 : 1 - clamp(temperature, 0, MAX_TEMP) / MAX_TEMP;
  const quality = round(0.5 * contextFrac + 0.5 * tempQuality);

  return { vramEfficiency: 0.5, latency, throughput, quality };
}

/**
 * Score one candidate against its rule. The VRAM-efficiency sub-score comes from
 * the real safety margin (estimate vs available); the rest stay proxy heuristics.
 */
export function scoreCandidate(
  profile: CompositeProfile,
  rule: Rule,
  estimate: LoadEstimate,
  safety: SafetyMargin,
  forceLow: boolean,
): CandidateScore {
  const weights = rule.scoringWeights ?? { vramEfficiency: 0.25, latency: 0.25, throughput: 0.25, quality: 0.25 };
  const weightTotal = weights.vramEfficiency + weights.latency + weights.throughput + weights.quality;
  const w = {
    vramEfficiency: weights.vramEfficiency / weightTotal,
    latency: weights.latency / weightTotal,
    throughput: weights.throughput / weightTotal,
    quality: weights.quality / weightTotal,
  };

  const breakdown = weightedBreakdown(proxiesOf(profile));
  const used = safety.vramUsedBytes;
  const available = safety.vramAvailableBytes;
  breakdown.vramEfficiency = round(used !== null && available !== null && available > 0 ? clamp(1 - used / available, 0, 1) : 0.5);

  const total = round(
    w.vramEfficiency * breakdown.vramEfficiency +
      w.latency * breakdown.latency +
      w.throughput * breakdown.throughput +
      w.quality * breakdown.quality,
  );

  const confidence: 'high' | 'low' = estimate.provider === 'exact' && safety.safe && !forceLow ? 'high' : 'low';

  return { total, breakdown, confidence, measured: false };
}

/**
 * Field-level diff of the candidate against the baseline. Only changed leaf
 * fields are reported (runtime + generation), addressed by dotted path so a
 * consumer can render `runtime.contextLength` without reshaping.
 */
export function diffAgainst(candidate: CompositeProfile, baseline: CompositeProfile): ParameterDiffEntry[] {
  const entries: ParameterDiffEntry[] = [];
  const sections = ['runtime', 'generation'] as const;
  for (const section of sections) {
    const left = baseline[section] as Record<string, unknown>;
    const right = candidate[section] as Record<string, unknown>;
    for (const [key, value] of Object.entries(right)) {
      const base = left[key];
      if (base !== value) entries.push({ path: `${section}.${key}`, baseline: base ?? null, candidate: value ?? null });
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/**
 * Assemble the bilingual justification: the rule's own rationale (data) plus the
 * scoring note. The Chinese side comes from the declared data module; both sides
 * stay non-empty by contract.
 */
export function buildRationale(rule: Rule, safety: SafetyMargin, score: CandidateScore): { 'zh-CN': string; en: string } {
  const headroomBytes = safety.headroomBytes;
  const headroom = score.confidence === 'high' && headroomBytes !== null;
  const zhHeadroom = headroom ? HEADROOM_NOTE['zh-CN'].replace('{headroom}', (headroomBytes / GIB).toFixed(1)) : '';
  const enHeadroom = headroom ? HEADROOM_NOTE.en.replace('{headroom}', (headroomBytes / GIB).toFixed(1)) : '';
  const zhNote = RATIONALE_NOTE['zh-CN']
    .replace('{score}', score.total.toFixed(3))
    .replace('{confidence}', CONFIDENCE_LABEL['zh-CN'][score.confidence])
    .replace('{headroom}', zhHeadroom);
  const enNote = RATIONALE_NOTE.en
    .replace('{score}', score.total.toFixed(3))
    .replace('{confidence}', CONFIDENCE_LABEL.en[score.confidence])
    .replace('{headroom}', enHeadroom);
  return { 'zh-CN': rule.rationale['zh-CN'] + zhNote, en: rule.rationale.en + enNote };
}