import { useState } from 'react';
import { MoonIcon, SparklesIcon, SunIcon, BookIcon, KeyboardIcon, HardDriveIcon, DownloadIcon, UploadIcon, RefreshIcon, ImageIcon, TrashIcon, ArchiveIcon, EyeOffIcon, LockIcon } from './Icons.jsx';

const INTERFACES = [
  {
    id: 'kavita',
    icon: BookIcon,
    title: 'Kavita',
    description: 'Interface independante, plate et dense, avec navigation classique.'
  },
  {
    id: 'sawa',
    icon: SparklesIcon,
    title: 'Sawa',
    description: 'Interface historique riche avec ses effets et ses panneaux visuels.'
  }
];

const THEMES = [
  { id: 'dark-night', icon: MoonIcon, title: 'Dark Night', description: 'Noir profond, contraste premium et lumiere maitrisee.' },
  { id: 'light-paper', icon: SunIcon, title: 'Light Paper', description: "Clair lisible, propre et beaucoup moins casse qu'avant." },
  { id: 'coffee-house', icon: SparklesIcon, title: 'Coffee House', description: 'Tons creme, cacao et verre fume pour une ambiance cosy.' },
  { id: 'neon-city', icon: SparklesIcon, title: 'Neon City', description: 'Fond encre, cyan electrique et contours glow facon cyberpunk.' }
];

const DEFAULT_SHORTCUTS = {
  nextPage: { label: 'Page suivante', keys: ['ArrowRight'] },
  prevPage: { label: 'Page precedente', keys: ['ArrowLeft'] },
  nextChapter: { label: 'Chapitre suivant', keys: ['Ctrl', 'ArrowRight'] },
  prevChapter: { label: 'Chapitre precedent', keys: ['Ctrl', 'ArrowLeft'] },
  toggleFullscreen: { label: 'Plein ecran', keys: ['F'] },
  toggleUI: { label: 'Masquer/Afficher l\'UI', keys: ['H'] },
  zoomIn: { label: 'Zoom +', keys: ['+'] },
  zoomOut: { label: 'Zoom -', keys: ['-'] },
  zoomReset: { label: 'Zoom 100%', keys: ['0'] },
  exitReader: { label: 'Quitter la lecture', keys: ['Escape'] },
  openCommandPalette: { label: 'Palette locale', keys: ['Ctrl', 'K'] },
  toggleReadingQueue: { label: 'Queue de lecture', keys: ['Ctrl', 'Shift', 'Q'] },
  newTab: { label: 'Nouvel onglet', keys: ['Ctrl', 'T'] },
  closeTab: { label: 'Fermer l onglet', keys: ['Ctrl', 'W'] },
  goBack: { label: 'Retour navigateur', keys: ['Alt', 'ArrowLeft'] },
  openSettings: { label: 'Ouvrir les parametres', keys: ['Ctrl', ','] },
  openSources: { label: 'Ouvrir Sources web', keys: ['Ctrl', 'Shift', 'S'] },
  toggleSidebar: { label: 'Replier la barre laterale', keys: ['Ctrl', 'B'] },
  panicLock: { label: 'Verrou panique', keys: ['Ctrl', 'Shift', 'L'] },
  nextTab: { label: 'Onglet suivant', keys: ['Ctrl', 'Tab'] },
  prevTab: { label: 'Onglet precedent', keys: ['Ctrl', 'Shift', 'Tab'] }
};

const SIDEBAR_SECTION_OPTIONS = [
  { id: 'dashboard', label: 'Dashboard', description: 'Vue accueil et apercus.' },
  { id: 'library', label: 'Bibliotheque', description: 'Point d entree principal.', required: true },
  { id: 'collections', label: 'Collections', description: 'Collections manuelles et smart.' },
  { id: 'maintenance', label: 'Entretien', description: 'Scan, OCR, dedup et maintenance.' },
  { id: 'workbench', label: 'Atelier', description: 'File de metadata et traitement.' },
  { id: 'sources', label: 'Sources web', description: 'Recherche et import communautaires.', addon: 'sources' },
  { id: 'vault', label: 'Coffre', description: 'Titres prives et verrouilles.' },
  { id: 'favorites', label: 'Favoris', description: 'Titres epingles.' },
  { id: 'recents', label: 'Recents', description: 'Dernieres lectures.' }
];

function normalizeShortcutKeys(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  }
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  return normalized.split('+').map((entry) => entry.trim()).filter(Boolean);
}

function ColorField({ label, value, onChange, helper }) {
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#8b5cf6';
  return (
    <label className="color-picker-field">
      <span className="color-picker-label">{label}</span>
      <div className="color-picker-control">
        <input className="color-picker-input" type="color" value={safeColor} onChange={(e) => onChange(e.target.value)} />
        <input className="color-picker-text" type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="#8b5cf6" spellCheck={false} />
      </div>
      {helper ? <small>{helper}</small> : null}
    </label>
  );
}

