/**
 * Synthetic platform fixtures for the M1-001 hardware probe suite.
 *
 * Everything here is invented hardware (no values copied from a real machine):
 * raw probe output is LOCAL-ONLY per PROJECT_DISTRIBUTION_POLICY §3.3, so the
 * suite exercises the parser and orchestrator with clearly artificial data.
 */
import type { ProbeEnv, RunResult } from '@lmps/hardware';

/** The harness fails closed: a test must opt in to each probe section. */

export function okResult(stdout: string, stderr = ''): RunResult {
  return { ok: true, stdout, stderr };
}

export function failResult(stderr = 'probe failed', timedOut = false): RunResult {
  return { ok: false, stdout: '', stderr, timedOut };
}

export const FAIL: RunResult = failResult();
export const TIMED_OUT: RunResult = failResult('ETIMEDOUT', true);

// --- Synthetic probe text ----------------------------------------------------

export const nvidiaSmiTwoGpus =
  'Synthetic RTX 9000, 610.11, 24576, 20000\r\nSynthetic RTX 9001, 610.11, 4096, 3000\r\n';

export const nvidiaSmiSingleGpu = 'Synthetic RTX 9000, 610.11, 24576, 20000\n';

export const nvidiaSmiWithNa = 'Synthetic RTX 9000, [N/A], [N/A], [N/A]\n';

export const nvidiaSmiPartialVram = 'Synthetic RTX 9000, 610.11, 24576, [N/A]\n';

export const nvidiaSmiEmpty = '';

export const coresJson = '[{"NumberOfCores":8,"NumberOfLogicalProcessors":16}]';

export const volumeJsonArray =
  '[{"DeviceID":"X:","Size":1099511627776,"FreeSpace":549755813888},{"DeviceID":"Y:","Size":2199023255552,"FreeSpace":1099511627776}]';

export const volumeJsonSingle = '{"DeviceID":"Z:","Size":536870912000,"FreeSpace":268435456000}';

// --- External-disk classification tables (four WMI queries joined in parse.ts) ---
//
// X: is a fixed drive (DriveType 3) on a built-in NVMe disk → external:false.
// Y: is a removable drive (DriveType 2) on a USB disk → external:true regardless
// of the drive table.

const DISK0 = '\\\\.\\PHYSICALDRIVE0';
const DISK1 = '\\\\.\\PHYSICALDRIVE1';
const X_PARTITION = 'Disk #0, Partition #2';
const Y_PARTITION = 'Disk #1, Partition #1';

const wmiRef = (className: string, deviceId: string): string => `${className}.DeviceID="${deviceId}"`;

export const logicalDisksJson = JSON.stringify([
  { DeviceID: 'X:', DriveType: 3, Size: 1099511627776, FreeSpace: 549755813888 },
  { DeviceID: 'Y:', DriveType: 2, Size: 2199023255552, FreeSpace: 1099511627776 },
]);

export const diskDrivesJson = JSON.stringify([
  {
    DeviceID: DISK0,
    Model: 'Synthetic NVMe',
    InterfaceType: 'NVMe',
    PNPDeviceID: 'SCSI\\DISK&VEN_NVMESSD',
    MediaType: 'Fixed hard disk media',
  },
  {
    DeviceID: DISK1,
    Model: 'Synthetic USB SSD',
    InterfaceType: 'USB',
    PNPDeviceID: 'USBSTOR\\DISK&VEN_SYNTH',
    MediaType: 'External hard disk media',
  },
]);

export const diskToPartitionJson = JSON.stringify([
  { Antecedent: wmiRef('Win32_DiskDrive', DISK0), Dependent: wmiRef('Win32_DiskPartition', X_PARTITION) },
  { Antecedent: wmiRef('Win32_DiskDrive', DISK1), Dependent: wmiRef('Win32_DiskPartition', Y_PARTITION) },
]);

