import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizePersistedSessionPayload } = require('../electron/services/storage.cjs');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

describe('Sawa 4.1 shared search experience', () => {
  it('purges all legacy searches once when the privacy marker is absent', () => {
    const normalized = normalizePersistedSessionPayload({
      version: 4,
      activeWorkspaceId: 'w',
      workspaces: [{
        id: 'w',
        name: 'Principal',
        activeTabId: 'legacy',
        tabs: [
          { id: 'legacy', search: 'ancien prive', stack: [{ screen: 'library' }] },
          {
            id: 'modern',
            searchState: {
              query: 'ancienne annotation privee',
              scope: 'all',
              filters: [{ field: 'tag', value: 'seinen' }, { field: 'bad', value: 'x' }]
            },
            stack: [{ screen: 'library' }]
          }
        ]
      }]
    });
    expect(normalized.version).toBe(8);
    expect(normalized.searchPrivacyVersion).toBe(1);
    expect(normalized.workspaces[0].tabs[0].searchState).toEqual({
      query: '',
      scope: 'current',
      filters: []
    });
    expect(normalized.workspaces[0].tabs[1].searchState).toEqual({
      query: '',
      scope: 'current',
      filters: []
    });
    expect(JSON.stringify(normalized)).not.toMatch(/ancien prive|annotation privee|seinen/);
  });

  it('preserves a public per-tab search after the current privacy marker is stored', () => {
    const normalized = normalizePersistedSessionPayload({
      version: 4,
      searchPrivacyVersion: 1,
      activeWorkspaceId: 'w',
      workspaces: [{
        id: 'w',
        activeTabId: 'public',
        tabs: [{
          id: 'public',
          searchState: {
            query: 'berserk',
            scope: 'all',
            filters: [{ field: 'tag', value: 'seinen' }]
          },
          stack: [{ screen: 'library' }]
        }]
      }]
    });
    expect(normalized.searchPrivacyVersion).toBe(1);
    expect(normalized.workspaces[0].tabs[0].searchState).toMatchObject({
      query: 'berserk',
      scope: 'all',
      filters: [{ field: 'tag', value: 'seinen' }]
    });
  });

  it('uses one shared component in Sawa and Kavita with keyboard and zero-state recovery', () => {
    const component = read('src/components/SearchExperience.jsx');
    const topbar = read('src/components/TopBar.jsx');
    const kavita = read('src/interfaces/kavita/KavitaShell.jsx');
    expect(topbar).toContain('<SearchExperience');
    expect(kavita).toContain('<SearchExperience');
    expect(component).toContain('role="combobox"');
    expect(component).toContain("event.key === 'Enter'");
    expect(component).toContain("event.key === 'Escape'");
    expect(component).toContain('Aucun resultat pour');
    expect(component).toContain('Toute la bibliotheque');
    expect(component).toContain('Retirer les filtres');
  });

  it('persists searchState per tab and avoids immediate extended IPC per keystroke', () => {
    const app = read('src/App.jsx');
    expect(app).toContain('searchState: serializeTabSearchState(tab');
    expect(app).toContain('searchPrivacyVersion: SEARCH_PRIVACY_VERSION');
    expect(app).toContain('requiresSearchPrivacyMigration');
    expect(app).toContain('createDeferredSearchController');
    expect(app).toContain('delay: 260');
    expect(app).toContain('advancedSearchResultsMatch(advancedSearchState');
    expect(app).toContain('results: []');
    expect(app).toContain('neutralizeActivePrivateSearch');
    expect(app).toContain("activeScreen === 'vault' || Boolean(activeTab?.searchPrivate)");
    expect(app).not.toMatch(/useEffect\(\(\) => \{[\s\S]{0,500}window\.mangaAPI\.searchAdvanced/);
    expect(app).toContain("privateContext: activeScreen === 'vault'");
    expect(app).toContain('incognito: Boolean(activeTab?.incognito)');
  });
});
