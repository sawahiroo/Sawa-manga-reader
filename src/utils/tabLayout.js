const PREFERRED_REGULAR_WIDTH = 176;
const MIN_REGULAR_WIDTH = 112;
const MAX_REGULAR_WIDTH = 220;
const PINNED_WIDTH = 38;

function clampWidth(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function gapForCount(count) {
  if (count >= 32) return 2;
  if (count >= 16) return 4;
  return 6;
}

export function computeTabLayout({ tabs = [], activeTabId: _activeTabId = null, availableWidth = 0 } = {}) {
  const safeTabs = Array.isArray(tabs) ? tabs : [];
  const width = clampWidth(availableWidth);
  const itemCount = safeTabs.length;
  const pinnedCount = safeTabs.filter((tab) => tab.pinned).length;
  const regularCount = itemCount - pinnedCount;
  const tabGap = gapForCount(itemCount);
  const gapsWidth = tabGap * Math.max(0, itemCount - 1);
  const pinnedTotal = pinnedCount * PINNED_WIDTH;
  const widthForRegular = Math.max(0, width - pinnedTotal - gapsWidth);
  const idealRegularWidth = regularCount > 0 ? widthForRegular / regularCount : PREFERRED_REGULAR_WIDTH;
  const regularWidth = Math.min(MAX_REGULAR_WIDTH, PREFERRED_REGULAR_WIDTH, Math.max(MIN_REGULAR_WIDTH, idealRegularWidth));
  const contentWidth = pinnedTotal + (regularCount * regularWidth) + gapsWidth;
  const hasOverflow = contentWidth > width + 0.5;
  const density = regularWidth >= 168 ? 'full' : regularWidth >= 132 ? 'compact' : 'minimal';
  const iconOnly = false;

  return {
    density,
    regularWidth,
    pinnedWidth: PINNED_WIDTH,
    tabGap,
    iconOnly,
    visibleTabs: safeTabs,
    overflowTabs: [],
    hasOverflow,
    contentWidth
  };
}
