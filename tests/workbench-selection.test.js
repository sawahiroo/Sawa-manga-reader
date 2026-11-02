import { describe, expect, it } from 'vitest';
import {
  invertWorkbenchSelection,
  normalizeWorkbenchIds,
  selectWorkbenchRange,
  summarizeWorkbenchSelection,
  toggleWorkbenchSelection
} from '../src/utils/workbenchSelection.js';

describe('workbench multiple selection', () => {
  it('normalizes mixed identifiers and toggles deterministically', () => {
    expect(normalizeWorkbenchIds([1, '1', ' two ', null])).toEqual(['1', 'two']);
    expect([...toggleWorkbenchSelection(new Set(['1']), 2, true)]).toEqual(['1', '2']);
  });

  it('selects a virtual range using the complete filtered order', () => {
    const order = Array.from({ length: 500 }, (_, index) => `m${index}`);
    const selected = selectWorkbenchRange(new Set(), order, 'm10', 'm410');
    expect(selected.size).toBe(401);
    expect(selected.has('m250')).toBe(true);
  });

  it('inverts visible rows without losing hidden selections', () => {
    const selected = invertWorkbenchSelection(new Set(['hidden', 'a']), ['a', 'b']);
    expect([...selected]).toEqual(['hidden', 'b']);
    expect(summarizeWorkbenchSelection(selected, ['a', 'b'])).toMatchObject({ total: 2, visibleSelected: 1, hidden: 1 });
  });
});