function ShortcutRow({ id, shortcut, customKeys, onRecord }) {
  const [recording, setRecording] = useState(false);
  const displayKeys = normalizeShortcutKeys(customKeys, shortcut.keys);

  function startRecording() {
    setRecording(true);
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const keys = [];
      if (e.ctrlKey || e.metaKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');
      const key = e.key;
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
        keys.push(key.length === 1 ? key.toUpperCase() : key);
      }
      if (keys.length > 0 && !['Control', 'Shift', 'Alt', 'Meta'].includes(keys[keys.length - 1])) {
        onRecord(id, keys);
        setRecording(false);
        window.removeEventListener('keydown', handler, true);
      }
    };
    window.addEventListener('keydown', handler, true);
    // Auto-cancel after 5s
    setTimeout(() => {
      setRecording(false);
      window.removeEventListener('keydown', handler, true);
    }, 5000);
  }

  return (
    <div className="shortcut-row">
      <span className="shortcut-label">{shortcut.label}</span>
      <div className="shortcut-key-wrap">
        {displayKeys.map((k, i) => (
          <span key={i} className={`shortcut-key ${recording ? 'shortcut-recording' : ''}`}>{k}</span>
        ))}
        <button className="ghost-button shortcut-edit-btn" onClick={startRecording}>
          {recording ? '...' : 'Modifier'}
        </button>
      </div>
    </div>
  );
}

