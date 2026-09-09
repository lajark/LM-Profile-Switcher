import type { I18nService, Locale } from '@lmps/i18n/browser';
import { useCallback, useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { parseRpcError, sidecarStatus, type SidecarStatusName } from './api';
import type { RpcFailure } from './types';

export type RpcState<T> =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; value: T }
  | { kind: 'error'; failure: RpcFailure };

/** Live sidecar status: initial invoke, then the `sidecar://status` channel. */
export function useSidecarStatus(): SidecarStatusName {
  const [status, setStatus] = useState<SidecarStatusName>('starting');

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let active = true;
    let cleanedUp = false;
    void sidecarStatus().then(
      (current) => {
        if (active) setStatus(current);
      },
      () => undefined,
    );
    void listen<SidecarStatusName>('sidecar://status', ({ payload }) => {
      if (active) setStatus(payload);
    }).then(
      (stop) => {
        // The listen promise can resolve after unmount; stop then instead.
        if (cleanedUp) stop();
        else unlisten = stop;
      },
      () => undefined,
    );
    return () => {
      active = false;
      cleanedUp = true;
      unlisten?.();
    };
  }, []);

  return status;
}

/**
 * Typed one-shot sidecar RPC with idle/running/done/error state. Re-runs when
 * `run` is handed a fresh call; the same single-flight job slot means a stale
 * response can never clobber a newer call's state.
 */
export function useTypedRpc<T>() {
  const [state, setState] = useState<RpcState<T>>({ kind: 'idle' });
  const [job, setJob] = useState<(() => Promise<T>) | null>(null);

  const run = useCallback((call: () => Promise<T>) => {
    setJob(() => call);
  }, []);

  useEffect(() => {
    if (job === null) return;
    let active = true;
    setState({ kind: 'running' });
    void job().then(
      (value) => {
        if (active) setState({ kind: 'done', value });
      },
      (error: unknown) => {
        if (active) setState({ kind: 'error', failure: parseRpcError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [job]);

  return { state, run };
}

/** Re-renders on locale change; the `t` function itself is not reactive. */
export function useLocale(i18n: I18nService): Locale {
  const [locale, setLocale] = useState<Locale>(i18n.getLocale());
  useEffect(() => i18n.onLocaleChanged(setLocale), [i18n]);
  return locale;
}