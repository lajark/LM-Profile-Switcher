/**
 * In-memory fake of the Rust shell commands and the Core Service data plane
 * for browser-mode E2E (M6-004). It speaks the exact wire the real frontend
 * uses (`invoke('sidecar_rpc', { method, params })` plus the sidecar_* and
 * settings commands), so views exercise the real code path with mocked IPC.
 *
 * Only reachable through e2e-main.tsx (served at /e2e.html by the dev server);
 * the production index.html build graph never imports this module.
 */
import { mockIPC } from '@tauri-apps/api/mocks';
import type {
  ActivationApplyResult,
  ActivationStatus,
  BenchmarkBody,
  LocalizedText,
  OptimizePreviewView,
  ProfileCard,
  ProfileDocument,
} from '../types';
import {
  chatProfile,
  codeProfile,
  completedBenchmark,
  failedBenchmark,
  happyPreview,
  HARDWARE_FIXTURE,
  noSafePreview,
  SDK_INFO_FIXTURE,
  type E2eScenario,
} from './fixtures';

const LOCALE_STORAGE_KEY = 'lmps-e2e-locale';

/** Rust rejects invokes with plain "CODE: message" strings; mimic that exactly. */
function rpcReject(code: string, message: string): Promise<never> {
  return Promise.reject(`${code}: ${message}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

class FakeSidecar {
  private readonly profiles = new Map<string, ProfileDocument>();
  private active: ActivationStatus['active'] = null;

  constructor(private readonly scenario: E2eScenario) {
    for (const doc of [chatProfile(), codeProfile()]) this.profiles.set(doc.id, doc);
  }

  getLocale(): string {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY) ?? 'zh-CN';
  }

  setLocale(locale: string): void {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }

  private cardOf(doc: ProfileDocument): ProfileCard {
    return {
      id: doc.id,
      displayName: doc.displayName as LocalizedText,
      model: {
        modelKey: doc.model.modelKey,
        family: doc.model.family ?? null,
        quantization: doc.model.quantization ?? null,
      },
      task: {
        type: doc.task.type,
        kind: doc.task.kind ?? null,
      },
      updatedAt: String(doc.metadata?.updatedAt ?? ''),
    };
  }

  async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'profiles.meta':
        return { taskKinds: ['quick-chat', 'coding'] };
      case 'profiles.list':
        if (this.scenario === 'list-error') {
          return rpcReject('LM_UNREACHABLE', 'fixture: sidecar data plane unreachable');
        }
        return { profiles: [...this.profiles.values()].map((doc) => this.cardOf(doc)) };
      case 'profiles.show': {
        const doc = this.profiles.get(String(params.id));
        if (doc === undefined) return rpcReject('STORE_NOT_FOUND', `fixture: ${String(params.id)}`);
        return { profile: structuredClone(doc) };
      }
      case 'profiles.create': {
        const doc = asRecord(params.profile) as unknown as ProfileDocument;
        this.profiles.set(doc.id, structuredClone(doc));
        return { id: doc.id };
      }
      case 'profiles.update': {
        const existing = this.profiles.get(String(params.id));
        if (existing === undefined) return rpcReject('STORE_NOT_FOUND', `fixture: ${String(params.id)}`);
        const patch = asRecord(params.patch) as Partial<ProfileDocument>;
        const merged: ProfileDocument = { ...existing, ...structuredClone(patch), id: existing.id };
        this.profiles.set(existing.id, merged);
        return { id: existing.id };
      }
      case 'profiles.delete': {
        this.profiles.delete(String(params.id));
        if (this.active?.profileId === String(params.id)) this.active = null;
        return { id: String(params.id) };
      }
      case 'activation.status':
        return { active: this.active } satisfies ActivationStatus;
      case 'activation.apply': {
        const id = String(params.id);
        if (!this.profiles.has(id)) return rpcReject('STORE_NOT_FOUND', `fixture: ${id}`);
        if (this.scenario === 'apply-recovered') {
          // Automatic rollback path: the transaction failed and the previous
          // profile was restored, so the active slot stays empty.
          return {
            outcome: 'failed-but-recovered',
            alreadyActive: false,
            transaction: {
              transactionId: `tx-e2e-${id}`,
              targetProfileId: id,
              status: 'rolled-back',
            },
          } satisfies ActivationApplyResult;
        }
        const alreadyActive = this.active?.profileId === id;
        const doc = this.profiles.get(id);
        this.active = {
          profileId: id,
          modelKey: doc?.model.modelKey ?? 'unknown',
          since: '2026-09-01T09:00:00.000Z',
        };
        return {
          outcome: 'active',
          alreadyActive,
          transaction: {
            transactionId: `tx-e2e-${id}`,
            targetProfileId: id,
            status: 'committed',
          },
        } satisfies ActivationApplyResult;
      }
      case 'optimize.preview':
        if (this.scenario === 'no-safe') return noSafePreview();
        return happyPreview();
      case 'optimize.save': {
        const preview: OptimizePreviewView = happyPreview();
        return { appliedProfileId: 'chat-9b-loop-max', recommendation: preview.recommendation };
      }
      case 'benchmark.run':
        return (
          this.scenario === 'benchmark-failed'
            ? failedBenchmark(String(params.profileId))
            : completedBenchmark(String(params.profileId))
        ) satisfies BenchmarkBody;
      case 'hardware':
        return { profile: HARDWARE_FIXTURE };
      case 'sdkInfo':
        return SDK_INFO_FIXTURE;
      default:
        return rpcReject('METHOD_UNSUPPORTED', `fixture: ${method}`);
    }
  }
}

function resolveScenario(): E2eScenario {
  const raw = new URLSearchParams(window.location.search).get('scenario');
  if (raw === 'list-error' || raw === 'no-safe' || raw === 'benchmark-failed' || raw === 'apply-recovered') {
    return raw;
  }
  return 'happy';
}

/**
 * Installs the fake Tauri internals before the real bootstrap runs. Reads the
 * scenario from `?scenario=` (default happy) and exposes the fake on a global
 * solely so specs can read state when a UI affordance does not exist.
 */
export function installE2eTauriMock(): void {
  const scenario = resolveScenario();
  const fake = new FakeSidecar(scenario);

  mockIPC(async (cmd, args) => {
    const payload = asRecord(args);
    switch (cmd) {
      case 'sidecar_status':
        return 'connected';
      case 'sidecar_probe':
        return { ok: true, transport: 'e2e-mock' };
      case 'sidecar_hardware':
        return { profile: HARDWARE_FIXTURE };
      case 'sidecar_sdk_info':
        return SDK_INFO_FIXTURE;
      case 'sidecar_locale_get':
        return fake.getLocale();
      case 'sidecar_locale_set':
        fake.setLocale(String(payload.locale));
        return null;
      case 'sidecar_rpc':
        return fake.rpc(String(payload.method), asRecord(payload.params));
      default:
        if (typeof cmd === 'string' && cmd.startsWith('plugin:event|')) {
          // Event listen/unlisten invocations resolve without pushing frames;
          // the initial sidecar_status invoke already reports "connected".
          return cmd.endsWith('listen') ? 0 : null;
        }
        return rpcReject('METHOD_UNSUPPORTED', `fixture: ${String(cmd)}`);
    }
  });

  (window as unknown as Record<string, unknown>).__LMPS_E2E_FAKE__ = fake;
}
