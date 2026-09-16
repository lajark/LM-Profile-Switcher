/**
 * Builds an ephemeral safe baseline for a discovered model that has no saved
 * profile yet. The profile is intentionally valid domain data, but callers
 * must keep it in memory until the user explicitly saves an optimization.
 */
import { SCHEMA_VERSION, TASK_KINDS, type CompositeProfile, type TaskKind } from '@lmps/domain';

export interface SafeBaselineInput {
  modelKey: string;
  family: string | null;
  quantization: string | null;
  taskType: string;
  now: string;
}

/** Creates a deterministic, unsaved baseline suitable for preflight/activation. */
export function createSafeBaselineProfile(input: SafeBaselineInput): CompositeProfile {
  const modelKey = input.modelKey.trim();
  const taskType = input.taskType.trim();
  if (modelKey === '' || taskType === '') {
    throw new Error('modelKey and taskType are required for a safe baseline');
  }

  const kind: TaskKind = (TASK_KINDS as readonly string[]).includes(taskType)
    ? taskType as TaskKind
    : 'custom';
  const id = `draft-${slug(`${modelKey}-${taskType}`)}`.slice(0, 64);

  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    displayName: {
      'zh-CN': '\u672a\u4fdd\u5b58\u5b89\u5168\u57fa\u7ebf',
      en: 'Unsaved safe baseline',
    },
    description: {
      'zh-CN': '\u4ec5\u7528\u4e8e\u672c\u6b21\u4f18\u5316\u51c6\u5907\u6216\u5b89\u5168\u542f\u52a8\uff0c\u4e0d\u4f1a\u81ea\u52a8\u4fdd\u5b58\u3002',
      en: 'Used only for this preparation or safe start; never saved automatically.',
    },
    model: {
      modelKey,
      family: input.family,
      quantization: input.quantization,
    },
    task: { type: taskType, kind },
    runtime: { gpuOffload: 'auto' },
    generation: {},
    behavior: { mode: 'exclusive', rollback: 'best-effort' },
    metadata: { createdAt: input.now, updatedAt: input.now },
  };
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized === '' ? 'model' : normalized;
}