// Real-machine orientation of Win32_LogicalDiskToPartition: the partition is
// the Antecedent, the logical disk the Dependent. The join resolves endpoint
// roles by class, so this shape (unlike the letter-first guess) is what the
// probe actually sees.
export const logicalToPartitionJson = JSON.stringify([
  { Antecedent: wmiRef('Win32_DiskPartition', X_PARTITION), Dependent: wmiRef('Win32_LogicalDisk', 'X:') },
  { Antecedent: wmiRef('Win32_DiskPartition', Y_PARTITION), Dependent: wmiRef('Win32_LogicalDisk', 'Y:') },
]);

export const volumeJsonMalformed = '{not json';

export const registryNamesJson =
  '["Synthetic RTX 9000","Synthetic iGPU 2000","Synthetic iGPU 2000"]';

export const registryNamesEmpty = '[]';

export const batteryJsonAc = '2';

export const batteryJsonDischarging = '[1]';

export const batteryObjectForm = '{"BatteryStatus":2}';

export const batteryEmptyOutput = '';

export const cimMalformed = '{oops';

// --- Statfs-style snapshot ---------------------------------------------------

export const statfsSnapshot = { blocks: 262144000, bavail: 131072000, bsize: 4096 };

// --- Fake ProbeEnv ------------------------------------------------------------

export const FAKE_NOW = '2026-08-22T01:02:03.000Z';
export const FAKE_CPU_MODEL = 'Physon X9 990';
export const FAKE_CPU_COUNT = 3;
export const FAKE_TOTAL_MEM = 34_359_738_368;
export const FAKE_FREE_MEM = 17_179_869_184;

export interface FakeProbeOptions {
  nvidiaSmi?: RunResult | null;
  cores?: RunResult | null;
  /** Win32_LogicalDisk rows (the volume list itself). */
  volumes?: RunResult | null;
  battery?: RunResult | null;
  registry?: RunResult | null;
  /** Enrichment tables for external-disk classification (Win32_DiskDrive etc.). */
  diskDrives?: RunResult | null;
  diskToPartition?: RunResult | null;
  logicalToPartition?: RunResult | null;
  volumeFallback?: { blocks: number; bavail: number; bsize: number } | null;
  digest?: (data: string) => string;
}

/**
 * A deterministic `ProbeEnv` wired to the given canned command results.
 * Defaults to "every probe fails" (null runner) so each test opts in.
 */
export function makeFakeProbeEnv(options: FakeProbeOptions = {}): ProbeEnv {
  return {
    os: {
      platform: () => 'win32',
      release: () => '10.0.26000',
      version: () => 'Windows 11 Pro',
      arch: () => 'x64',
      cpus: () => Array.from({ length: FAKE_CPU_COUNT }, () => ({ model: FAKE_CPU_MODEL })),
      totalmem: () => FAKE_TOTAL_MEM,
      freemem: () => FAKE_FREE_MEM,
      homeRoot: () => 'C:/',
    },
    run: async (cmd, args) => {
      if (cmd === 'nvidia-smi') return options.nvidiaSmi ?? null;
      if (cmd === 'powershell.exe') {
        const encoded = args[args.length - 1] ?? '';
        const script = Buffer.from(encoded, 'base64').toString('utf16le');
        // `Win32_DiskDrive`/`Win32_LogicalDisk` are string prefixes of the two
        // association queries, so the longer names must be matched first.
        if (script.includes('Win32_LogicalDiskToPartition')) return options.logicalToPartition ?? null;
        if (script.includes('Win32_DiskDriveToDiskPartition')) return options.diskToPartition ?? null;
        if (script.includes('Win32_LogicalDisk')) return options.volumes ?? null;
        if (script.includes('Win32_DiskDrive')) return options.diskDrives ?? null;
        if (script.includes('Win32_Processor')) return options.cores ?? null;
        if (script.includes('Win32_Battery')) return options.battery ?? null;
        if (script.includes('DriverDesc')) return options.registry ?? null;
        return null;
      }
      return null;
    },
    statfs: () => options.volumeFallback ?? null,
    digest: (data) => options.digest?.(data) ?? `fake:${data.length}`,
    now: () => FAKE_NOW,
  };
}