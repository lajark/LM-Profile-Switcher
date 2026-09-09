/**
 * Hardware tab (M3-002): structured panel over the sidecar's `hardware` probe
 * plus a collapsible Diagnostics section with the raw probe and SDK info. The
 * probe payload is already redacted by the sidecar (LOCAL-ONLY machine data).
 */
import { useEffect, useState } from 'react';
import type { I18nService } from '@lmps/i18n/browser';
import { sidecarHardware, sidecarSdkInfo } from '../api';
import type { HardwareView as HardwareData } from '../types';

interface HardwareViewProps {
  i18n: I18nService;
}

const GIB = 1024 ** 3;

function giB(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

export function HardwareView({ i18n }: HardwareViewProps) {
  const t = i18n.t;
  const [hardware, setHardware] = useState<HardwareData | 'error' | null>(null);
  const [sdkInfo, setSdkInfo] = useState<Record<string, unknown> | 'error' | null>(null);

  useEffect(() => {
    let active = true;
    void sidecarHardware().then(
      ({ profile }) => {
        if (active) setHardware(profile);
      },
      () => {
        if (active) setHardware('error');
      },
    );
    void sidecarSdkInfo().then(
      (info) => {
        if (active) setSdkInfo(info);
      },
      () => {
        if (active) setSdkInfo('error');
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="hardware-view">
      <div className="view-head">
        <h2>{t('desktop.hardware.title')}</h2>
      </div>

      {hardware === 'error' && <p className="error">{t('desktop.error.rpc.unknown', { message: 'hardware' })}</p>}
      {hardware !== null && hardware !== 'error' && (
        <dl className="hw-grid">
          <div className="hw-item">
            <dt>{t('desktop.hardware.os')}</dt>
            <dd>{hardware.os ?? '—'}</dd>
          </div>
          <div className="hw-item">
            <dt>{t('desktop.hardware.cpu')}</dt>
            <dd>
              {hardware.cpu?.model ?? '—'}
              <span className="muted">
                {hardware.cpu?.cores !== undefined && hardware.cpu?.cores !== null
                  ? ` · ${hardware.cpu.cores} ${t('desktop.hardware.cores')}`
                  : ''}
                {hardware.cpu?.threads !== undefined && hardware.cpu?.threads !== null
                  ? ` · ${hardware.cpu.threads} ${t('desktop.hardware.threads')}`
                  : ''}
              </span>
            </dd>
          </div>
          <div className="hw-item">
            <dt>{t('desktop.hardware.memory')}</dt>
            <dd>
              {t('desktop.hardware.memory.available')} {giB(hardware.memory?.availableBytes)} /{' '}
              {t('desktop.hardware.memory.total')} {giB(hardware.memory?.totalBytes)}
            </dd>
          </div>
          <div className="hw-item">
            <dt>{t('desktop.hardware.gpus')}</dt>
            <dd>
              {hardware.gpus && hardware.gpus.length > 0 ? (
                <ul className="hw-list">
                  {hardware.gpus.map((gpu, index) => (
                    <li key={gpu.name ?? index}>
                      {gpu.name}
                      {gpu.driverVersion ? ` (${gpu.driverVersion})` : ''}
                      <span className="muted">
                        {' '}
                        · {t('desktop.hardware.vram', { used: giB(gpu.vramAvailableBytes), total: giB(gpu.vramTotalBytes) })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="hw-item">
            <dt>{t('desktop.hardware.volumes')}</dt>
            <dd>
              {hardware.volumes && hardware.volumes.length > 0 ? (
                <ul className="hw-list">
                  {hardware.volumes.map((volume, index) => (
                    <li key={`${volume.mount}-${index}`}>
                      <span className="mono-card-id">{volume.mount}</span>{' '}
                      <span className="muted">
                        {giB(volume.availableBytes)} / {giB(volume.totalBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="hw-item">
            <dt>{t('desktop.hardware.power')}</dt>
            <dd>
              {hardware.power?.onBattery === true ? t('desktop.hardware.onBattery') : t('desktop.hardware.onPlugged')}
            </dd>
          </div>
          {hardware.hardwareFingerprint !== null && hardware.hardwareFingerprint !== undefined && (
            <div className="hw-item">
              <dt>{t('desktop.hardware.fingerprint')}</dt>
              <dd className="mono-card-id">{hardware.hardwareFingerprint}</dd>
            </div>
          )}
          {hardware.probedAt !== undefined && (
            <div className="hw-item">
              <dt>{t('desktop.hardware.probedAt')}</dt>
              <dd className="mono">{hardware.probedAt ?? '—'}</dd>
            </div>
          )}
        </dl>
      )}

      {hardware === null && (
        <p className="running" aria-live="polite">
          …
        </p>
      )}

      <details className="json-preview">
        <summary>{t('desktop.hardware.diagnostics')}</summary>
        <div className="hardware-diagnostics">
          <p className="muted">{t('desktop.hardware.sdkInfo')}</p>
          <pre className="result mono">{sdkInfo === 'error' ? 'error' : JSON.stringify(sdkInfo ?? null, null, 2)}</pre>
        </div>
      </details>
    </div>
  );
}