export default function SettingsDrawer({
  open,
  ui,
  vault,
  syncStatus,
  plugins = [],
  pluginBusyId = null,
  pluginFeedback = '',
  sidebarSections = [],
  sidebarHiddenSections = {},
  showSources = false,
  onClose,
  onChange,
  onRequestInterfaceMode,
  onPickBackground,
  onRemoveBackground,
  onClearCache,
  onForceRescan,
  onRetrySync,
  onRunDeepScan,
  onRebuildDerivedData,
  onUpdateVaultPrefs,
  onSetPluginEnabled,
  onInstallPlugin,
  onUninstallPlugin,
  onOpenPlugin,
  onLockVault,
  onPanicLock
}) {
  const shortcuts = ui.keyboardShortcuts || {};
  const vaultConfigured = Boolean(vault?.configured);
  const vaultLocked = Boolean(vault?.locked);
  const experimental = ui.experimental || {};
  const metadataProviders = ui.metadataProviders || {};
  const metadataProviderEnabled = metadataProviders.enabled || {};
  const availableSidebarSections = SIDEBAR_SECTION_OPTIONS.filter((section) => showSources || section.id !== 'sources');
  const hiddenSidebarSections = sidebarHiddenSections && typeof sidebarHiddenSections === 'object' ? sidebarHiddenSections : {};
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState(null);
  const visibleSidebarSections = (
    Array.isArray(sidebarSections) && sidebarSections.length > 0
      ? sidebarSections.filter((sectionId) => availableSidebarSections.some((section) => section.id === sectionId) && !hiddenSidebarSections[sectionId])
      : availableSidebarSections.map((section) => section.id)
  );
  function updateMetadataProviders(patch) {
    onChange({
      metadataProviders: {
        ...metadataProviders,
        ...patch,
        enabled: patch.enabled || metadataProviderEnabled
      }
    });
  }

  function setMetadataProviderEnabled(providerId, enabled) {
    updateMetadataProviders({
      enabled: { ...metadataProviderEnabled, [providerId]: Boolean(enabled) }
    });
  }
  async function handleExportSawa() {
    setBackupBusy(true);
    try {
      const result = await window.mangaAPI.exportBackup();
      setBackupFeedback(result?.exported
        ? { ok: true, message: `Sauvegarde exportee: ${result.path}`, details: result }
        : { ok: false, message: result?.error || 'Export annule ou impossible.', details: result, retry: 'export' });
    } catch (err) {
      setBackupFeedback({ ok: false, message: err?.message || 'Export impossible.', details: { error: err?.message }, retry: 'export' });
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleImportSawa() {
    setBackupBusy(true);
    try {
      const result = await window.mangaAPI.importBackup();
      setBackupFeedback(result?.restored
        ? { ok: true, message: `Sauvegarde restauree${result.legacy ? ' (format historique)' : ''}.`, details: result }
        : { ok: false, message: result?.error || 'Import annule ou impossible.', details: result, retry: 'import' });
    } catch (err) {
      setBackupFeedback({ ok: false, message: err?.message || 'Import impossible.', details: { error: err?.message }, retry: 'import' });
    } finally {
      setBackupBusy(false);
    }
  }

  function handleRecordShortcut(id, keys) {
    const updated = { ...shortcuts, [id]: keys.join('+') };
    onChange({ keyboardShortcuts: updated });
  }

  function handleResetShortcuts() {
    onChange({ keyboardShortcuts: {} });
  }

  function handleToggleSidebarSection(sectionId, enabled) {
    const definition = availableSidebarSections.find((section) => section.id === sectionId);
    if (!definition || definition.required) return;
    const nextHidden = { ...hiddenSidebarSections };
    if (enabled) {
      delete nextHidden[sectionId];
    } else {
      nextHidden[sectionId] = true;
    }
    const nextSections = Array.isArray(sidebarSections) && sidebarSections.includes(sectionId)
      ? sidebarSections
      : [...visibleSidebarSections, sectionId];
    onChange({
      sidebarSections: nextSections,
      sidebarHiddenSections: nextHidden
    });
  }

  function handleExperimentalPatch(patch) {
    onChange({
      experimental: {
        ...experimental,
        ...patch
      }
    });
  }

  return (
    <div className={`settings-drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose}>
      <aside className={`settings-drawer ${open ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h3>Parametres</h3>
            <p>Personnalise l'apparence, le lecteur, les raccourcis et gere tes donnees.</p>
          </div>
          <button className="ghost-button" onClick={onClose}>Fermer</button>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Interface</h4>
            <span>Change toute la structure de navigation sans modifier les couleurs.</span>
          </div>
          <div className="theme-grid">
            {INTERFACES.map((entry) => {
              const Icon = entry.icon;
              const active = ui.interfaceMode === entry.id;
              return (
                <button
                  key={entry.id}
                  className={`theme-card ${active ? 'theme-card-active' : ''}`}
                  onClick={() => onRequestInterfaceMode?.(entry.id)}
                >
                  <div className="theme-card-topline">
                    <span className="theme-card-icon"><Icon size={16} /></span>
                    <strong>{entry.title}</strong>
                  </div>
                  <p>{entry.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Ambiance visuelle</h4>
            <span>Choisis le theme global de l'app.</span>
          </div>
          <div className="theme-grid">
            {THEMES.map((t) => {
              const Icon = t.icon;
              const active = ui.theme === t.id;
              return (
                <button key={t.id} className={`theme-card ${active ? 'theme-card-active' : ''}`} onClick={() => onChange({ theme: t.id })}>
                  <div className="theme-card-topline">
                    <span className="theme-card-icon"><Icon size={16} /></span>
                    <strong>{t.title}</strong>
                  </div>
                  <p>{t.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {ui.interfaceMode === 'sawa' ? (
          <div className="settings-section horizon-settings-section">
            <div className="settings-section-heading">
              <h4>Expérience Sawa</h4>
              <span>Horizon est la nouvelle présentation. Classique reste disponible pendant la version 5.0.</span>
            </div>
            <div className="segmented-control segmented-control-full">
              <button className={ui.sawaExperience !== 'classic' ? 'active' : ''} onClick={() => onChange({ sawaExperience: 'horizon' })}>Horizon</button>
              <button className={ui.sawaExperience === 'classic' ? 'active' : ''} onClick={() => onChange({ sawaExperience: 'classic' })}>Sawa classique</button>
            </div>
            <label className="settings-toggle"><span>Ambiance cinématique</span><input type="checkbox" checked={ui.cinematicBackdrop !== false} onChange={(event) => onChange({ cinematicBackdrop: event.target.checked })} /></label>
            <div className="settings-subsection"><h5>Intensité de l’ambiance ({ui.cinematicIntensity ?? 58}%)</h5><input className="settings-slider" type="range" min="0" max="100" value={ui.cinematicIntensity ?? 58} onChange={(event) => onChange({ cinematicIntensity: Number(event.target.value) })} /></div>
            <label className="settings-toggle"><span>Reflet prismatique des cartes</span><input type="checkbox" checked={ui.foilEnabled !== false} onChange={(event) => onChange({ foilEnabled: event.target.checked })} /></label>
            <div className="settings-subsection"><h5>Intensité du reflet ({ui.foilIntensity ?? 28}%)</h5><input className="settings-slider" type="range" min="0" max="100" value={ui.foilIntensity ?? 28} onChange={(event) => onChange({ foilIntensity: Number(event.target.value) })} /></div>
            <label className="settings-toggle"><span>Adapter les effets aux performances</span><input type="checkbox" checked={ui.adaptiveVisualEffects !== false} onChange={(event) => onChange({ adaptiveVisualEffects: event.target.checked })} /></label>
          </div>
        ) : null}

        <div className="settings-section settings-grid-two">
          <section className="settings-card-block">
            <div className="settings-section-heading">
              <h4>Bibliotheque</h4>
              <span>Controle le filtrage et la densite.</span>
            </div>
            <label className="settings-toggle">
              <span>Afficher les categories masquees</span>
              <input type="checkbox" checked={ui.showHiddenCategories} onChange={(e) => onChange({ showHiddenCategories: e.target.checked })} />
            </label>
            <label className="settings-toggle">
              <span>Apercu des pages avant lecture</span>
              <input type="checkbox" checked={ui.showPagePreviewBeforeReading} onChange={(e) => onChange({ showPagePreviewBeforeReading: e.target.checked })} />
            </label>
            <div className="settings-subsection">
              <h5>Taille des cartes</h5>
              <div className="segmented-control segmented-control-full">
                <button className={ui.cardSize === 'compact' ? 'active' : ''} onClick={() => onChange({ cardSize: 'compact' })}>Compact</button>
                <button className={ui.cardSize === 'comfortable' ? 'active' : ''} onClick={() => onChange({ cardSize: 'comfortable' })}>Confort</button>
                <button className={ui.cardSize === 'large' ? 'active' : ''} onClick={() => onChange({ cardSize: 'large' })}>Large</button>
              </div>
            </div>
            <div className="settings-subsection">
              <h5>Taille des chapitres</h5>
              <div className="segmented-control segmented-control-full">
                <button className={ui.chapterCardSize === 'compact' ? 'active' : ''} onClick={() => onChange({ chapterCardSize: 'compact' })}>Compact</button>
                <button className={ui.chapterCardSize === 'comfortable' ? 'active' : ''} onClick={() => onChange({ chapterCardSize: 'comfortable' })}>Confort</button>
                <button className={ui.chapterCardSize === 'large' ? 'active' : ''} onClick={() => onChange({ chapterCardSize: 'large' })}>Large</button>
              </div>
            </div>
            <div className="settings-subsection">
              <h5>Taille des aperçus de pages</h5>
              <div className="segmented-control segmented-control-full">
                <button className={ui.pagePreviewSize === 'compact' ? 'active' : ''} onClick={() => onChange({ pagePreviewSize: 'compact' })}>Compact</button>
                <button className={ui.pagePreviewSize === 'comfortable' ? 'active' : ''} onClick={() => onChange({ pagePreviewSize: 'comfortable' })}>Confort</button>
                <button className={ui.pagePreviewSize === 'large' ? 'active' : ''} onClick={() => onChange({ pagePreviewSize: 'large' })}>Large</button>
              </div>
            </div>
            <div className="settings-subsection">
              <h5>Qualité des aperçus</h5>
              <div className="segmented-control segmented-control-full">
                <button className={ui.previewQuality === 'economy' ? 'active' : ''} onClick={() => onChange({ previewQuality: 'economy' })}>Économe</button>
                <button className={ui.previewQuality === 'balanced' ? 'active' : ''} onClick={() => onChange({ previewQuality: 'balanced' })}>Auto</button>
                <button className={ui.previewQuality === 'high' ? 'active' : ''} onClick={() => onChange({ previewQuality: 'high' })}>Net</button>
              </div>
            </div>
          </section>

          <section className="settings-card-block">
            <div className="settings-section-heading">
              <h4>Accent et details</h4>
              <span>Choisis une couleur principale et secondaire.</span>
            </div>
            <ColorField label="Couleur d'accent" value={ui.accent || '#8b5cf6'} onChange={(accent) => onChange({ accent })} helper="Boutons actifs, selection, focus." />
            <ColorField label="Couleur de detail" value={ui.accentAlt || '#38bdf8'} onChange={(accentAlt) => onChange({ accentAlt })} helper="Degrades secondaires, glows." />
          </section>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4><ImageIcon size={16} /> Image de fond</h4>
            <span>Personnalise le fond du logiciel avec une image.</span>
          </div>

          {ui.backgroundImage ? (
            <div className="bg-image-preview-wrap">
              <div className="bg-image-preview">
                <img src={`manga://local/${encodeURIComponent(ui.backgroundImage)}`} alt="Fond" />
                <div className="bg-image-preview-overlay" style={{ opacity: 1 - (ui.backgroundOpacity ?? 0.15) }} />
              </div>
              <div className="bg-image-actions">
                <button className="ghost-button" onClick={onPickBackground}>
                  <ImageIcon size={14} /> Changer
                </button>
                <button className="ghost-button ghost-button-danger" onClick={onRemoveBackground}>
                  <TrashIcon size={14} /> Retirer
                </button>
              </div>
            </div>
          ) : (
            <button className="ghost-button bg-image-pick-btn" onClick={onPickBackground}>
              <ImageIcon size={16} /> Choisir une image
            </button>
          )}

          {ui.backgroundImage && (
            <>
              <div className="settings-subsection">
                <h5>Opacite de l'image ({Math.round((ui.backgroundOpacity ?? 0.15) * 100)}%)</h5>
                <input
                  type="range"
                  min="0" max="100" step="1"
                  value={Math.round((ui.backgroundOpacity ?? 0.15) * 100)}
                  onChange={(e) => onChange({ backgroundOpacity: parseInt(e.target.value, 10) / 100 })}
                  className="settings-slider"
                />
                <div className="settings-note">Baisse l'opacite pour voir le theme en fond.</div>
              </div>

              <div className="settings-subsection">
                <label className="settings-toggle">
                  <span>Utiliser les couleurs extraites de l'image</span>
                  <input
                    type="checkbox"
                    checked={!!ui.useBackgroundColors}
                    onChange={(e) => {
                      if (e.target.checked && ui.backgroundAccent) {
                        onChange({
                          useBackgroundColors: true,
                          accent: ui.backgroundAccent,
                          accentAlt: ui.backgroundAccentAlt || ui.backgroundAccent
                        });
                      } else {
                        onChange({ useBackgroundColors: false });
                      }
                    }}
                  />
                </label>
                {ui.backgroundAccent && (
                  <div className="bg-extracted-colors">
                    <span className="bg-color-swatch" style={{ background: ui.backgroundAccent }} title={ui.backgroundAccent} />
                    <span className="bg-color-swatch" style={{ background: ui.backgroundAccentAlt || ui.backgroundAccent }} title={ui.backgroundAccentAlt} />
                    <span className="muted-text" style={{ fontSize: '0.75rem' }}>Couleurs detectees</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Lecture</h4>
            <span>Parametres du lecteur de chapitres.</span>
          </div>
          <div className="settings-subsection">
            <h5>Seuil de marquage lu automatique</h5>
            <div className="segmented-control segmented-control-full">
              <button className={ui.readThreshold === 0.9 ? 'active' : ''} onClick={() => onChange({ readThreshold: 0.9 })}>90%</button>
              <button className={ui.readThreshold === 0.95 ? 'active' : ''} onClick={() => onChange({ readThreshold: 0.95 })}>95%</button>
              <button className={ui.readThreshold === 1.0 ? 'active' : ''} onClick={() => onChange({ readThreshold: 1.0 })}>100%</button>
            </div>
          </div>
          <label className="settings-toggle">
            <span>Lecture continue</span>
            <input type="checkbox" checked={!!ui.autoNextChapter} onChange={(e) => onChange({ autoNextChapter: e.target.checked })} />
          </label>
          <div className="settings-note">Passer automatiquement au chapitre suivant en fin de chapitre.</div>
          <label className="settings-toggle">
            <span>Precharger le chapitre suivant</span>
            <input type="checkbox" checked={!!ui.preloadNextChapter} onChange={(e) => onChange({ preloadNextChapter: e.target.checked })} />
          </label>
          <label className="settings-toggle">
            <span>Masquer l'UI apres inactivite</span>
            <input type="checkbox" checked={!!ui.autoHideReaderUI} onChange={(e) => onChange({ autoHideReaderUI: e.target.checked })} />
          </label>
          <div className="settings-subsection">
            <h5>Direction de lecture par defaut</h5>
            <div className="segmented-control segmented-control-full">
              <button className={ui.readDirection === 'ltr' ? 'active' : ''} onClick={() => onChange({ readDirection: 'ltr' })}>Gauche {'->'} Droite</button>
              <button className={ui.readDirection === 'rtl' ? 'active' : ''} onClick={() => onChange({ readDirection: 'rtl' })}>Droite {'->'} Gauche</button>
            </div>
          </div>
        </div>

        <div className="settings-section settings-grid-two">
          <section className="settings-card-block">
            <div className="settings-section-heading">
              <h4><ArchiveIcon size={16} /> Coffre & confidentialite</h4>
              <span>Pilote rapidement les options de confidentialite.</span>
            </div>
            <label className="settings-toggle">
              <span>Flouter les couvertures privees</span>
              <input
                type="checkbox"
                checked={!!vault?.blurCovers}
                disabled={!vaultConfigured || vaultLocked || !onUpdateVaultPrefs}
                onChange={(e) => onUpdateVaultPrefs?.({ blurCovers: e.target.checked })}
              />
            </label>
            <label className="settings-toggle">
              <span>Stealth mode (masquage strict)</span>
              <input
                type="checkbox"
                checked={!!vault?.stealthMode}
                disabled={!vaultConfigured || vaultLocked || !onUpdateVaultPrefs}
                onChange={(e) => onUpdateVaultPrefs?.({ stealthMode: e.target.checked })}
              />
            </label>
            <div className="settings-grid-two">
              <button className="ghost-button" disabled={!vaultConfigured || vaultLocked || !onLockVault} onClick={() => onLockVault?.()}>
                <LockIcon size={16} /> Reverrouiller le coffre
              </button>
              <button className="ghost-button ghost-button-danger" disabled={!vaultConfigured || vaultLocked || !onPanicLock} onClick={() => onPanicLock?.()}>
                <EyeOffIcon size={16} /> Verrou panique
              </button>
            </div>
            <div className="settings-note">
              {vaultConfigured
                ? (vaultLocked ? 'Le coffre est verrouille: deverrouille-le pour modifier ses options.' : 'Le coffre se verrouille automatiquement a la fermeture de l application.')
                : 'Configure d abord un code PIN dans la vue Coffre pour activer ces options.'}
            </div>
          </section>

          <section className="settings-card-block">
            <div className="settings-section-heading">
              <h4>Recherche & Queue</h4>
              <span>Rappels des nouvelles fonctions de navigation.</span>
            </div>
            <div className="settings-note">Queue de lecture: ouvre/ferme avec Ctrl+Shift+Q depuis la barre d onglets.</div>
            <div className="settings-note">Recherche avancee: utilise `tag:`, `status:`, `private:`, `author:` et `chapters&gt;`.</div>
            <div className="settings-note">Les filtres reconnus restent visibles en chips dans la barre de recherche.</div>
            <div className="settings-note">Palette locale: `Ctrl+K` pour aller a la maintenance, la queue, les collections ou relancer une action.</div>
          </section>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Barre laterale</h4>
            <span>Masque les vues ici, puis reordonne-les directement depuis le petit bouton d edition dans la barre laterale.</span>
          </div>
          <div className="settings-sidebar-list">
            {availableSidebarSections.map((section) => {
              const visible = visibleSidebarSections.includes(section.id);
              return (
                <div key={section.id} className="settings-sidebar-row">
                  <label className="settings-toggle settings-toggle-rich">
                    <div className="settings-toggle-copy">
                      <strong>{section.label}</strong>
                      <small>{section.description}</small>
                    </div>
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={section.required}
                      onChange={(event) => handleToggleSidebarSection(section.id, event.target.checked)}
                    />
                  </label>
                  <div className="settings-sidebar-state">{visible ? 'Visible' : 'Masque'}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4><KeyboardIcon size={16} /> Raccourcis clavier</h4>
            <span>Personnalise les raccourcis du lecteur et de la navigation globale.</span>
          </div>
          <div className="shortcuts-list">
            {Object.entries(DEFAULT_SHORTCUTS).map(([id, shortcut]) => (
              <ShortcutRow
                key={id}
                id={id}
                shortcut={shortcut}
                customKeys={shortcuts[id]}
                onRecord={handleRecordShortcut}
              />
            ))}
          </div>
          <button className="ghost-button" onClick={handleResetShortcuts} style={{ marginTop: 8 }}>
            Reinitialiser les raccourcis
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Metadonnees en ligne</h4>
            <span>Enrichis ta bibliotheque avec des donnees en ligne.</span>
          </div>
          <label className="settings-toggle">
            <span>Activer les metadonnees en ligne</span>
            <input type="checkbox" checked={!!ui.onlineMetadata} onChange={(e) => onChange({ onlineMetadata: e.target.checked })} />
          </label>
          <div className="settings-note">Le logiciel reste entierement fonctionnel hors ligne.</div>
          {ui.onlineMetadata && (
            <div className="settings-subsection">
              <label className="settings-toggle">
                <span>Couvertures en ligne</span>
                <input type="checkbox" checked={!!ui.onlineCoverAllowed} onChange={(e) => onChange({ onlineCoverAllowed: e.target.checked })} />
              </label>
              <label className="settings-toggle">
                <span>Descriptions en ligne</span>
                <input type="checkbox" checked={!!ui.onlineDescriptionAllowed} onChange={(e) => onChange({ onlineDescriptionAllowed: e.target.checked })} />
              </label>
              <label className="settings-toggle">
                <span>Activer les sources adultes</span>
                <input type="checkbox" checked={!!ui.allowNsfwSources} onChange={(e) => onChange({ allowNsfwSources: e.target.checked })} />
              </label>
              <div className="settings-note">Desactive = nHentai, IMHentai et HentaiEra ne sont jamais interroges.</div>
              {ui.allowNsfwSources ? (
                <div className="settings-subsection metadata-provider-settings">
                  <h5>Fournisseurs adultes</h5>
                  {[
                    ['nhentai', 'nHentai'],
                    ['imhentai', 'IMHentai'],
                    ['hentaiera', 'HentaiEra']
                  ].map(([providerId, label]) => (
                    <label key={providerId} className="settings-toggle">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={metadataProviderEnabled[providerId] !== false && (providerId === 'nhentai' || metadataProviderEnabled[providerId] === true)}
                        onChange={(event) => setMetadataProviderEnabled(providerId, event.target.checked)}
                      />
                    </label>
                  ))}
                  <label className="settings-field">
                    <span>Miroir prefere</span>
                    <select
                      value={metadataProviders.preferredAdultMirror || 'imhentai'}
                      onChange={(event) => updateMetadataProviders({ preferredAdultMirror: event.target.value })}
                    >
                      <option value="imhentai">IMHentai</option>
                      <option value="hentaiera">HentaiEra</option>
                    </select>
                  </label>
                  <label className="settings-toggle settings-toggle-rich">
                    <div className="settings-toggle-copy">
                      <strong>Autoriser le fallback HTML</strong>
                      <small>Fragile et limite a une requete toutes les 1,5 s. Sawa s arrete sur CAPTCHA ou protection.</small>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!metadataProviders.allowAdultHtmlFallback}
                      onChange={(event) => updateMetadataProviders({ allowAdultHtmlFallback: event.target.checked })}
                    />
                  </label>
                  <div className="settings-note">Aucun contournement, cookie navigateur ou hotlink de couverture n est utilise.</div>
                </div>
              ) : null}
              <label className="settings-toggle">
                <span>Confirmer avant import</span>
                <input type="checkbox" checked={!!ui.onlineConfirmBeforeImport} onChange={(e) => onChange({ onlineConfirmBeforeImport: e.target.checked })} />
              </label>
            </div>
          )}
          <div className="settings-subsection">
            <h5>ComicInfo.xml local</h5>
            <label className="settings-toggle">
              <span>Support actif (CBZ + sidecar)</span>
              <input type="checkbox" checked readOnly />
            </label>
            <div className="settings-note">
              Lecture de ComicInfo.xml incluse: detection locale pendant le scan et import manuel depuis
              le menu contextuel (clic droit manga {'>'} Importer ComicInfo) ou l editeur de metadonnees.
            </div>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Fonctions avancees</h4>
            <span>Les fonctions v4 stables sont integrees directement, sans ajouter de friction au quotidien.</span>
          </div>
          <div className="settings-grid-two">
            <section className="settings-card-block">
              <div className="settings-note">
                Recherche avancee locale: active. Elle utilise l'index derive tout en gardant la barre de recherche actuelle.
              </div>
              <div className="settings-note">Formats archives etendus: actifs via le pipeline standard de scan/analyse.</div>
            </section>

            <section className="settings-card-block">
              <div className="settings-note">OCR local: disponible dans Entretien, lance uniquement a la demande.</div>
              <div className="settings-note">Lecteur visuel v4, guide manuel et dedup visuelle restent retires pour garder l'app fluide et stable.</div>
            </section>
          </div>

          <div className="settings-subsection">
            <h5>Profil de respiration des jobs</h5>
            <div className="segmented-control segmented-control-full">
              <button className={experimental.schedulerProfile === 'interactive' ? 'active' : ''} onClick={() => handleExperimentalPatch({ schedulerProfile: 'interactive' })}>Interactif</button>
              <button className={experimental.schedulerProfile === 'balanced' ? 'active' : ''} onClick={() => handleExperimentalPatch({ schedulerProfile: 'balanced' })}>Equilibre</button>
              <button className={experimental.schedulerProfile === 'idle-only' ? 'active' : ''} onClick={() => handleExperimentalPatch({ schedulerProfile: 'idle-only' })}>Repos seul</button>
            </div>
            <div className="settings-note">
              {syncStatus?.label
                ? `Etat actuel: ${syncStatus.label}${syncStatus.detail ? ` · ${syncStatus.detail}` : ''}`
                : 'Le scheduler garde un statut compact: a jour, mise a jour ou attention.'}
            </div>
          </div>
          <label className="settings-toggle">
            <span>Diagnostic de reactivite</span>
            <input
              type="checkbox"
              checked={Boolean(experimental.performanceDiagnostics)}
              onChange={(event) => handleExperimentalPatch({ performanceDiagnostics: event.target.checked })}
            />
          </label>
          <div className="settings-note">Conserve localement les 200 dernieres mesures de latence, sans chemins de fichiers.</div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Plugins et addons</h4>
            <span>Installe, active et gere les addons sans quitter Sawa.</span>
          </div>
          <div className="plugin-preview-list">
            {plugins.length === 0 ? (
              <div className="settings-note">Aucun plugin detecte pour le moment.</div>
            ) : plugins.map((plugin) => {
              const installed = Boolean(plugin.installed);
              const busy = pluginBusyId === plugin.id;
              const canInstall = Boolean(plugin.installable) && !installed;
              const canOpen = installed && (plugin.id === 'sources-web' || (Boolean(plugin.launchable) && !plugin.integrated));
              const canUninstall = installed && Boolean(plugin.uninstallable);
              const kindLabel = plugin.kind === 'source-addon' ? 'addon source' : 'addon';
              return (
                <div key={plugin.id} className="plugin-preview-row">
                  <div>
                    <strong>{plugin.name}</strong>
                    <div className="settings-note">{plugin.description || 'Addon local.'}</div>
                    <div className="settings-note">
                      Statut: {installed ? 'installe' : (plugin.status || 'disponible')} · Type: {kindLabel} · Origine: {plugin.origin || 'local'}
                    </div>
                    {plugin.runtimeKind ? (
                      <div className="settings-note">
                        Runtime: {plugin.runtimeKind}
                        {plugin.runtimeVersion ? ` · ${plugin.runtimeVersion}` : ''}
                        {plugin.runtimeBundled ? ' · integre' : ''}
                      </div>
                    ) : null}
                  </div>
                  <div className="plugin-preview-controls">
                    <div className="plugin-preview-actions">
                      {canInstall ? (
                        <button
                          className="ghost-button"
                          disabled={busy || !onInstallPlugin}
                          onClick={() => onInstallPlugin?.(plugin.id)}
                        >
                          {busy ? 'Installation...' : 'Installer'}
                        </button>
                      ) : null}
                      {canOpen ? (
                        <button
                          className="ghost-button"
                          disabled={busy || !onOpenPlugin}
                          onClick={() => onOpenPlugin?.(plugin.id)}
                        >
                          {busy ? 'Ouverture...' : (plugin.id === 'sources-web' ? 'Ouvrir' : 'Lancer')}
                        </button>
                      ) : null}
                      {canUninstall ? (
                        <button
                          className="ghost-button ghost-button-danger"
                          disabled={busy || !onUninstallPlugin}
                          onClick={() => onUninstallPlugin?.(plugin.id)}
                        >
                          {busy ? 'Retrait...' : 'Retirer'}
                        </button>
                      ) : null}
                    </div>
                    <label className="plugin-preview-enable">
                      <span>{plugin.integrated ? 'Activer' : 'Actif'}</span>
                      <input
                        type="checkbox"
                        checked={!!plugin.enabled}
                        disabled={!installed || busy || !onSetPluginEnabled}
                        onChange={(event) => onSetPluginEnabled?.(plugin.id, event.target.checked)}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          {pluginFeedback ? <div className="settings-note plugin-preview-feedback">{pluginFeedback}</div> : null}
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4><HardDriveIcon size={16} /> Donnees & Sauvegarde</h4>
            <span>Exporte ou importe tes donnees au format .sawa-backup pour les transferer entre appareils.</span>
          </div>

          <div className="settings-grid-two">
            <button className="ghost-button" disabled={backupBusy} onClick={handleExportSawa}>
              <DownloadIcon size={16} /> Exporter (.sawa-backup)
            </button>
            <button className="ghost-button" disabled={backupBusy} onClick={handleImportSawa}>
              <UploadIcon size={16} /> Importer
            </button>
          </div>
          {backupFeedback ? (
            <div className="settings-note" role="status">
              <strong>{backupFeedback.ok ? 'Succes' : 'Attention'}:</strong> {backupFeedback.message}
              {!backupFeedback.ok && backupFeedback.retry ? (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={backupFeedback.retry === 'export' ? handleExportSawa : handleImportSawa}
                >
                  Reessayer
                </button>
              ) : null}
              <button
                className="ghost-button"
                type="button"
                onClick={() => navigator.clipboard?.writeText(JSON.stringify(backupFeedback.details || {}, null, 2))}
              >
                Copier les details
              </button>
            </div>
          ) : null}
          <div className="settings-note">
            Le paquet contient ta progression, tes favoris, tes tags, tes collections, tes parametres et les couvertures gerees.
            Les fichiers manga eux-memes ne sont pas inclus. Les anciens fichiers JSON restent importables.
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <h4>Maintenance</h4>
            <span>Outils de gestion et de diagnostic.</span>
          </div>
          <div className="settings-grid-two">
            <button className="ghost-button" onClick={onForceRescan}>
              <RefreshIcon size={16} /> Rescan complet
            </button>
            <button className="ghost-button" onClick={onRunDeepScan}>
              <RefreshIcon size={16} /> Scan profond
            </button>
            <button className="ghost-button" onClick={onRebuildDerivedData}>
              <HardDriveIcon size={16} /> Reconstruire les donnees derivees
            </button>
            <button className="ghost-button" onClick={onClearCache}>
              <HardDriveIcon size={16} /> Vider le cache
            </button>
          </div>
          {syncStatus?.detail ? <div className="settings-note">{syncStatus.detail}</div> : null}
          {(syncStatus?.state === 'retry-required' || syncStatus?.retryable) ? (
            <button className="primary-button" onClick={onRetrySync}>
              <RefreshIcon size={16} /> Relancer la synchronisation
            </button>
          ) : null}
        </div>

        <div className="settings-section">
          <div className="settings-section-heading"><h4>A propos</h4></div>
          <div className="settings-note">
            <strong>Sawa Manga Library v5.0.1</strong><br />
            Bibliotheque manga locale, premium, intelligente et entierement hors ligne.
          </div>
        </div>

      </aside>
    </div>
  );
}
