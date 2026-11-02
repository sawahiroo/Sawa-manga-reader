import { describe, expect, it } from 'vitest';
import storage from '../electron/services/storage.cjs';
import {
  DEFAULT_HORIZON_PREFERENCES,
  normalizeHorizonPreferences,
  resolveAdaptiveVisualEffects,
  selectHorizonResume
} from '../src/utils/horizon.js';

describe('Sawa Horizon v7', () => {
  it('migrates v6 without touching library data and enables Horizon by default', () => {
    const source = {
      version: 6,
      stateVersion: 6,
      session: { version: 6 },
      categories: [{ id: 'scan', path: 'D:\\SCAN', name: 'SCAN' }],
      favorites: { manga: true },
      ui: { interfaceMode: 'sawa', theme: 'coffee-house' }
    };
    const migrated = storage.normalizeState(source);
    expect(migrated).toMatchObject({
      version: 7,
      stateVersion: 7,
      session: { version: 8 },
      categories: source.categories,
      favorites: source.favorites,
      ui: { interfaceMode: 'sawa', theme: 'coffee-house', sawaExperience: 'horizon' }
    });
    expect(migrated.ui).toMatchObject(DEFAULT_HORIZON_PREFERENCES);
  });

  it('keeps the Classic fallback and clamps visual intensity settings', () => {
    expect(normalizeHorizonPreferences({
      sawaExperience: 'classic',
      cinematicIntensity: 900,
      foilIntensity: -4,
      readerControlsHideMs: 100
    })).toMatchObject({
      sawaExperience: 'classic',
      cinematicIntensity: 100,
      foilIntensity: 0,
      readerControlsHideMs: 1000
    });
  });

  it('disables dynamic foil for reduced motion, performance mode or slow frames', () => {
    expect(resolveAdaptiveVisualEffects({ foilEnabled: true })).toMatchObject({ foil: true, dynamicFoil: true });
    expect(resolveAdaptiveVisualEffects({ foilEnabled: true, reducedMotion: true }).dynamicFoil).toBe(false);
    expect(resolveAdaptiveVisualEffects({ foilEnabled: true, performanceMode: true }).dynamicFoil).toBe(false);
    expect(resolveAdaptiveVisualEffects({ foilEnabled: true, slowFrames: true }).dynamicFoil).toBe(false);
  });

  it('selects the latest unfinished reading and excludes it from recents', () => {
    const items = [
      { id: 'a', progressPercent: 40, lastReadAt: '2026-08-20T10:00:00Z' },
      { id: 'b', progressPercent: 70, lastReadAt: '2026-08-22T10:00:00Z' },
      { id: 'c', progressPercent: 100, lastReadAt: '2026-08-23T10:00:00Z' }
    ];
    const model = selectHorizonResume(items, { recentLimit: 4 });
    expect(model.resume?.id).toBe('b');
    expect(model.recents.map((item) => item.id)).toEqual(['c', 'a']);
  });
});
