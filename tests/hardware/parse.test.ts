// Parser tests: raw probe text → structured values. All inputs are synthetic.
import { describe, expect, it } from 'vitest';

import {
  batteryEmptyOutput,
  batteryJsonAc,
  batteryJsonDischarging,
  batteryObjectForm,
  cimMalformed,
  nvidiaSmiEmpty,
  nvidiaSmiSingleGpu,
  nvidiaSmiTwoGpus,
  nvidiaSmiWithNa,
  nvidiaSmiPartialVram,
  registryNamesEmpty,
  registryNamesJson,
  statfsSnapshot,
  volumeJsonMalformed,
  logicalDisksJson,
  diskDrivesJson,
  diskToPartitionJson,
  logicalToPartitionJson,
} from './fixtures.js';

import {
  describeOs,
  joinVolumeDetails,
  parseBatteryStatus,
  parseCimJson,
  parseNvidiaSmiCsv,
  parseRegistryNames,
  parseStatfs,
  parseWmiRef,
  toDiskDriveFromCim,
  toVolumeFromCim,
  toWmiRefPair,
} from '@lmps/hardware';

const MIB = 1048576;

describe('parseNvidiaSmiCsv', () => {
  it('parses two GPUs from CRLF output and converts MiB to bytes', () => {
    const rows = parseNvidiaSmiCsv(nvidiaSmiTwoGpus);
    expect(rows).toEqual([
      { name: 'Synthetic RTX 9000', driverVersion: '610.11', vramTotalBytes: 24576 * MIB, vramAvailableBytes: 20000 * MIB },
      { name: 'Synthetic RTX 9001', driverVersion: '610.11', vramTotalBytes: 4096 * MIB, vramAvailableBytes: 3000 * MIB },
    ]);
  });

  it('parses a single GPU with LF line ending', () => {
    const rows = parseNvidiaSmiCsv(nvidiaSmiSingleGpu);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Synthetic RTX 9000');
  });

  it('turns [N/A] values into null instead of crashing', () => {
    const rows = parseNvidiaSmiCsv(nvidiaSmiWithNa);
    expect(rows[0]).toEqual({ name: 'Synthetic RTX 9000', driverVersion: null, vramTotalBytes: null, vramAvailableBytes: null });
  });

  it('turns missing VRAM columns into null', () => {
    const rows = parseNvidiaSmiCsv(nvidiaSmiPartialVram);
    expect(rows[0]).toEqual({ name: 'Synthetic RTX 9000', driverVersion: '610.11', vramTotalBytes: 24576 * MIB, vramAvailableBytes: null });
  });

  it('treats short rows as unknown trailing fields and skips blank lines', () => {
    const rows = parseNvidiaSmiCsv(`Synthetic RTX 9000\r\n\r\n\r\n`);
    expect(rows).toEqual([
      { name: 'Synthetic RTX 9000', driverVersion: null, vramTotalBytes: null, vramAvailableBytes: null },
    ]);
  });

  it('returns an empty list for empty output', () => {
    expect(parseNvidiaSmiCsv(nvidiaSmiEmpty)).toEqual([]);
  });
});

describe('parseCimJson', () => {
  const pick = (raw) => (raw && typeof raw === 'object' && 'Name' in raw ? String(raw.Name) : null);

  it('normalizes a single JSON object into a one-element array', () => {
    expect(parseCimJson('{"Name":"A"}', pick)).toEqual(['A']);
  });

  it('passes arrays through', () => {
    expect(parseCimJson('[{"Name":"A"},{"Name":"B"}]', pick)).toEqual(['A', 'B']);
  });

  it('returns null for malformed JSON', () => {
    expect(parseCimJson(cimMalformed, pick)).toBeNull();
    expect(parseCimJson(volumeJsonMalformed, pick)).toBeNull();
  });

  it('returns an empty array for blank output', () => {
    expect(parseCimJson('  \r\n ', pick)).toEqual([]);
  });

  it('drops rows the pick function rejects', () => {
    expect(parseCimJson('[{"Name":"A"},{"Foo":1}]', pick)).toEqual(['A']);
  });

  it('treats JSON null as empty', () => {
    expect(parseCimJson('null', pick)).toEqual([]);
  });
});

