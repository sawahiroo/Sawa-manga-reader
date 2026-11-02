import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BookIcon,
  CloseIcon,
  HeartIcon,
  HomeIcon,
  LayoutGridIcon,
  LayersIcon,
  LibraryIcon,
  MaximizeIcon,
  MinimizeIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  PinIcon,
  PlusIcon,
  ScrollIcon,
  SparklesIcon
} from './Icons.jsx';
import { computeTabLayout } from '../utils/tabLayout.js';

function iconForTab(kind) {
  if (kind === 'reader') return <ScrollIcon size={14} />;
  if (kind === 'manga' || kind === 'preview') return <LayoutGridIcon size={14} />;
  return <LibraryIcon size={14} />;
}

function iconForWorkspace(iconKey) {
  if (iconKey === 'home') return <HomeIcon size={14} />;
  if (iconKey === 'library') return <LibraryIcon size={14} />;
  if (iconKey === 'layout') return <LayoutGridIcon size={14} />;
  if (iconKey === 'scroll') return <ScrollIcon size={14} />;
  if (iconKey === 'heart') return <HeartIcon size={14} filled />;
  if (iconKey === 'sparkles') return <SparklesIcon size={14} />;
  if (iconKey === 'book') return <BookIcon size={14} />;
  return <LayersIcon size={14} />;
}

function SortableTab({
  tab,
  active,
  density,
  iconOnly,
  regularWidth,
  pinnedWidth,
  onSelectTab,
  onCloseTab,
  onContextMenu
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    width: tab.pinned ? `${pinnedWidth}px` : `${regularWidth}px`
  };

  const isCompact = density === 'compact' || density === 'minimal';
  const showPin = tab.pinned && density === 'full' && !iconOnly;
  const showCopy = !tab.pinned && !iconOnly;
  const showClose = !tab.pinned && !iconOnly;

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      data-tab-id={tab.id}
      className={`browser-tab browser-tab-density-${density} ${active ? 'browser-tab-active' : ''} ${isDragging ? 'browser-tab-dragging' : ''} ${tab.pinned ? 'browser-tab-pinned' : ''} ${iconOnly ? 'browser-tab-icon-only' : ''}`}
      onClick={(event) => {
        onSelectTab(tab.id);
        event.currentTarget.blur();
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onMouseUp={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          event.stopPropagation();
          onCloseTab(tab.id);
        }
      }}
      onContextMenu={(event) => onContextMenu(event, { type: 'tab', tab })}
      title={tab.subtitle ? `${tab.label} - ${tab.subtitle}` : tab.label}
      {...attributes}
      {...listeners}
    >
      {showPin && <span className="browser-tab-pin"><PinIcon size={10} /></span>}
      <span className="browser-tab-icon">{iconForTab(tab.kind)}</span>
      {showCopy && (
        <span className="browser-tab-copy">
          <strong>{tab.label}</strong>
          {!isCompact && <small>{tab.subtitle}</small>}
        </span>
      )}
      {showClose && (
        <span
          className="browser-tab-close"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(tab.id);
          }}
          role="button"
          aria-label={`Fermer ${tab.label}`}
        >
          <CloseIcon size={12} />
        </span>
      )}
    </button>
  );
}

