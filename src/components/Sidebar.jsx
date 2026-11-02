import { memo, useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Menu, MenuItem, Sidebar as ProSidebar, menuClasses, sidebarClasses } from 'react-pro-sidebar';
import {
  AlertIcon,
  ArchiveIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  FolderPlusIcon,
  HeartIcon,
  HomeIcon,
  LayersIcon,
  LibraryIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  SettingsIcon,
  SortIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon
} from './Icons.jsx';

const SIDEBAR_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: ({ active }) => <HomeIcon size={18} active={active} /> },
  { id: 'library', label: 'Bibliotheque', icon: ({ active }) => <LibraryIcon size={18} active={active} />, required: true },
  { id: 'collections', label: 'Collections', icon: ({ active }) => <LayersIcon size={18} active={active} /> },
  { id: 'maintenance', label: 'Entretien', icon: ({ active }) => <AlertIcon size={18} active={active} /> },
  { id: 'workbench', label: 'Atelier', icon: ({ active }) => <SparklesIcon size={18} active={active} /> },
  { id: 'sources', label: 'Sources web', icon: ({ active }) => <DownloadIcon size={18} active={active} />, addon: 'sources' },
  { id: 'vault', label: 'Coffre', icon: ({ active }) => <ArchiveIcon size={18} active={active} /> },
  { id: 'favorites', label: 'Favoris', icon: ({ active }) => <HeartIcon size={18} filled={active} /> },
  { id: 'recents', label: 'Recents', icon: ({ active }) => <ClockIcon size={18} active={active} /> }
];

const sidebarRootStyles = {
  border: 'none',
  minWidth: 'unset',
  height: '100%',
  [`.${sidebarClasses.container}`]: {
    background: 'transparent',
    borderRight: 'none',
    minWidth: 'unset',
    width: '100%',
    height: '100%'
  }
};

const sidebarMenuItemStyles = {
  root: {
    marginBottom: '8px'
  },
  button: ({ active }) => ({
    '--sawa-sidebar-hover-bg': active
      ? 'color-mix(in srgb, var(--accent) 16%, var(--bg-soft))'
      : 'color-mix(in srgb, var(--accent) 11%, var(--bg-soft))',
    minHeight: 48,
    borderRadius: 16,
    paddingInline: 14,
    color: active ? 'var(--text)' : 'var(--text-soft)',
    background: active
      ? 'color-mix(in srgb, var(--accent) 14%, var(--bg-soft))'
      : 'var(--bg-soft)',
    border: active
      ? '1px solid color-mix(in srgb, var(--accent) 32%, transparent)'
      : '1px solid transparent',
    transition: 'background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease',
    '&:hover': {
      color: 'var(--text)',
      background: 'var(--sawa-sidebar-hover-bg)',
      borderColor: active
        ? 'color-mix(in srgb, var(--accent) 32%, transparent)'
        : 'color-mix(in srgb, var(--accent) 24%, transparent)',
      transform: 'none'
    },
    '&:focus-visible': {
      outline: 'none',
      boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent) 34%, transparent)'
    }
  }),
  icon: {
    color: 'inherit'
  },
  label: {
    fontSize: '0.96rem',
    fontWeight: 700
  },
  suffix: {
    marginLeft: 'auto'
  }
};

function pinIconFor(pin) {
  switch (pin?.type) {
    case 'smart-collection':
      return <SparklesIcon size={16} />;
    case 'collection':
      return <LayersIcon size={16} />;
    case 'tag':
      return <TagIcon size={16} />;
    case 'screen':
      if (pin.refId === 'maintenance') return <AlertIcon size={16} />;
      if (pin.refId === 'workbench') return <SparklesIcon size={16} />;
      if (pin.refId === 'vault') return <ArchiveIcon size={16} />;
      return <LibraryIcon size={16} />;
    default:
      return <LayersIcon size={16} />;
  }
}

function HiddenEditorItem({ item, badge = 0, onToggleVisible }) {
  return (
    <div className="sawa-sidebar-editor-item sawa-sidebar-editor-item-hidden">
      <button
        type="button"
        className="sawa-sidebar-editor-main"
        onClick={() => onToggleVisible?.(item.id, true)}
      >
        <span className="sawa-sidebar-editor-icon">{item.icon({ active: false })}</span>
        <span className="sawa-sidebar-editor-copy">
          <strong>{item.label}</strong>
          <small>Masque de la navigation principale</small>
        </span>
        {badge > 0 ? <span className="sidebar-badge">{badge}</span> : null}
      </button>
      <button
        type="button"
        className="icon-button"
        title="Reafficher"
        onClick={() => onToggleVisible?.(item.id, true)}
      >
        <EyeIcon size={15} />
      </button>
    </div>
  );
}