describe('parseBatteryStatus', () => {
  it('maps BatteryStatus 1 (discharging) to on battery', () => {
    expect(parseBatteryStatus(batteryJsonDischarging)).toBe(true);
  });

  it('maps other statuses (AC) to not on battery', () => {
    expect(parseBatteryStatus(batteryJsonAc)).toBe(false);
    expect(parseBatteryStatus(batteryObjectForm)).toBe(false);
  });

  it('treats empty output (no battery) as not on battery', () => {
    expect(parseBatteryStatus(batteryEmptyOutput)).toBe(false);
    expect(parseBatteryStatus('[]')).toBe(false);
  });

  it('returns null (unknown) when the shape is unusable', () => {
    expect(parseBatteryStatus('{}')).toBeNull();
    expect(parseBatteryStatus('garbage')).toBeNull();
    expect(parseBatteryStatus('null')).toBeNull();
  });
});

describe('parseStatfs', () => {
  it('converts statfs blocks to bytes', () => {
    expect(parseStatfs(statfsSnapshot)).toEqual({
      totalBytes: statfsSnapshot.blocks * statfsSnapshot.bsize,
      availableBytes: statfsSnapshot.bavail * statfsSnapshot.bsize,
    });
  });

  it('returns null when statfs failed', () => {
    expect(parseStatfs(null)).toBeNull();
  });
});

describe('toVolumeFromCim', () => {
  it('maps a Win32_LogicalDisk row to VolumeInfo shape (DriveType unknown → null)', () => {
    expect(toVolumeFromCim({ DeviceID: 'X:', Size: 1099511627776, FreeSpace: 549755813888 })).toEqual({
      mount: 'X:\\',
      totalBytes: 1099511627776,
      availableBytes: 549755813888,
      driveType: null,
    });
  });

  it('keeps a usable DriveType (2 = removable, 3 = fixed)', () => {
    expect(toVolumeFromCim({ DeviceID: 'Y:', DriveType: 2, Size: 1, FreeSpace: 1 }).driveType).toBe(2);
    expect(toVolumeFromCim({ DeviceID: 'X:', DriveType: 3, Size: 1, FreeSpace: 1 }).driveType).toBe(3);
  });

  it('downgrades an unsupported DriveType to null instead of guessing', () => {
    expect(toVolumeFromCim({ DeviceID: 'X:', DriveType: 1, Size: 1, FreeSpace: 1 }).driveType).toBeNull();
    expect(toVolumeFromCim({ DeviceID: 'X:', DriveType: '3', Size: 1, FreeSpace: 1 }).driveType).toBeNull();
  });

  it('rejects rows with missing or invalid fields', () => {
    expect(toVolumeFromCim({ Size: 1, FreeSpace: 1 })).toBeNull();
    expect(toVolumeFromCim({ DeviceID: 'X:', Size: -1, FreeSpace: 1 })).toBeNull();
    expect(toVolumeFromCim({ DeviceID: 'X:', Size: '1099', FreeSpace: 1 })).toBeNull();
    expect(toVolumeFromCim(null)).toBeNull();
  });
});

describe('toDiskDriveFromCim', () => {
  it('maps a Win32_DiskDrive row with empty text fields as null', () => {
    expect(
      toDiskDriveFromCim({
        DeviceID: '\\\\.\\PHYSICALDRIVE0',
        Model: '  ',
        InterfaceType: 'NVMe',
        PNPDeviceID: '',
        MediaType: 'Fixed hard disk media',
      }),
    ).toEqual({
      deviceId: '\\\\.\\PHYSICALDRIVE0',
      model: null,
      interfaceType: 'NVMe',
      pnpDeviceId: null,
      mediaType: 'Fixed hard disk media',
    });
  });

  it('keeps the external-disk media label used by USB-bridge enclosures', () => {
    expect(
      toDiskDriveFromCim({ DeviceID: '\\\\.\\PHYSICALDRIVE1', MediaType: 'External hard disk media' })?.mediaType,
    ).toBe('External hard disk media');
  });

  it('rejects rows without a DeviceID', () => {
    expect(toDiskDriveFromCim({ Model: 'x' })).toBeNull();
    expect(toDiskDriveFromCim(null)).toBeNull();
  });
});