function TitleBar({
  sidebarCollapsed = false,
  readerFocus = false,
  onToggleSidebar,
  workspaces = [],
  activeWorkspaceId = null,
  onSelectWorkspace,
  onCreateWorkspace,
  canCreateWorkspace = true,
  tabs = [],
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onContextMenu,
  onReorderTabs,
  queueCount = 0,
  queueOpen = false,
  onToggleQueue,
  queueDisabled = false
}) {
  const tabsHostRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const host = tabsHostRef.current;
    if (!host) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setAvailableWidth(entry.contentRect.width || 0);
    });

    observer.observe(host);
    setAvailableWidth(host.clientWidth || 0);

    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => computeTabLayout({ tabs, activeTabId, availableWidth }),
    [tabs, activeTabId, availableWidth]
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorderTabs((current) => {
      const oldIndex = current.findIndex((tab) => tab.id === active.id);
      const newIndex = current.findIndex((tab) => tab.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  }

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <button
          className="window-button titlebar-sidebar-toggle no-drag"
          onClick={onToggleSidebar}
          disabled={readerFocus}
          aria-hidden={readerFocus ? 'true' : undefined}
          tabIndex={readerFocus ? -1 : 0}
          aria-label={sidebarCollapsed ? 'Afficher la barre laterale' : 'Replier la barre laterale'}
          title={sidebarCollapsed ? 'Afficher la barre laterale' : 'Replier la barre laterale'}
        >
          {sidebarCollapsed ? <PanelExpandIcon size={15} /> : <PanelCollapseIcon size={15} />}
        </button>
        <span className="brand-dot" />
        <span>Sawa</span>
      </div>

      <div className="titlebar-tabs-layout">
        <div className="workspace-rail no-drag">
          {workspaces.map((workspace, index) => (
            <button
              key={workspace.id}
              className={`workspace-button ${workspace.id === activeWorkspaceId ? 'workspace-button-active' : ''}`}
              onClick={() => onSelectWorkspace?.(workspace.id)}
              onContextMenu={(event) => onContextMenu(event, { type: 'workspace', workspace, index })}
              title={`${workspace.name} (Alt+${index + 1})`}
            >
              {iconForWorkspace(workspace.iconKey)}
            </button>
          ))}
          <button
            className="workspace-button workspace-button-add"
            onClick={() => onCreateWorkspace?.()}
            disabled={!canCreateWorkspace}
            title={canCreateWorkspace ? 'Nouvel espace' : 'Limite de 8 espaces atteinte'}
          >
            <PlusIcon size={12} />
          </button>
        </div>

        <div className={`tabsbar-main ${layout.hasOverflow ? 'tabsbar-main-overflow' : ''}`} ref={tabsHostRef}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={layout.visibleTabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
              <div className="tabsbar-visible-list" style={{ '--tabs-gap': `${layout.tabGap}px`, minWidth: layout.hasOverflow ? `${layout.contentWidth}px` : 0 }}>
                {layout.visibleTabs.map((tab) => (
                  <SortableTab
                    key={tab.id}
                    tab={tab}
                    density={layout.density}
                    iconOnly={layout.iconOnly}
                    regularWidth={layout.regularWidth}
                    pinnedWidth={layout.pinnedWidth}
                    active={tab.id === activeTabId}
                    onSelectTab={onSelectTab}
                    onCloseTab={onCloseTab}
                    onContextMenu={onContextMenu}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <button className="tabsbar-new" onClick={onNewTab} title="Nouvel onglet">
          <PlusIcon size={14} />
        </button>
        <button
          className={`tabsbar-queue ${queueOpen ? 'tabsbar-queue-active' : ''}`}
          onClick={onToggleQueue}
          title={queueDisabled ? 'Queue indisponible pendant la session neutralisee' : 'Afficher la Reading Queue'}
          disabled={queueDisabled}
        >
          <LayersIcon size={14} />
          {queueCount > 0 ? <span className="tabsbar-queue-badge">{queueCount > 99 ? '99+' : queueCount}</span> : null}
        </button>
      </div>

      <div className="titlebar-actions">
        <button className="window-button" onClick={() => window.mangaAPI.minimizeWindow()} aria-label="Minimiser">
          <MinimizeIcon size={16} />
        </button>
        <button className="window-button" onClick={() => window.mangaAPI.toggleMaximizeWindow()} aria-label="Agrandir">
          <MaximizeIcon size={14} />
        </button>
        <button className="window-button window-button-close" onClick={() => window.mangaAPI.closeWindow()} aria-label="Fermer">
          <CloseIcon size={14} />
        </button>
      </div>
    </header>
  );
}

export default memo(TitleBar);
