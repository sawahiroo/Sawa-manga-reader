import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizePersistedSessionPayload } = require('../electron/services/storage.cjs');
const { sanitizeSessionSearchPrivacy } = require('../electron/services/privacySanitizer.cjs');

describe('tab-local screen context', () => {
  it('keeps independent screens, vault filters, and searches during session normalization', () => {
    const normalized = normalizePersistedSessionPayload({
      version: 8,
      searchPrivacyVersion: 1,
      activeWorkspaceId: 'workspace-1',
      workspaces: [{
        id: 'workspace-1',
        activeTabId: 'tab-vault',
        tabs: [
          {
            id: 'tab-library',
            screen: 'library',
            searchState: { query: 'public', scope: 'current', filters: [] },
            stack: [{ screen: 'library' }]
          },
          {
            id: 'tab-vault',
            screen: 'vault',
            vaultCategoryFilterId: 'private-category',
            searchState: { query: 'secret', scope: 'current', filters: [] },
            stack: [{ screen: 'library' }]
          }
        ]
      }]
    });

    const tabs = normalized.workspaces[0].tabs;
    expect(normalized.version).toBe(8);
    expect(tabs[0]).toMatchObject({ screen: 'library', vaultCategoryFilterId: null });
    expect(tabs[0].searchState.query).toBe('public');
    expect(tabs[1]).toMatchObject({ screen: 'vault', vaultCategoryFilterId: 'private-category' });
    expect(tabs[1].searchState.query).toBe('secret');
  });

  it('preserves the vault screen and filter while masking private search at lock time', () => {
    const sanitized = sanitizeSessionSearchPrivacy({
      version: 8,
      searchPrivacyVersion: 1,
      workspaces: [{
        id: 'workspace-1',
        tabs: [{
          id: 'tab-vault',
          screen: 'vault',
          vaultCategoryFilterId: 'private-category',
          searchPrivate: true,
          searchState: { query: 'secret', scope: 'current', filters: [] },
          stack: [{ screen: 'library', mangaId: 'private-manga' }]
        }]
      }]
    }, {
      vaultLocked: true,
      privateMangaIds: new Set(['private-manga'])
    });

    const tab = sanitized.workspaces[0].tabs[0];
    expect(tab).toMatchObject({ screen: 'vault', vaultCategoryFilterId: 'private-category' });
    expect(tab.searchState).toEqual({ query: '', scope: 'current', filters: [] });
  });
});
