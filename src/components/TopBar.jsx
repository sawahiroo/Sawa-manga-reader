import { memo } from 'react';
import {
  CheckIcon,
  FolderPlusIcon,
  KeyboardIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  SettingsIcon,
  SparklesIcon
} from './Icons.jsx';
import SearchExperience from './SearchExperience.jsx';

function TopBar({
  sidebarCollapsed,
  onToggleSidebar,
  search,
  onSearchChange,
  searchState,
  onSearchStateChange,
  searchSuggestions = [],
  searchResultCount = 0,
  searchFilterOptions = {},
  onCommitSearch,
  onClearSearchRecents,
  onRemoveAdvancedSearchToken,
  sort,
  onSortChange,
  selectedCategory,
  onClearCategory,
  onOpenSettings,
  onAddCategories,
  activeScreen,
  selectionMode = false,
  selectedCount = 0,
  onToggleSelectionMode,
  searchChips = [],
  searchStatus = null,
  searchHelpOpen = false,
  onToggleSearchHelp,
  onSaveSearch,
  onOpenCommandPalette,
  commandPaletteLabel = 'Ctrl+K'
}) {
  const title = activeScreen === 'favorites'
    ? 'Favoris'
    : activeScreen === 'recents'
      ? 'Recents'
      : activeScreen === 'vault'
        ? 'Coffre'
        : 'Bibliotheque';
  const subtitle = selectedCategory
    ? (
      <>
        Filtre sur <button className="inline-link" onClick={onClearCategory}>{selectedCategory.name}</button>
      </>
    )
    : activeScreen === 'vault'
      ? 'Vue protegee du coffre prive'
      : 'Vue globale de toute la bibliotheque';

  return (
    <div className="topbar-shell">
      <div className="topbar-left">
        <button className="icon-pill topbar-sidebar-toggle" onClick={onToggleSidebar} title={sidebarCollapsed ? 'Deplier la barre laterale' : 'Replier la barre laterale'}>
          {sidebarCollapsed ? <PanelExpandIcon size={16} /> : <PanelCollapseIcon size={16} />}
        </button>
        <div className="topbar-copy">
          <div className="page-title">{title}</div>
          <div className="page-subtitle">{subtitle}</div>
        </div>
      </div>

      <div className="topbar-right">
        <SearchExperience
          state={searchState || { query: search, scope: 'current', filters: [] }}
          onStateChange={onSearchStateChange || ((next) => onSearchChange(next.query))}
          suggestions={searchSuggestions}
          resultCount={searchResultCount}
          advancedChips={searchChips.filter((chip) => chip.kind === 'filter')}
          status={searchStatus}
          filterOptions={searchFilterOptions}
          onCommitSearch={onCommitSearch}
          onSaveSearch={onSaveSearch}
          onClearRecents={onClearSearchRecents}
          onRemoveAdvancedToken={onRemoveAdvancedSearchToken}
          privateContext={activeScreen === 'vault'}
        />

        <button type="button" className={`search-help-button ${searchHelpOpen ? 'active' : ''}`} onClick={onToggleSearchHelp} title="Aide recherche avancee">
          ?
        </button>
        {searchHelpOpen ? (
          <div className="search-help-popover">
            <strong>Recherche avancee</strong>
            <span>`tag:romance` `status:unread` `favorite:true` `private:false`</span>
            <span>`author:"Inoue Takehiko"` `collection:seinen`</span>
            <span>`missing:cover` `missing:metadata` `chapters&gt;10` `added&lt;30`</span>
          </div>
        ) : null}

        <select className="sort-select" value={sort} onChange={(event) => onSortChange(event.target.value)}>
          <option value="title-asc">Titre A-Z</option>
          <option value="title-desc">Titre Z-A</option>
          <option value="recent">Derniere lecture</option>
          <option value="favorites">Favoris d'abord</option>
          <option value="chapters-desc">Plus de chapitres</option>
          <option value="added-recent">Ajout recent</option>
          <option value="added-oldest">Ajout ancien</option>
        </select>

        {onOpenCommandPalette ? (
          <button className="ghost-button topbar-command-button" onClick={onOpenCommandPalette} title="Palette de commandes locale">
            <KeyboardIcon size={15} />
            <span>{commandPaletteLabel}</span>
          </button>
        ) : null}

        {onToggleSelectionMode ? (
          <button className={`ghost-button topbar-select-button ${selectionMode ? 'active' : ''}`} onClick={onToggleSelectionMode} title="Selection multiple">
            {selectionMode ? <CheckIcon size={15} /> : <SparklesIcon size={15} />}
            <span>{selectionMode ? `${selectedCount} selection${selectedCount > 1 ? 's' : ''}` : 'Selection'}</span>
          </button>
        ) : null}

        <button className="icon-pill" onClick={(event) => onAddCategories?.(event)} title="Ajouter des categories">
          <FolderPlusIcon size={16} />
        </button>
        <button className="icon-pill" onClick={onOpenSettings} title="Parametres">
          <SettingsIcon size={16} />
        </button>
      </div>
    </div>
  );
}

export default memo(TopBar);
