import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

describe('standard Electron Builder installer', () => {
  it('uses the assisted NSIS target without the legacy custom installer pipeline', () => {
    expect(packageJson.scripts['dist:exe']).toContain('electron-builder --win nsis');
    expect(packageJson.scripts['dist:installer']).toBeUndefined();
    expect(packageJson.scripts['build:installer-ui']).toBeUndefined();
    expect(packageJson.scripts['dev:installer']).toBeUndefined();
    expect(packageJson.build.nsis.oneClick).toBe(false);
    expect(packageJson.build.nsis.allowToChangeInstallationDirectory).toBe(true);
    expect(packageJson.build.nsis.artifactName).toBe('Sawa-Setup-${version}.${ext}');
    expect(packageJson.build.nsis.include).toBeUndefined();
    expect(packageJson.build.nsis.installerSidebar).toBeUndefined();
    expect(packageJson.build.nsis.uninstallerSidebar).toBeUndefined();
    expect(packageJson.build.nsis.installerHeader).toBeUndefined();
    expect(fs.existsSync('build/installer.nsh')).toBe(false);
  });
});
