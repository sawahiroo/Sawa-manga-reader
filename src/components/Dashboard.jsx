import { memo, useMemo, useState } from 'react';
import MangaCard from './MangaCard.jsx';
import {
  AlertIcon,
  BookIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  HeartIcon,
  LayersIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  ZapIcon,
  TrendingUpIcon,
  SearchIcon
} from './Icons.jsx';
import { buildDashboardSelectionModel } from '../utils/selectionVisibility.js';

function DashSection({ title, icon, mangas, onOpen, onToggleFavorite, onContextMenu, emptyText, selectionMode, selectedIds, onToggleSelect, selectionOrder }) {
  if (!mangas || mangas.length === 0) {
    return emptyText ? (
      <div className="empty-card dash-empty-card">
        <h3>{title}</h3>
        <p>{emptyText}</p>
      </div>
    ) : null;
  }

  return (
    <div className="dash-section">
      <div className="dash-section-header">
        <h3>{icon} {title}</h3>
      </div>
      <div className="dash-section-grid">
        {mangas.map((manga) => (
          <MangaCard
            key={manga.id}
            manga={manga}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
            onContextMenu={onContextMenu}
            compact
            selectionMode={selectionMode}
            selected={selectedIds.has(String(manga.id ?? '').trim())}
            onToggleSelect={onToggleSelect}
            selectionOrder={selectionOrder}
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="dash-stat">
      <span className="dash-stat-icon">{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

function QuickAction({ label, icon, onClick }) {
  return (
    <button className="dash-quick-action" onClick={onClick}>
      <span className="dash-quick-action-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function DashboardBlock({ blockId, label, customizeMode, onHide, onDragStart, onDrop, children }) {
  return (
    <section
      className={`dash-block dash-block-${blockId} ${customizeMode ? 'dash-block-editing' : ''}`}
      draggable={customizeMode}
      onDragStart={() => onDragStart?.(blockId)}
      onDragOver={(event) => {
        if (!customizeMode) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (!customizeMode) return;
        event.preventDefault();
        onDrop?.(blockId);
      }}
    >
      {customizeMode ? (
        <div className="dash-block-toolbar">
          <span className="dash-block-toolbar-label">:: {label}</span>
          <button className="ghost-button dash-block-toolbar-button" onClick={() => onHide?.(blockId)}>
            <EyeOffIcon size={14} /> Masquer
          </button>
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Dashboard({
  allMangas = [],
  favorites = [],
  persisted = {},
  ui = {},
  onOpenManga,
  onResumeManga,
  onToggleFavorite,
  onNavigateTo,
  onContextMenu,
  onOpenSettings,
  onUpdateSettings,
  onOpenMaintenance,
  maintenanceCount = 0,
  selectionMode = false,
  selectedMangaIds = new Set(),
  selectionOrder = [],
  onToggleSelect,
  onSelectionModeChange
}) {
  const [customizeMode, setCustomizeMode] = useState(false);
  const [draggedBlockId, setDraggedBlockId] = useState(null);
  const collectionsCount = Object.keys(persisted?.collections ?? {}).length;

  const dashboardModel = useMemo(
    () => buildDashboardSelectionModel({ allMangas, favorites, persisted, ui }),
    [allMangas, favorites, persisted, ui]
  );
  const continueReading = dashboardModel.sectionMangas['continue-reading'];
  const recentlyAdded = dashboardModel.sectionMangas['recently-added'];
  const newChapters = dashboardModel.sectionMangas['new-chapters'];
  const completed = dashboardModel.sectionMangas.completed;
  const unread = useMemo(() => allMangas.filter((manga) => !manga?.lastReadAt && !manga?.isRead), [allMangas]);
  const inProgress = useMemo(() => allMangas.filter((manga) => Number(manga?.progressPercent ?? 0) > 0 && !manga?.isRead), [allMangas]);

  const recentResumes = dashboardModel.sectionMangas['recently-resumed'];
  const orderedBlocks = dashboardModel.orderedBlocks;
  const visibleBlockIds = dashboardModel.visibleBlocks;
  const hiddenBlockIds = dashboardModel.hiddenBlocks;

  const totalMangas = allMangas.length;
  const totalFavorites = favorites.length;
  const totalUnread = unread.length;
  const totalInProgress = inProgress.length;
  const totalCompleted = completed.length;
  const totalChapters = allMangas.reduce((sum, manga) => sum + (manga.chapterCount || 0), 0);
  const totalReadChapters = allMangas.reduce((sum, manga) => sum + (manga.completedChapterCount || 0), 0);
  const overallProgress = totalChapters > 0 ? Math.round((totalReadChapters / totalChapters) * 100) : 0;
  const primaryResume = recentResumes[0] ?? continueReading[0] ?? null;

  const persistOrder = async (nextOrder) => onUpdateSettings?.({ dashboardLayout: nextOrder });

  const handleDrop = async (targetId) => {
    if (!draggedBlockId || draggedBlockId === targetId) {
      setDraggedBlockId(null);
      return;
    }
    const nextOrder = orderedBlocks.filter((id) => id !== draggedBlockId);
    const targetIndex = nextOrder.indexOf(targetId);
    nextOrder.splice(targetIndex, 0, draggedBlockId);
    setDraggedBlockId(null);
    await persistOrder(nextOrder);
  };

  const toggleBlockHidden = async (blockId, hidden) => {
    await onUpdateSettings?.({
      dashboardHiddenSections: {
        ...(ui?.dashboardHiddenSections ?? {}),
        [blockId]: hidden
      }
    });
  };

  const renderSection = (blockId) => {
    switch (blockId) {
      case 'hero':
        return (
          <div className="dash-hero">
            <div className="dash-hero-content">
              <div className="dash-hero-badge">Sawa Manga Reader</div>
              <h1>Ta bibliotheque est prete, et maintenant elle sait aussi s'entretenir.</h1>
              <p>Lecture, organisation, lots metadata, coffre prive et vues intelligentes: tout est la, sans casser le confort du quotidien.</p>
              <div className="dash-hero-actions">
                {primaryResume ? <button className="primary-button" onClick={() => onResumeManga?.(primaryResume.id)}><PlayIcon size={16} /> Continuer</button> : null}
                <button className="ghost-button" onClick={onOpenMaintenance}><AlertIcon size={16} /> Entretien</button>
              </div>
            </div>
          </div>
        );
      case 'stats':
        return (
          <div className="dash-stats-grid">
            <StatCard label="Mangas" value={totalMangas} icon={<BookIcon size={18} />} />
            <StatCard label="En cours" value={totalInProgress} icon={<ClockIcon size={18} />} />
            <StatCard label="Non lus" value={totalUnread} icon={<ZapIcon size={18} />} />
            <StatCard label="Termines" value={totalCompleted} icon={<BookIcon size={18} />} />
            <StatCard label="Favoris" value={totalFavorites} icon={<HeartIcon size={18} filled />} />
            <StatCard label="Collections" value={collectionsCount} icon={<LayersIcon size={18} />} />
            <StatCard label="Chapitres lus" value={`${totalReadChapters}/${totalChapters}`} icon={<TrendingUpIcon size={18} />} />
            <StatCard label="Points entretien" value={maintenanceCount} icon={<AlertIcon size={18} />} />
          </div>
        );
      case 'quick-actions':
        return (
          <div className="dash-section">
            <div className="dash-section-header">
              <h3>Acces rapide</h3>
            </div>
            <div className="dash-quick-actions">
              <QuickAction label="Bibliotheque" icon={<LayersIcon size={18} />} onClick={() => onNavigateTo('library')} />
              <QuickAction label="Collections" icon={<BookIcon size={18} />} onClick={() => onNavigateTo('collections')} />
              <QuickAction label="Entretien" icon={<AlertIcon size={18} />} onClick={onOpenMaintenance} />
              <QuickAction label={selectionMode ? `${selectedMangaIds.size} selection(s)` : 'Selection'} icon={<SearchIcon size={18} />} onClick={onSelectionModeChange} />
              <QuickAction label="Favoris" icon={<HeartIcon size={18} filled />} onClick={() => onNavigateTo('favorites')} />
              {onOpenSettings ? <QuickAction label="Parametres" icon={<SparklesIcon size={18} />} onClick={onOpenSettings} /> : null}
            </div>
          </div>
        );
      case 'continue-reading':
        return <DashSection title="Continuer la lecture" icon={<PlayIcon size={18} />} mangas={continueReading} onOpen={onResumeManga} onToggleFavorite={onToggleFavorite} onContextMenu={onContextMenu} emptyText="Aucune reprise en cours pour le moment." selectionMode={selectionMode} selectedIds={selectedMangaIds} onToggleSelect={onToggleSelect} selectionOrder={selectionOrder} />;
      case 'recently-resumed':
        return <DashSection title="Repris recemment" icon={<ClockIcon size={18} />} mangas={recentResumes} onOpen={onResumeManga} onToggleFavorite={onToggleFavorite} onContextMenu={onContextMenu} emptyText="Tes reprises recentes apparaitront ici." selectionMode={selectionMode} selectedIds={selectedMangaIds} onToggleSelect={onToggleSelect} selectionOrder={selectionOrder} />;
      case 'recently-added':
        return <DashSection title="Ajoutes recemment" icon={<PlusIcon size={18} />} mangas={recentlyAdded} onOpen={onOpenManga} onToggleFavorite={onToggleFavorite} onContextMenu={onContextMenu} emptyText="Aucun ajout recent pour le moment." selectionMode={selectionMode} selectedIds={selectedMangaIds} onToggleSelect={onToggleSelect} selectionOrder={selectionOrder} />;
      case 'new-chapters':
        return newChapters.length > 0 ? <DashSection title="Nouveaux chapitres" icon={<SparklesIcon size={18} />} mangas={newChapters} onOpen={onOpenManga} onToggleFavorite={onToggleFavorite} onContextMenu={onContextMenu} selectionMode={selectionMode} selectedIds={selectedMangaIds} onToggleSelect={onToggleSelect} selectionOrder={selectionOrder} /> : null;
      case 'favorites':
        return <DashSection title="Favoris" icon={<HeartIcon size={18} filled />} mangas={favorites} onOpen={onOpenManga} onToggleFavorite={onToggleFavorite} onContextMenu={onContextMenu} emptyText="Ajoute des mangas en favoris pour les retrouver ici." selectionMode={selectionMode} selectedIds={selectedMangaIds} onToggleSelect={onToggleSelect} selectionOrder={selectionOrder} />;
      case 'completed':
        return completed.length > 0 ? <DashSection title="Termines" icon={<BookIcon size={18} />} mangas={completed} onOpen={onOpenManga} onToggleFavorite={onToggleFavorite} onContextMenu={onContextMenu} selectionMode={selectionMode} selectedIds={selectedMangaIds} onToggleSelect={onToggleSelect} selectionOrder={selectionOrder} /> : null;
      default:
        return null;
    }
  };

  return (
    <section className="dashboard-view">
      <div className="dash-customize-bar">
        <div className="dash-customize-copy">
          <strong>Dashboard personnalisable</strong>
          <span>Reorganise les blocs, masque ceux dont tu n'as pas besoin et garde toujours un acces propre a tes priorites.</span>
        </div>
        <div className="dash-customize-actions">
          {customizeMode && hiddenBlockIds.length > 0 ? (
            <div className="dash-hidden-pills">
              {hiddenBlockIds.map((blockId) => (
                <button key={blockId} className="ghost-button dash-hidden-pill" onClick={() => toggleBlockHidden(blockId, false)}>
                  <EyeIcon size={14} /> {blockId.replace(/-/g, ' ')}
                </button>
              ))}
            </div>
          ) : null}
          <button className={`ghost-button ${customizeMode ? 'active' : ''}`} onClick={() => setCustomizeMode((value) => !value)}>
            {customizeMode ? 'Terminer' : 'Personnaliser'}
          </button>
        </div>
      </div>

      {visibleBlockIds.length === 0 ? (
        <div className="empty-card">
          <h3>Toutes les sections sont masquees</h3>
          <p>Restaure au moins un bloc depuis le mode personnalisation.</p>
        </div>
      ) : visibleBlockIds.map((blockId) => {
        const content = renderSection(blockId);
        if (!content) return null;
        return (
          <DashboardBlock
            key={blockId}
            blockId={blockId}
            label={blockId.replace(/-/g, ' ')}
            customizeMode={customizeMode}
            onHide={() => toggleBlockHidden(blockId, true)}
            onDragStart={setDraggedBlockId}
            onDrop={handleDrop}
          >
            {content}
          </DashboardBlock>
        );
      })}
    </section>
  );
}

export default memo(Dashboard);
