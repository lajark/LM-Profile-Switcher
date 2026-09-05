/**
 * `lmps hardware`: runs the pure hardware probe through the injected ProbeEnv
 * and renders a concise summary; --json carries the full HardwareProfile.
 * Section failures are normal (the probe never throws) and degrade to `unknown`.
 */
import type { HardwareProfile } from '@lmps/domain';
import { probeHardware } from '@lmps/hardware';

import { formatBytes, joinFragments } from '../format.js';
import type { CliDeps, CommandOutput } from '../seams.js';

export async function runHardwareCommand(deps: CliDeps): Promise<CommandOutput> {
  const profile = await probeHardware(deps.probeEnv);
  return { text: humanSummary(deps, profile), data: profile };
}

function humanSummary(deps: CliDeps, profile: HardwareProfile): string {
  const unknown = deps.t('common.unknown').toLowerCase();
  const lines: string[] = [];

  lines.push(deps.t('hardware.os', { os: profile.os ?? unknown, release: '' }));

  if (profile.cpu != null) {
    lines.push(
      deps.t('hardware.cpu', {
        value: joinFragments([
          profile.cpu.model ?? null,
          profile.cpu.cores == null ? null : String(profile.cpu.cores),
          profile.cpu.threads == null ? null : String(profile.cpu.threads),
        ]),
      }),
    );
  } else {
    lines.push(deps.t('hardware.cpu', { value: unknown }));
  }

  if (profile.memory != null && profile.memory.totalBytes != null) {
    const total = formatBytes(profile.memory.totalBytes);
    const available = profile.memory.availableBytes != null ? formatBytes(profile.memory.availableBytes) : null;
    lines.push(deps.t('hardware.memory', { value: available === null ? total : `${total} / ${available}` }));
  } else {
    lines.push(deps.t('hardware.memory', { value: unknown }));
  }

  if (profile.gpus == null) {
    lines.push(deps.t('hardware.gpuUnknown'));
  } else if (profile.gpus.length === 0) {
    lines.push(deps.t('hardware.gpuNone'));
  } else {
    for (const gpu of profile.gpus) {
      lines.push(deps.t('hardware.gpu', { value: gpu.name }));
    }
  }

  if (profile.volumes != null) {
    for (const volume of profile.volumes) {
      if (volume.totalBytes != null) {
        const value = formatBytes(volume.totalBytes);
        if (volume.external === true) {
          lines.push(deps.t('hardware.volumeExternal', { mount: volume.mount, value }));
        } else {
          lines.push(deps.t('hardware.volume', { mount: volume.mount, value }));
        }
      }
    }
  }

  lines.push(deps.t('hardware.probedAt', { at: profile.probedAt }));
  return lines.join('\n');
}