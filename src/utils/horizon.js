export const DEFAULT_HORIZON_PREFERENCES = Object.freeze({
  sawaExperience: 'horizon',
  cinematicBackdrop: true,
  cinematicIntensity: 58,
  foilEnabled: true,
  foilIntensity: 28,
  adaptiveVisualEffects: true,
  readerFocusMode: 'auto',
  readerControlsHideMs: 3000
});

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function normalizeHorizonPreferences(input = {}) {
  return {
    sawaExperience: input.sawaExperience === 'classic' ? 'classic' : 'horizon',
    cinematicBackdrop: input.cinematicBackdrop === undefined ? true : Boolean(input.cinematicBackdrop),
    cinematicIntensity: clamp(input.cinematicIntensity, 0, 100, 58),
    foilEnabled: input.foilEnabled === undefined ? true : Boolean(input.foilEnabled),
    foilIntensity: clamp(input.foilIntensity, 0, 100, 28),
    adaptiveVisualEffects: input.adaptiveVisualEffects === undefined ? true : Boolean(input.adaptiveVisualEffects),
    readerFocusMode: input.readerFocusMode === 'off' ? 'off' : 'auto',
    readerControlsHideMs: clamp(input.readerControlsHideMs, 1000, 10000, 3000)
  };
}

export function resolveAdaptiveVisualEffects({
  foilEnabled = true,
  adaptiveVisualEffects = true,
  reducedMotion = false,
  performanceMode = false,
  slowFrames = false
} = {}) {
  const dynamicFoil = Boolean(foilEnabled) && !reducedMotion && !performanceMode
    && (!adaptiveVisualEffects || !slowFrames);
  return { foil: Boolean(foilEnabled), dynamicFoil };
}

function recencyValue(item) {
  const raw = item?.lastReadAt || item?.recentAt || item?.updatedAt || item?.addedAt || 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectHorizonResume(mangas = [], { recentLimit = 8 } = {}) {
  const safe = Array.isArray(mangas) ? mangas.filter(Boolean) : [];
  const sorted = [...safe].sort((a, b) => recencyValue(b) - recencyValue(a));
  const resume = sorted.find((manga) => {
    const progress = Number(manga.progressPercent || 0);
    return progress > 0 && progress < 100 && !manga.isRead;
  }) || null;
  return {
    resume,
    recents: sorted.filter((manga) => String(manga.id) !== String(resume?.id)).slice(0, recentLimit)
  };
}
