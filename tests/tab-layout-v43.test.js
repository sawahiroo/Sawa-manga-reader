import { describe, expect, it } from 'vitest';
import { computeTabLayout } from '../src/utils/tabLayout.js';

function tabs(count, pinned = 0) {
  return Array.from({ length: count }, (_, index) => ({ id: `tab-${index}`, pinned: index < pinned }));
}

describe('continuous Sawa tab layout', () => {
  it.each([1, 5, 10, 20, 40])('keeps all %i tabs in one continuous strip', (count) => {
    const layout = computeTabLayout({ tabs: tabs(count, count > 1 ? 1 : 0), availableWidth: 1280 });
    expect(layout.visibleTabs).toHaveLength(count);
    expect(layout.overflowTabs).toEqual([]);
    expect(layout.regularWidth).toBeGreaterThanOrEqual(112);
  });

  it('shrinks every regular tab continuously without hiding tabs', () => {
    const five = computeTabLayout({ tabs: tabs(5), availableWidth: 900 });
    const six = computeTabLayout({ tabs: tabs(6), availableWidth: 900 });
    expect(five.visibleTabs).toHaveLength(5);
    expect(six.visibleTabs).toHaveLength(6);
    expect(five.overflowTabs).toEqual([]);
    expect(six.regularWidth).toBeLessThan(five.regularWidth);
    expect(six.regularWidth).toBeGreaterThanOrEqual(112);
  });

  it('keeps pinned tabs fixed and uses horizontal scrolling only below readable width', () => {
    const comfortable = computeTabLayout({ tabs: tabs(10, 2), availableWidth: 1500 });
    const extreme = computeTabLayout({ tabs: tabs(40, 3), availableWidth: 920 });
    expect(comfortable.pinnedWidth).toBe(38);
    expect(comfortable.hasOverflow).toBe(false);
    expect(extreme.regularWidth).toBe(112);
    expect(extreme.hasOverflow).toBe(true);
    expect(extreme.iconOnly).toBe(false);
  });
});
