export function chunkMangas(mangas = [], columns = 1) {
  const safeColumns = Math.max(1, Math.floor(Number(columns) || 1));
  const rows = [];
  for (let index = 0; index < mangas.length; index += safeColumns) {
    rows.push(mangas.slice(index, index + safeColumns));
  }
  return rows;
}

export function resolveVirtualGridMetrics(cardSize = 'comfortable', itemCount = 0) {
  const size = cardSize === 'compact' || cardSize === 'large' ? cardSize : 'comfortable';
  const performanceMode = Number(itemCount) >= 150;
  return {
    minCard: size === 'compact' ? 180 : size === 'large' ? 320 : 240,
    rowHeight: size === 'compact' ? 460 : size === 'large' ? 620 : 540,
    performanceMode,
    overscan: performanceMode ? 0 : 1
  };
}

export const HORIZON_CARD_METRICS = Object.freeze({
  compact: Object.freeze({ minCard: 180, gap: 14, footerHeight: 100 }),
  comfortable: Object.freeze({ minCard: 240, gap: 18, footerHeight: 118 }),
  large: Object.freeze({ minCard: 320, gap: 20, footerHeight: 126 })
});

export function resolveVirtualGridLayout({
  cardSize = 'comfortable',
  itemCount = 0,
  containerWidth = 0,
  visualVariant = 'classic',
  horizontalPadding = 48
} = {}) {
  const base = resolveVirtualGridMetrics(cardSize, itemCount);
  if (visualVariant !== 'horizon' || !Number.isFinite(Number(containerWidth)) || Number(containerWidth) <= 0) {
    return {
      ...base,
      columns: 1,
      columnWidth: base.minCard,
      gap: 18,
      footerHeight: 0,
      cardHeight: Math.max(1, base.rowHeight - 18)
    };
  }

  const size = cardSize === 'compact' || cardSize === 'large' ? cardSize : 'comfortable';
  const metric = HORIZON_CARD_METRICS[size];
  const padding = Math.max(0, Number(horizontalPadding) || 0);
  const usableWidth = Math.max(metric.minCard, Number(containerWidth) - padding);
  const columns = Math.max(1, Math.floor((usableWidth + metric.gap) / (metric.minCard + metric.gap)));
  const columnWidth = Math.max(metric.minCard, (usableWidth - (metric.gap * (columns - 1))) / columns);
  const frameInset = 10;
  const coverHeight = Math.ceil(Math.max(1, columnWidth - frameInset) * 1.5);
  const cardHeight = frameInset + coverHeight + metric.footerHeight;

  return {
    ...base,
    minCard: metric.minCard,
    columns,
    columnWidth,
    gap: metric.gap,
    footerHeight: metric.footerHeight,
    coverHeight,
    cardHeight,
    rowHeight: cardHeight + metric.gap
  };
}
