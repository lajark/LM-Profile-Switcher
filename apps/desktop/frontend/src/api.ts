/**
 * Typed wire to the sidecar data plane (M3-002).
 * All methods go through the single `sidecar_rpc` command; method names stay
 * here so the React layer never spells wire strings by hand. RPC failures are
 * rejected by Rust as `"{code}: {message}"` strings — parseRpcError splits the
 * stable code off so views can map it to an i18n key.
 */
import { invoke } from '@tauri-apps/api/core';
import type {
  ActivationApplyResult,
  ActivationStatus,
  BenchmarkBody,
  HardwareView,
  ProfilesMeta,
  OptimizePreviewView,
  OptimizationPreparationView,
  OptimizationSaveView,
  ModelContextProjection,
  ProfileDocument,
  ProfilesList,
  RpcFailure,
} from './types';

export type SidecarStatusName = 'starting' | 'connected' | 'disconnected' | 'auth-failed';

export const sidecarStatus = () => invoke<SidecarStatusName>('sidecar_status');

export const sidecarProbe = () => invoke<Record<string, unknown>>('sidecar_probe');
export const sidecarHardware = () => invoke<{ profile: HardwareView }>('sidecar_hardware');
export const sidecarSdkInfo = () => invoke<Record<string, unknown>>('sidecar_sdk_info');

export const sidecarLocaleGet = () => invoke<string | null>('sidecar_locale_get');
export const sidecarLocaleSet = (locale: string) =>
  invoke<void>('sidecar_locale_set', { locale });

/** Parses a Rust-side `"CODE: message"` rejection into its stable parts. */
export function parseRpcError(error: unknown): RpcFailure {
  const text = typeof error === 'string' ? error : String(error);
  const index = text.indexOf(': ');
  if (index > 0) {
    return { code: text.slice(0, index), message: text.slice(index + 2) };
  }
  return { code: 'INTERNAL', message: text };
}

/** benchmark.run routinely exceeds the 60s default cap; see M3-002 plan §2. */
const BENCHMARK_RUN_TIMEOUT_MS = 300_000;

/** activation.apply can legitimately run into the minutes on a large model. */
const ACTIVATION_APPLY_TIMEOUT_MS = 300_000;

async function invokeRpc<T>(
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T> {
  const args: Record<string, unknown> = { method, params };
  if (timeoutMs !== undefined) args.timeoutMs = timeoutMs;
  return invoke<T>('sidecar_rpc', args);
}

export interface BenchmarkRunOptions {
  samples?: number;
  maxTokens?: number;
  allowBattery?: boolean;
}

export const rpc = {
  modelsContext: () => invokeRpc<ModelContextProjection>('models.context', {}),
  defaultsSet: (profileId: string) => invokeRpc<{ default: { modelKey: string; taskType: string; profileId: string; updatedAt: string } }>('defaults.set', { profileId }),
  profilesMeta: () => invokeRpc<ProfilesMeta>('profiles.meta', {}),
  profilesList: () => invokeRpc<ProfilesList>('profiles.list', {}),
  profilesShow: (id: string) => invokeRpc<{ profile: ProfileDocument }>('profiles.show', { id }),
  profilesCreate: (profile: Record<string, unknown>) =>
    invokeRpc<{ id: string }>('profiles.create', { profile }),
  profilesUpdate: (id: string, patch: Record<string, unknown>) =>
    invokeRpc<{ id: string }>('profiles.update', { id, patch }),
  profilesDelete: (id: string) => invokeRpc<{ id: string }>('profiles.delete', { id }),
  activationStatus: () => invokeRpc<ActivationStatus>('activation.status', {}),
  activationApply: (id: string) =>
    invokeRpc<ActivationApplyResult>('activation.apply', { id }, ACTIVATION_APPLY_TIMEOUT_MS),
  activationStartSafe: (modelKey: string, taskType: string) =>
    invokeRpc<ActivationApplyResult>('activation.startSafe', { modelKey, taskType }, ACTIVATION_APPLY_TIMEOUT_MS),
  optimizationPrepare: (
    profileId: string,
    options: { baselineBenchmark?: 'run' | 'skip'; candidateBenchmark?: 'run' | 'skip'; candidateId?: string; samples?: number; maxTokens?: number; allowBattery?: boolean },
  ) => invokeRpc<OptimizationPreparationView>('optimization.prepare', { profileId, ...options }, BENCHMARK_RUN_TIMEOUT_MS * 2),
  optimizationPrepareModel: (
    modelKey: string,
    taskType: string,
    options: { baselineBenchmark?: 'run' | 'skip'; candidateBenchmark?: 'run' | 'skip'; candidateId?: string; samples?: number; maxTokens?: number; allowBattery?: boolean },
  ) => invokeRpc<OptimizationPreparationView>('optimization.prepareModel', { modelKey, taskType, ...options }, BENCHMARK_RUN_TIMEOUT_MS * 2),
  optimizationSave: (preparationId: string, id: string, setDefault: boolean) =>
    invokeRpc<OptimizationSaveView>('optimization.save', { preparationId, id, setDefault }),
  optimizationSetDefault: (profileId: string) => invokeRpc<{ profileId: string }>('optimization.setDefault', { profileId }),  optimizePreview: (profileId: string) =>
    invokeRpc<OptimizePreviewView>('optimize.preview', { profileId }),
  optimizeSave: (profileId: string) =>
    invokeRpc<{ appliedProfileId: string; recommendation: OptimizePreviewView['recommendation'] }>(
      'optimize.save',
      { profileId },
    ),
  benchmarkRun: (profileId: string, options: BenchmarkRunOptions) =>
    invokeRpc<BenchmarkBody>('benchmark.run', { profileId, ...options }, BENCHMARK_RUN_TIMEOUT_MS),
};