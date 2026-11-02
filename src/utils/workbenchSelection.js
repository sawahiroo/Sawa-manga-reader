export function normalizeWorkbenchIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))];
}

export function toggleWorkbenchSelection(current, mangaId, checked) {
  const id = String(mangaId ?? '').trim();
  const next = new Set(normalizeWorkbenchIds([...(current || [])]));
  if (!id) return next;
  if (checked ?? !next.has(id)) next.add(id);
  else next.delete(id);
  return next;
}

export function selectWorkbenchRange(current, orderedIds, anchorId, targetId, checked = true) {
  const order = normalizeWorkbenchIds(orderedIds);
  const anchorIndex = order.indexOf(String(anchorId ?? '').trim());
  const targetIndex = order.indexOf(String(targetId ?? '').trim());
  if (anchorIndex < 0 || targetIndex < 0) {
    return toggleWorkbenchSelection(current, targetId, checked);
  }
  const next = new Set(normalizeWorkbenchIds([...(current || [])]));
  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  order.slice(from, to + 1).forEach((id) => checked ? next.add(id) : next.delete(id));
  return next;
}

export function invertWorkbenchSelection(current, ids) {
  const next = new Set(normalizeWorkbenchIds([...(current || [])]));
  normalizeWorkbenchIds(ids).forEach((id) => next.has(id) ? next.delete(id) : next.add(id));
  return next;
}

export function summarizeWorkbenchSelection(current, visibleIds) {
  const selected = new Set(normalizeWorkbenchIds([...(current || [])]));
  const visible = new Set(normalizeWorkbenchIds(visibleIds));
  let visibleSelected = 0;
  selected.forEach((id) => {
    if (visible.has(id)) visibleSelected += 1;
  });
  return {
    total: selected.size,
    visibleSelected,
    hidden: Math.max(0, selected.size - visibleSelected),
    allVisibleSelected: visible.size > 0 && visibleSelected === visible.size
  };
}
