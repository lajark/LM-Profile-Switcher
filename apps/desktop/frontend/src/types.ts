/**
 * M3-002 view-facing types. These mirror the sidecar data-plane payloads
 * (apps/core-service handlers) and are kept LOCAL so the presentation layer
 * never imports @lmps/domain. Liberty-supplying `[k: string]: unknown` fields
 * reflect passthrough contract fields the editor preview preserves verbatim.
 */

export interface LocalizedText {
  'zh-CN'?: string | null;
  en?: string | null;
  [locale: string]: string | null | undefined;
}

/** `profiles.list` card projection (never carries secrets). */
export interface ProfileCard {
  id: string;
  displayName: LocalizedText;
  model: { modelKey: string; family: string | null; quantization: string | null };
  task: { type: string; kind: string | null };
  updatedAt: string;
}

export interface ProfilesList {
  profiles: ProfileCard[];
}

export interface ProfilesMeta {
  taskKinds: string[];
}

/** `activation.status` — the active profile as the transaction layer sees it. */
export interface ActivationStatus {
  active: {
    profileId: string | null;
    modelKey: string;
    since: string;
  } | null;
}

/** `activation.apply` result projection (outcome drives the banner text). */
export interface ActivationApplyResult {
  outcome: 'active' | 'canceled' | 'failed-but-recovered' | 'failed';
  alreadyActive: boolean;
  transaction: {
    transactionId: string;
    targetProfileId: string;
    status: string;
    [k: string]: unknown;
  };
}

