import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const REQUIRED_CHANNELS = [
  'metadata:listProviders',
  'metadata:getWorkbenchPage',
  'metadata:getWorkbenchSelectionIds',
  'metadata:searchCandidates',
  'metadata:startWorkbenchAnalysis',
  'metadata:applyWorkbenchMatches',
  'metadata:resolveWorkbenchItems',
  'metadata:retryWorkbenchItems',
  'metadata:cancelWorkbenchJob'
];

describe('Sawa 4.2 metadata IPC contracts', () => {
  it('registers every validated workbench and provider channel in main', () => {
    const main = fs.readFileSync('electron/main.cjs', 'utf8');
    for (const channel of REQUIRED_CHANNELS) {
      expect(main, channel).toContain(`ipcMain.handle('${channel}'`);
    }
    expect(main).toContain("kind: 'workbench-analysis'");
    expect(main).toContain("kind: 'workbench-apply'");
    expect(main).toContain('mutationResult({ metadataWorkbenchQueue');
  });

  it('exposes only lightweight named calls through preload', () => {
    const preload = fs.readFileSync('electron/preload.cjs', 'utf8');
    for (const channel of REQUIRED_CHANNELS) {
      expect(preload, channel).toContain(`invoke('${channel}'`);
    }
    expect(preload).toContain("invoke('metadata:undoLastWorkbenchBatch'");
  });
});