describe('parseWmiRef and toWmiRefPair', () => {
  it('parses both documented reference forms', () => {
    expect(parseWmiRef('Win32_DiskDrive.DeviceID="\\\\.\\PHYSICALDRIVE0"')).toEqual({
      className: 'Win32_DiskDrive',
      deviceId: '\\\\.\\PHYSICALDRIVE0',
    });
    expect(parseWmiRef('Win32_DiskPartition (DeviceID = "Disk #0, Partition #2")')).toEqual({
      className: 'Win32_DiskPartition',
      deviceId: 'Disk #0, Partition #2',
    });
  });

  it('degrades non-reference values to null', () => {
    expect(parseWmiRef('123')).toBeNull();
    expect(parseWmiRef(null)).toBeNull();
    expect(parseWmiRef(undefined)).toBeNull();
    expect(parseWmiRef('Win32_LogicalDisk (DeviceID = "C:") extra')).toBeNull();
  });

  it('maps an association row to its two endpoint refs with class names', () => {
    expect(
      toWmiRefPair({
        Antecedent: 'Win32_DiskDrive (DeviceID = "\\\\.\\PHYSICALDRIVE0")',
        Dependent: 'Win32_DiskPartition (DeviceID = "Disk #0, Partition #2")',
      }),
    ).toEqual({
      antecedent: { className: 'Win32_DiskDrive', deviceId: '\\\\.\\PHYSICALDRIVE0' },
      dependent: { className: 'Win32_DiskPartition', deviceId: 'Disk #0, Partition #2' },
    });
  });

  it('degrades malformed rows to null endpoints', () => {
    expect(toWmiRefPair({ Antecedent: 'no ref', Dependent: 'Win32_DiskPartition.DeviceID="X"' })).toEqual({
      antecedent: null,
      dependent: { className: 'Win32_DiskPartition', deviceId: 'X' },
    });
    expect(toWmiRefPair({})).toEqual({ antecedent: null, dependent: null });
    expect(toWmiRefPair(null)).toBeNull();
  });
});