/** Sanitized full document from `profiles.show` (tokens nulled). */
export interface ProfileDocument {
  schemaVersion?: number;
  id: string;
  displayName: LocalizedText;
  description?: LocalizedText;
  model: {
    modelKey: string;
    family?: string | null;
    quantization?: string | null;
    [k: string]: unknown;
  };
  task: { type: string; kind?: string | null; [k: string]: unknown };
  runtime?: {
    contextLength?: number | null;
    gpuOffload?: string | number | null;
    [k: string]: unknown;
  };
  generation?: { temperature?: number | null; [k: string]: unknown };
  behavior?: { mode?: string | null; [k: string]: unknown };
  metadata?: { createdAt?: string; updatedAt?: string; [k: string]: unknown };
  validation?: {
    source?: string;
    testedAt?: string | null;
    memoryPeakBytes?: number | null;
    resourceUsage?: ResourceUsageEvidenceView;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface DiffRow {
  path: string;
  baseline: unknown;
  candidate: unknown;
}

export type ResourceFitName =
  | 'gpu-resident'
  | 'hybrid-memory'
  | 'host-memory'
  | 'resource-unknown'
  | 'resource-insufficient';

/**
 * M5-003: per-candidate resource projection surfaced from `@lmps/domain`
 * `Candidate` through the sidecar data plane. Liberty-supplying `[k: string]`
 * stays so legacy fields (e.g. legacy `safe`/`reason`) remain passable.
 */
export interface CandidateView {
  id: string;
  profile: ProfileDocument;
  baselineProfileId: string;
  safety: {
    safe: boolean;
    reason: string | null;
    headroomBytes: number | null;
    /** M5-001: five-class resource fit verdict. */
    resourceFit?: ResourceFitName | null;
    /** GPU/Total estimate split. */
    vramUsedBytes?: number | null;
    vramAvailableBytes?: number | null;
    vramReserveBytes?: number | null;
    /** RAM budget (M5-003). */
    ramUsedBytes?: number | null;
    ramReserveBytes?: number | null;
    ramHeadroomBytes?: number | null;
    [k: string]: unknown;
  };
  /**
   * M5-001/003: load estimate (GPU + total + system RAM) used by CLI resource
   * detail. Carried verbatim from `@lmps/domain` `Candidate.estimate`.
   */
  estimate?: {
    vramTotalBytes?: number | null;
    totalMemoryBytes?: number | null;
    systemRamBytes?: number | null;
    [k: string]: unknown;
  } | null;
  score: {
    total: number;
    breakdown?: Record<string, number>;
    confidence: 'high' | 'low';
    measured: boolean;
  };
  diff: DiffRow[] | null;
  rationale: { 'zh-CN': string; en: string } | null;
  [k: string]: unknown;
}

/** M6-002: normalized calibration verdict mirror of `@lmps/optimizer`. */
export interface CalibrationVerdictView {
  calibrationVersion: 2;
  evidenceVersion: 1 | null;
  evidenceQuality: 'complete' | 'partial' | 'unavailable';
  relation: 'observed-below-estimate' | 'within-tolerance' | 'observed-above-estimate' | 'unavailable';
  rebenchmarkRequired: boolean;
  applied: boolean;
  comparedPeakBytes: number | null;
  estimatedTotalBytes: number | null;
  ratio: number | null;
  degraded: boolean;
  overrunBytes: number | null;
  confidence: 'measured' | 'low' | 'estimated';
  note: 'calibrated' | 'degraded' | 'unavailable';
}

/** M6-002: advisory calibration projection returned alongside a recommendation. */
export interface CalibrationProjectionView {
  measuredPeakBytes: number | null;
  candidates: Array<{ candidateId: string; verdict: CalibrationVerdictView }>;
}

export interface RecommendationView {
  schemaVersion?: number;
  baselineProfileId: string;
  taskKind: string | null;
  ruleVersion: string;
  candidates: CandidateView[];
  selectedIndex: number | null;
  generatedAt: string;
  warnings: string[];
  /** M5-003: estimate-vs-measured calibration projection (advisory). */
  calibration?: CalibrationProjectionView;
}

/** `optimize.preview` / `optimize.save` payload with calibration projection. */
export interface OptimizePreviewView {
  recommendation: RecommendationView;
  calibration: CalibrationProjectionView;
}

export interface BenchmarkMetrics {
  tokensPerSecond?: number | null;
  latencyP50Ms?: number | null;
  memoryPeakBytes?: number | null;
  resourceUsage?: ResourceUsageEvidenceView;
  samples?: number | null;
  loadMs?: number | null;
  ttftMs?: number | null;
  prefillTokensPerSecond?: number | null;
  decodeTokensPerSecond?: number | null;
  [k: string]: unknown;
}

export interface ResourceUsageEvidenceView {
  schemaVersion: 1;
  method: 'host-snapshot-delta';
  sampleCount: number;
  completeness: 'complete' | 'partial' | 'unavailable';
  peakDelta: {
    vramBytes: number | null;
    systemRamBytes: number | null;
    totalBytes: number | null;
  };
}

export interface BenchmarkResultView {
  schemaVersion?: number;
  id: string;
  modelKey: string;
  quantization?: string | null;
  taskType: string;
  status: 'completed' | 'failed' | 'canceled';
  metrics: BenchmarkMetrics;
  hardwareFingerprint?: string | null;
  lmStudioVersion?: string | null;
  runtimeVersion?: string | null;
  errorCode?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  promptSuiteId?: string | null;
  promptSuiteVersion?: string | null;
  modelFileHash?: string | null;
  [k: string]: unknown;
}

export interface BenchmarkBody {
  result: BenchmarkResultView;
  validated: boolean;
}

export interface GpuInfo {
  name: string;
  driverVersion?: string | null;
  vramTotalBytes: number;
  vramAvailableBytes: number;
}

export interface VolumeInfo {
  mount: string;
  totalBytes: number;
  availableBytes: number;
  driveType?: number | null;
  bus?: string | null;
  external?: boolean | null;
  model?: string | null;
}

export interface HardwareView {
  schemaVersion?: number;
  os?: string | null;
  cpu?: { model?: string | null; cores?: number | null; threads?: number | null } | null;
  memory?: { totalBytes?: number | null; availableBytes?: number | null } | null;
  gpus?: GpuInfo[] | null;
  volumes?: VolumeInfo[] | null;
  power?: { onBattery: boolean } | null;
  versions?: Record<string, string | null> | null;
  hardwareFingerprint?: string | null;
  probedAt?: string;
  [k: string]: unknown;
}

/** Stable error code + redacted context as parsed from the Rust "CODE: msg" string. */
export interface RpcFailure {
  code: string;
  message: string;
}
