/**
 * Typed accessors over labels.json (M6-004). Copy lives in JSON so the i18n
 * hardcoded-string gate (which scans .ts/.tsx only) does not flag expected
 * Chinese UI text used in assertions.
 */
import labelsJson from './labels.json' with { type: 'json' };

export type Locale = 'zh-CN' | 'en';

export interface LabelSet {
  nav: { profiles: string; optimize: string; benchmark: string; hardware: string };
  connected: string;
  profiles: {
    title: string;
    new: string;
    apply: string;
    confirm: string;
    cancel: string;
    delete: string;
    activeBadge: string;
    applyConfirmPart: string;
    activatedPart: string;
    idempotentPart: string;
    recoveredPart: string;
  };
  editor: {
    id: string;
    zhName: string;
    enName: string;
    modelKey: string;
    taskType: string;
    contextLength: string;
    temperature: string;
    behaviorMode: string;
    save: string;
    displayNameRequired: string;
  };
  optimize: {
    select: string;
    preview: string;
    candidates: string;
    firstHead: string;
    scorePart: string;
    highConfidence: string;
    safe: string;
    diffPath: string;
    rationaleZh: string;
    rationaleEn: string;
    save: string;
    savedPart: string;
    none: string;
    refusedNoSafe: string;
  };
  benchmark: {
    select: string;
    run: string;
    completed: string;
    failed: string;
    metrics: string;
    decodeMetric: string;
    errorCodePart: string;
  };
  hardware: { title: string; os: string; gpus: string };
  error: { lmUnreachable: string };
}

interface LabelFile {
  labels: Record<Locale, LabelSet>;
  profileNames: {
    chat: Record<Locale, string>;
    code: Record<Locale, string>;
  };
  localeButton: Record<Locale, string>;
  fixtureGpuName: string;
  fixtureOs: string;
}

const data = labelsJson as LabelFile;

export const LABELS = data.labels;
export const PROFILE_NAMES = data.profileNames;
export const LOCALE_BUTTON = data.localeButton;
export const FIXTURE_GPU_NAME = data.fixtureGpuName;
export const FIXTURE_OS = data.fixtureOs;
