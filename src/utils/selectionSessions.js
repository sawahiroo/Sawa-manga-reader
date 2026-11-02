const EMPTY_SESSION = Object.freeze({
  mode: false,
  selectedIds: Object.freeze([]),
  anchorId: null
});

export function normalizeSelectionId(id) {
  return String(id ?? '').trim();
}

function uniqueIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : [])
    .map(normalizeSelectionId)
    .filter(Boolean))];
}

export function resolveMangaSelectionIntent(event = {}, selectionMode = false) {
  const button = Number(event?.button ?? 0);
  if (button === 1) return selectionMode ? 'ignore' : 'open-background';
  if (button !== 0) return 'ignore';
  if (selectionMode || event?.ctrlKey || event?.metaKey || event?.shiftKey) return 'toggle-selection';
  return 'open';
}

export function makeSelectionSessionKey({
  interfaceMode = 'sawa',
  tabId = 'tab',
  view = 'library'
} = {}) {
  return [interfaceMode, tabId, view]
    .map((part) => encodeURIComponent(String(part || '').trim() || '_'))
    .join(':');
}

export function createSelectionSessionsState() {
  return { sessions: {} };
}

export function getSelectionSession(state, key) {
  return state?.sessions?.[key] || EMPTY_SESSION;
}

function updateSession(state, key, updater) {
  const previous = getSelectionSession(state, key);
  const next = updater(previous);
  if (next === previous) return state;
  return {
    ...state,
    sessions: {
      ...(state?.sessions || {}),
      [key]: {
        mode: Boolean(next.mode),
        selectedIds: uniqueIds(next.selectedIds),
        anchorId: normalizeSelectionId(next.anchorId) || null
      }
    }
  };
}

function rangeBetween(orderedIds, anchorId, targetId) {
  const order = uniqueIds(orderedIds);
  const anchorIndex = order.indexOf(anchorId);
  const targetIndex = order.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) return [targetId];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return order.slice(start, end + 1);
}

export function selectionSessionsReducer(state = createSelectionSessionsState(), action = {}) {
  const key = String(action.key || '').trim();
  if (!key) return state;

  switch (action.type) {
    case 'enter':
      return updateSession(state, key, (session) => ({ ...session, mode: true }));
    case 'exit':
      return updateSession(state, key, () => EMPTY_SESSION);
    case 'clear':
      return updateSession(state, key, (session) => ({
        ...session,
        mode: true,
        selectedIds: [],
        anchorId: null
      }));
    case 'select-all':
      return updateSession(state, key, (session) => ({
        ...session,
        mode: true,
        selectedIds: uniqueIds(action.orderedIds),
        anchorId: uniqueIds(action.orderedIds).at(-1) || session.anchorId
      }));
    case 'invert':
      return updateSession(state, key, (session) => {
        const selected = new Set(session.selectedIds);
        const visible = uniqueIds(action.orderedIds);
        const keptHidden = session.selectedIds.filter((id) => !visible.includes(id));
        return {
          ...session,
          mode: true,
          selectedIds: [...keptHidden, ...visible.filter((id) => !selected.has(id))],
          anchorId: session.anchorId
        };
      });
    case 'remove':
      return updateSession(state, key, (session) => {
        const removed = new Set(uniqueIds(action.ids));
        return {
          ...session,
          selectedIds: session.selectedIds.filter((id) => !removed.has(id)),
          anchorId: removed.has(session.anchorId) ? null : session.anchorId
        };
      });
    case 'toggle':
      return updateSession(state, key, (session) => {
        const id = normalizeSelectionId(action.id);
        if (!id) return session;
        const selected = new Set(session.selectedIds);
        if (action.shiftKey && session.anchorId) {
          const range = rangeBetween(action.orderedIds, session.anchorId, id);
          range.forEach((rangeId) => selected.add(rangeId));
        } else if (selected.has(id)) {
          selected.delete(id);
        } else {
          selected.add(id);
        }
        return {
          mode: true,
          selectedIds: [...selected],
          anchorId: action.shiftKey && session.anchorId ? session.anchorId : id
        };
      });
    default:
      return state;
  }
}

export function getSelectionSummary(session, visibleIds = []) {
  const visible = new Set(uniqueIds(visibleIds));
  const selectedIds = uniqueIds(session?.selectedIds);
  return {
    selectedCount: selectedIds.length,
    hiddenCount: selectedIds.filter((id) => !visible.has(id)).length,
    selectedIds,
    selectedIdSet: new Set(selectedIds)
  };
}