describe('joinVolumeDetails', () => {
  it('joins logical disks → partitions → physical drives and classifies external', () => {
    const volumes = joinVolumeDetails({
      logicalDisks: parseCimJson(logicalDisksJson, toVolumeFromCim) ?? [],
      diskDrives: parseCimJson(diskDrivesJson, toDiskDriveFromCim),
      diskToPartition: parseCimJson(diskToPartitionJson, toWmiRefPair),
      logicalToPartition: parseCimJson(logicalToPartitionJson, toWmiRefPair),
    });
    expect(volumes).toEqual([
      {
        mount: 'X:\\',
        totalBytes: 1099511627776,
        availableBytes: 549755813888,
        driveType: 3,
        bus: 'NVMe',
        external: false,
        model: 'Synthetic NVMe',
      },
      {
        mount: 'Y:\\',
        totalBytes: 2199023255552,
        availableBytes: 1099511627776,
        driveType: 2,
        bus: 'USB',
        external: true,
        model: 'Synthetic USB SSD',
      },
    ]);
  });

  it('classifies a USB-fixed volume via the interface even with no media label', () => {
    const volumes = joinVolumeDetails({
      logicalDisks: [
        { mount: 'E:\\', totalBytes: 1, availableBytes: 1, driveType: 3 },
        { mount: 'C:\\', totalBytes: 1, availableBytes: 1, driveType: 3 },
      ],
      diskDrives: [
        {
          deviceId: '\\\\.\\PHYSICALDRIVE1',
          model: 'Synthetic USB SSD',
          interfaceType: 'USB',
          pnpDeviceId: null,
          mediaType: null,
        },
        {
          deviceId: '\\\\.\\PHYSICALDRIVE0',
          model: 'Synthetic NVMe',
          interfaceType: 'NVMe',
          pnpDeviceId: 'SCSI\\DISK&VEN_NVMESSD',
          mediaType: null,
        },
      ],
      diskToPartition: [
        {
          antecedent: { className: 'Win32_DiskDrive', deviceId: '\\\\.\\PHYSICALDRIVE1' },
          dependent: { className: 'Win32_DiskPartition', deviceId: 'P1' },
        },
        {
          antecedent: { className: 'Win32_DiskDrive', deviceId: '\\\\.\\PHYSICALDRIVE0' },
          dependent: { className: 'Win32_DiskPartition', deviceId: 'P0' },
        },
      ],
      // Real-machine orientation: partition on the Antecedent side.
      logicalToPartition: [
        {
          antecedent: { className: 'Win32_DiskPartition', deviceId: 'P1' },
          dependent: { className: 'Win32_LogicalDisk', deviceId: 'E:' },
        },
        {
          antecedent: { className: 'Win32_DiskPartition', deviceId: 'P0' },
          dependent: { className: 'Win32_LogicalDisk', deviceId: 'C:' },
        },
      ],
    });
    expect(volumes.map((v) => [v.mount, v.external])).toEqual([
      ['E:\\', true],
      ['C:\\', false],
    ]);
  });

  it('classifies a SCSI USB-bridge enclosure as external via the media label', () => {
    // The actual machine: a JMicron bridge exposes the disk as SCSI with an
    // "External hard disk media" label — neither USB interface nor USBSTOR PNP.
    const volumes = joinVolumeDetails({
      logicalDisks: [{ mount: 'E:\\', totalBytes: 1, availableBytes: 1, driveType: 3 }],
      diskDrives: [
        {
          deviceId: '\\\\.\\PHYSICALDRIVE1',
          model: 'JMicron Generic SCSI Disk Device',
          interfaceType: 'SCSI',
          pnpDeviceId: 'SCSI\\DISK&VEN_JMICRON&PROD_GENERIC\\8&A58FE88&1&000000',
          mediaType: 'External hard disk media',
        },
      ],
      diskToPartition: [
        {
          antecedent: { className: 'Win32_DiskDrive', deviceId: '\\\\.\\PHYSICALDRIVE1' },
          dependent: { className: 'Win32_DiskPartition', deviceId: 'P0' },
        },
      ],
      logicalToPartition: [
        {
          antecedent: { className: 'Win32_DiskPartition', deviceId: 'P0' },
          dependent: { className: 'Win32_LogicalDisk', deviceId: 'E:' },
        },
      ],
    });
    expect(volumes).toEqual([
      {
        mount: 'E:\\',
        totalBytes: 1,
        availableBytes: 1,
        driveType: 3,
        bus: 'SCSI',
        external: true,
        model: 'JMicron Generic SCSI Disk Device',
      },
    ]);
  });

  it('marks a built-in SCSI NVMe with a fixed-media label as built-in', () => {
    const volumes = joinVolumeDetails({
      logicalDisks: [{ mount: 'C:\\', totalBytes: 1, availableBytes: 1, driveType: 3 }],
      diskDrives: [
        {
          deviceId: '\\\\.\\PHYSICALDRIVE0',
          model: 'UMIS RPJYJ1T24MML1AWY',
          interfaceType: 'SCSI',
          pnpDeviceId: 'SCSI\\DISK&VEN_NVME&PROD_UMIS_RPJYJ1T24MM\\5&B9A1CB6&0&000000',
          mediaType: 'Fixed hard disk media',
        },
      ],
      diskToPartition: [
        {
          antecedent: { className: 'Win32_DiskDrive', deviceId: '\\\\.\\PHYSICALDRIVE0' },
          dependent: { className: 'Win32_DiskPartition', deviceId: 'P0' },
        },
      ],
      logicalToPartition: [
        {
          antecedent: { className: 'Win32_DiskPartition', deviceId: 'P0' },
          dependent: { className: 'Win32_LogicalDisk', deviceId: 'C:' },
        },
      ],
    });
    expect(volumes.map((v) => [v.mount, v.bus, v.external])).toEqual([['C:\\', 'SCSI', false]]);
  });

  it('treats an unbound fixed volume as unknown (null) rather than guessing built-in', () => {
    const volumes = joinVolumeDetails({
      logicalDisks: [{ mount: 'D:\\', totalBytes: 1, availableBytes: 1, driveType: 3 }],
      diskDrives: null,
      diskToPartition: null,
      logicalToPartition: null,
    });
    expect(volumes).toEqual([
      { mount: 'D:\\', totalBytes: 1, availableBytes: 1, driveType: 3, bus: null, external: null, model: null },
    ]);
  });
});

describe('parseRegistryNames', () => {
  it('extracts display-adapter names from the registry snapshot', () => {
    expect(parseRegistryNames(registryNamesJson)).toEqual([
      'Synthetic RTX 9000',
      'Synthetic iGPU 2000',
      'Synthetic iGPU 2000',
    ]);
  });

  it('returns [] for empty or malformed output', () => {
    expect(parseRegistryNames(registryNamesEmpty)).toEqual([]);
    expect(parseRegistryNames('zlib:broken')).toEqual([]);
  });
});

describe('describeOs', () => {
  it('uses the Windows edition label when available', () => {
    expect(describeOs('Windows 11 Home China', 'win32', '10.0.26200', 'x64')).toBe('Windows 11 Home China (x64)');
  });

  it('falls back to platform + release for generic labels', () => {
    expect(describeOs('', 'linux', '6.6.1', 'arm64')).toBe('linux 6.6.1 (arm64)');
    expect(describeOs('Windows_NT', 'win32', '10.0.26200', 'x64')).toBe('Windows_NT 10.0.26200 (x64)');
  });
});

