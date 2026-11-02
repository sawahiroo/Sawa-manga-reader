import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const PRODUCT_FILES = [
  'package.json',
  'installer/package.json',
  'src/components/SettingsDrawer.jsx',
  'installer/ui/src/pages/Welcome.jsx',
  'installer/ui/src/pages/License.jsx',
  'installer/ui/src/pages/Finish.jsx',
  'installer/ui/src/pages/Uninstall.jsx',
  'installer/ui/src/modals/ExistingInstallModal.jsx',
  'installer/ui/src/components/IllustrationPanel.jsx',
  'build/LICENSE.txt'
];

describe('Sawa 5.0.1 release version', () => {
  it('keeps application and installer product surfaces on 5.0.1', () => {
    for (const file of PRODUCT_FILES) {
      const content = fs.readFileSync(file, 'utf8');
      expect(content, file).toContain('5.0.1');
      expect(content, file).not.toContain('4.0.0');
      expect(content, file).not.toContain('4.1.0');
    }
  });
});