function SortableEditorItem({ item, active, badge = 0, onToggleVisible }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sawa-sidebar-editor-item ${active ? 'sawa-sidebar-editor-item-active' : ''} ${isDragging ? 'sawa-sidebar-editor-item-dragging' : ''}`}
    >
      <div className="sawa-sidebar-editor-main">
        <span className="sawa-sidebar-editor-icon">{item.icon({ active })}</span>
        <span className="sawa-sidebar-editor-copy">
          <strong>{item.label}</strong>
          <small>{item.required ? 'Toujours visible dans la navigation' : 'Visible dans la navigation principale'}</small>
        </span>
        {badge > 0 ? <span className="sidebar-badge">{badge}</span> : null}
      </div>

      <div className="sawa-sidebar-editor-tools">
        {!item.required ? (
          <button
            type="button"
            className="icon-button"
            title="Masquer"
            onClick={() => onToggleVisible?.(item.id, false)}
          >
            <EyeOffIcon size={15} />
          </button>
        ) : (
          <span className="sawa-sidebar-editor-required">Fixe</span>
        )}
        <button
          type="button"
          className="sawa-sidebar-editor-handle"
          title="Glisse pour reordonner"
          {...attributes}
          {...listeners}
        >
          <SortIcon size={15} />
        </button>
      </div>
    </div>
  );
}

function Sidebar({
  collapsed,
  onToggleCollapsed,
  activeScreen,
  onScreenChange,
  categories,
  allCategories,
  selectedCategoryId,
  onSelectCategory,
  onAddCategories,
  onToggleCategoryHidden,
  onRemoveCategory,
  onRelinkCategory,
  onOpenSettings,
  onContextMenu,
  favoritesCount = 0,
  maintenanceCount = 0,
  workbenchCount = 0,
  vaultCount = 0,
  showSources = false,
  sidebarSections = [],
  sidebarHiddenSections = {},
  sidebarPins = [],
  onActivatePin,
  onSetSectionVisible,
  onReorderSections
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [pinsOpen, setPinsOpen] = useState(true);
  const [customizeMode, setCustomizeMode] = useState(false);

  useEffect(() => {
    if (collapsed && customizeMode) {
      setCustomizeMode(false);
    }
  }, [collapsed, customizeMode]);

  const visibleCats = useMemo(
    () => (allCategories || categories || []).filter((category) => !category.hidden),
    [allCategories, categories]
  );
  const hiddenCats = useMemo(() => (allCategories || []).filter((category) => category.hidden), [allCategories]);
  const orderedItems = useMemo(() => {
    const availableItems = SIDEBAR_SECTIONS.filter((item) => item.id !== 'sources' || showSources);
    const configuredOrder = Array.isArray(sidebarSections) ? sidebarSections : [];
    const orderedIds = [
      ...configuredOrder.filter((sectionId) => availableItems.some((item) => item.id === sectionId)),
      ...availableItems.map((item) => item.id).filter((sectionId) => !configuredOrder.includes(sectionId))
    ];
    return orderedIds
      .map((sectionId) => availableItems.find((item) => item.id === sectionId))
      .filter(Boolean);
  }, [showSources, sidebarSections]);
  const navigationItems = useMemo(
    () => orderedItems.filter((item) => item.required || !sidebarHiddenSections?.[item.id]),
    [orderedItems, sidebarHiddenSections]
  );
  const hiddenNavigationItems = useMemo(
    () => orderedItems.filter((item) => !item.required && sidebarHiddenSections?.[item.id]),
    [orderedItems, sidebarHiddenSections]
  );

  const badgeMap = useMemo(
    () => ({
      maintenance: maintenanceCount,
      workbench: workbenchCount,
      vault: vaultCount,
      favorites: favoritesCount
    }),
    [favoritesCount, maintenanceCount, workbenchCount, vaultCount]
  );

  function badgeForSection(sectionId) {
    return badgeMap[sectionId] || 0;
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const visibleOrder = navigationItems.map((item) => item.id);
    const oldIndex = visibleOrder.findIndex((sectionId) => sectionId === active.id);
    const newIndex = visibleOrder.findIndex((sectionId) => sectionId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorderSections?.(arrayMove(visibleOrder, oldIndex, newIndex));
  }

  return (
    <>
      <button
        type="button"
        className={`sawa-sidebar-mobile-backdrop ${collapsed ? 'sawa-sidebar-mobile-backdrop-hidden' : ''}`}
        aria-label="Fermer la barre laterale"
        onClick={onToggleCollapsed}
      />

      <ProSidebar
        collapsed={collapsed}
        width="var(--sidebar-width)"
        collapsedWidth="var(--sidebar-collapsed-width)"
        transitionDuration={0}
        className={`sidebar-panel sawa-sidebar-panel ${collapsed ? 'sawa-sidebar-panel-collapsed' : ''}`}
        rootStyles={sidebarRootStyles}
        onContextMenu={(event) => onContextMenu(event, { type: 'app' })}
      >
        <div className="sawa-sidebar-shell">
          <div className="sawa-sidebar-header">
            <button
              className={`primary-button sawa-sidebar-add-button ${collapsed ? 'sawa-sidebar-add-button-collapsed' : ''}`}
              onClick={(event) => onAddCategories?.(event)}
              title="Ajouter des categories"
            >
              <FolderPlusIcon size={16} />
              {!collapsed ? <span>Ajouter</span> : null}
            </button>

            <div className="sawa-sidebar-header-controls">
              {!collapsed ? (
                <button
                  type="button"
                  className={`icon-pill sawa-sidebar-customize-button ${customizeMode ? 'active' : ''}`}
                  onClick={() => setCustomizeMode((value) => !value)}
                  title={customizeMode ? 'Terminer la personnalisation' : 'Personnaliser la barre laterale'}
                >
                  <EditIcon size={15} />
                </button>
              ) : null}

              <button
                type="button"
                className="icon-pill sawa-sidebar-collapse-button"
                onClick={onToggleCollapsed}
                title={collapsed ? 'Deplier' : 'Replier'}
              >
                {collapsed ? <PanelExpandIcon size={16} /> : <PanelCollapseIcon size={16} />}
              </button>
            </div>
          </div>

          <div className="sawa-sidebar-body">
            <div className="sawa-sidebar-nav-shell">
              {!customizeMode ? (
                <Menu className="sawa-sidebar-nav-menu" menuItemStyles={sidebarMenuItemStyles}>
                  {navigationItems.map((item) => {
                    const active = activeScreen === item.id;
                    const badge = badgeForSection(item.id);
                    return (
                      <MenuItem
                        key={item.id}
                        active={active}
                        icon={item.icon({ active })}
                        title={collapsed ? item.label : undefined}
                        suffix={!collapsed && badge > 0 ? <span className="sidebar-badge">{badge}</span> : null}
                        onClick={() => onScreenChange(item.id)}
                      >
                        {item.label}
                      </MenuItem>
                    );
                  })}
                </Menu>
              ) : (
                <div className="sawa-sidebar-editor-shell">
                  <div className="sawa-sidebar-section-head">
                    <strong>Navigation</strong>
                    <span>{navigationItems.length}</span>
                  </div>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={navigationItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                      <div className="sawa-sidebar-editor-list">
                        {navigationItems.map((item) => (
                          <SortableEditorItem
                            key={item.id}
                            item={item}
                            active={activeScreen === item.id}
                            badge={badgeForSection(item.id)}
                            onToggleVisible={onSetSectionVisible}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>

                  {hiddenNavigationItems.length > 0 ? (
                    <div className="sawa-sidebar-editor-hidden">
                      <div className="sawa-sidebar-section-head">
                        <strong>Masques</strong>
                        <span>{hiddenNavigationItems.length}</span>
                      </div>
                      <div className="sawa-sidebar-editor-list">
                        {hiddenNavigationItems.map((item) => (
                          <HiddenEditorItem
                            key={item.id}
                            item={item}
                            badge={badgeForSection(item.id)}
                            onToggleVisible={onSetSectionVisible}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="sawa-sidebar-editor-note">
                    Glisse les vues visibles pour changer leur ordre. Les vues masquees se reaffichent ici en un clic.
                  </div>
                </div>
              )}
            </div>

            {!collapsed && !customizeMode ? (
              <>
                {sidebarPins.length > 0 ? (
                  <section className="sawa-sidebar-card">
                    <button type="button" className="sawa-sidebar-section-toggle" onClick={() => setPinsOpen((value) => !value)}>
                      <span>Acces rapides</span>
                      <span>{sidebarPins.length}</span>
                    </button>
                    {pinsOpen ? (
                      <div className="sawa-sidebar-pin-list">
                        {sidebarPins.map((pin) => (
                          <button
                            key={pin.id}
                            type="button"
                            className={`sawa-sidebar-pin-item ${activeScreen === pin.refId ? 'sawa-sidebar-pin-item-active' : ''}`}
                            onClick={() => onActivatePin(pin)}
                            onContextMenu={(event) => onContextMenu(event, { type: 'sidebar-pin', pin })}
                          >
                            <span className="sawa-sidebar-pin-icon">{pinIconFor(pin)}</span>
                            <span className="sawa-sidebar-pin-copy">
                              <strong>{pin.label || pin.refId}</strong>
                              <small>{pin.type === 'screen' ? 'Vue epinglee' : 'Raccourci perso'}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="sawa-sidebar-card">
                  <button type="button" className="sawa-sidebar-section-toggle" onClick={() => setCategoriesOpen((value) => !value)}>
                    <span>Categories</span>
                    <span>{visibleCats.length}</span>
                  </button>

                  {categoriesOpen ? (
                    <>
                      <button
                        type="button"
                        className={`chip-button sawa-sidebar-category-chip ${selectedCategoryId === null ? 'chip-button-active' : ''}`}
                        onClick={() => onSelectCategory(null)}
                      >
                        Toutes les categories
                      </button>

                      <div className="sawa-sidebar-category-list">
                        {visibleCats.map((category) => (
                          <div
                            key={category.id}
                            className={`sawa-sidebar-category-row ${selectedCategoryId === category.id ? 'sawa-sidebar-category-row-active' : ''} ${category.exists === false || category.availability === 'missing' ? 'sawa-sidebar-category-row-missing' : ''}`}
                            onContextMenu={(event) => onContextMenu(event, { type: 'category', category })}
                          >
                            <button
                              type="button"
                              className="sawa-sidebar-category-main"
                              onClick={() => onSelectCategory(selectedCategoryId === category.id ? null : category.id)}
                              title={category.name}
                            >
                              <span className="sawa-sidebar-category-copy">
                                <span className="sawa-sidebar-category-name">{category.name}</span>
                                {category.exists === false || category.availability === 'missing' ? <small>{category.path}</small> : null}
                              </span>
                              {category.exists === false || category.availability === 'missing' ? <span className="sawa-sidebar-category-status" title={category.path}>Introuvable</span> : null}
                              <span className="category-count">{category.mangaCount ?? 0}</span>
                            </button>

                            <div className="sawa-sidebar-category-actions">
                              {category.exists === false || category.availability === 'missing' ? (
                                <button
                                  type="button"
                                  className="icon-button sawa-sidebar-category-relink"
                                  title={`Retrouver ${category.path}`}
                                  onClick={() => onRelinkCategory?.(category.id)}
                                >
                                  <FolderPlusIcon size={15} />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                className="icon-button"
                                title={category.hidden ? 'Afficher' : 'Masquer'}
                                onClick={() => onToggleCategoryHidden(category.id)}
                              >
                                {category.hidden ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
                              </button>
                              <button
                                type="button"
                                className="icon-button danger"
                                title="Retirer"
                                onClick={() => onRemoveCategory(category.id)}
                              >
                                <TrashIcon size={15} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {hiddenCats.length > 0 ? (
                        <div className="sawa-sidebar-hidden-categories">
                          <button type="button" className="hidden-categories-toggle" onClick={() => setHiddenOpen((value) => !value)}>
                            <span>Categories cachees</span>
                            <span className="category-count">{hiddenCats.length}</span>
                          </button>

                          {hiddenOpen ? (
                            <div className="sawa-sidebar-category-list sawa-sidebar-category-list-hidden">
                              {hiddenCats.map((category) => (
                                <div
                                  key={category.id}
                                  className="sawa-sidebar-category-row"
                                  onContextMenu={(event) => onContextMenu(event, { type: 'category', category })}
                                >
                                  <button
                                    type="button"
                                    className="sawa-sidebar-category-main"
                                    onClick={() => onToggleCategoryHidden(category.id)}
                                    title={category.name}
                                  >
                                    <span className="sawa-sidebar-category-name">{category.name}</span>
                                    <span className="category-count">{category.mangaCount ?? 0}</span>
                                  </button>
                                  <div className="sawa-sidebar-category-actions">
                                    <button
                                      type="button"
                                      className="icon-button"
                                      title="Afficher"
                                      onClick={() => onToggleCategoryHidden(category.id)}
                                    >
                                      <EyeOffIcon size={15} />
                                    </button>
                                    <button
                                      type="button"
                                      className="icon-button danger"
                                      title="Retirer"
                                      onClick={() => onRemoveCategory(category.id)}
                                    >
                                      <TrashIcon size={15} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              </>
            ) : null}
          </div>

          <div className="sawa-sidebar-footer">
            <button
              type="button"
              className={`ghost-button sawa-sidebar-settings-button ${collapsed ? 'sawa-sidebar-settings-button-collapsed' : ''}`}
              onClick={onOpenSettings}
              title="Parametres"
            >
              <SettingsIcon size={16} />
              {!collapsed ? <span>Parametres</span> : null}
            </button>
          </div>
        </div>
      </ProSidebar>
    </>
  );
}

export default memo(Sidebar);
