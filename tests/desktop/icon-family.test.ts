import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const sizes = [16, 20, 24, 32, 48, 64, 128, 256];
const icons = 'apps/desktop/src-tauri/icons/';

describe('Windows application icon family', () => {
  it('embeds every required size in the ICO with the corresponding PNG bytes', () => {
    const ico = read(`${icons}icon.ico`);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(sizes.length);
    let end = 6 + sizes.length * 16;
    [256, 16, 20, 24, 32, 48, 64, 128].forEach((size, i) => {
      const entry = 6 + i * 16;
      expect(ico[entry] || 256).toBe(size);
      expect(ico[entry + 1] || 256).toBe(size);
      expect(ico.readUInt16LE(entry + 6)).toBe(32);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset).toBe(end);
      expect(ico.subarray(offset, offset + length)).toEqual(read(`${icons}app-${size}.png`));
      end += length;
    });
    expect(end).toBe(ico.length);
  });

  it('provides square RGBA PNGs for accent, dark ink and white ink at all sizes', () => {
    for (const variant of ['app', 'mono-dark', 'mono-light']) {
      for (const size of sizes) {
        const png = read(`${icons}${variant}-${size}.png`);
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(png.readUInt32BE(16)).toBe(size);
        expect(png.readUInt32BE(20)).toBe(size);
        expect(png[24]).toBe(8);
        expect(png[25]).toBe(6);
      }
    }
  });

  it('connects the installer, uninstaller, application/window and visible tray resource', () => {
    const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json').toString());
    expect(config.bundle.icon).toEqual(['icons/icon.ico']);
    expect(config.bundle.windows.nsis.installerIcon).toBe('icons/icon.ico');
    expect(config.bundle.windows.nsis.uninstallerIcon).toBe('icons/icon.ico');
    const tray = read('apps/desktop/src-tauri/src/tray.rs').toString();
    expect(tray).toContain('tauri::include_image!("icons/app-32.png")');
    expect(tray).not.toContain('vec![0, 0, 0, 0]');
    expect(read(`${icons}icon.svg`).toString()).toContain('viewBox="0 0 16 16"');
  });
});
