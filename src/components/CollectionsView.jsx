import { memo, useEffect, useMemo, useState } from 'react';
import { resolveSmartCollection } from '../utils/reader.js';
import VirtualMangaGrid from './VirtualMangaGrid.jsx';
import CollectionCoverPreview from './CollectionCoverPreview.jsx';
import {
  COLLECTION_APPEARANCE_OPTIONS,
  getFeaturedMangaPage,
  normalizeCollectionAppearance,
  toggleFeaturedManga
} from '../utils/collectionAppearance.js';
import {
  ArchiveIcon,
  BookIcon,
  ChevronLeftIcon,
  ClockIcon,
  EditIcon,
  HeartIcon,
  ImageIcon,
  LayersIcon,
  PinIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
  ZapIcon
} from './Icons.jsx';

const ICON_OPTIONS = [
  { value: 'layers', label: 'Collections', icon: LayersIcon },
  { value: 'sparkles', label: 'Assistant', icon: SparklesIcon },
  { value: 'heart', label: 'Favori', icon: HeartIcon },
  { value: 'play', label: 'Lecture', icon: PlayIcon },
  { value: 'clock', label: 'Temps', icon: ClockIcon },
  { value: 'image', label: 'Cover', icon: ImageIcon },
  { value: 'tag', label: 'Tag', icon: TagIcon },
  { value: 'book', label: 'Book', icon: BookIcon },
  { value: 'archive', label: 'Prive', icon: ArchiveIcon },
  { value: 'zap', label: 'Focus', icon: ZapIcon }
];

const CONDITION_OPTIONS = [
  { key: 'status', label: 'Etat de lecture' },
  { key: 'favorite', label: 'Favori' },
  { key: 'tag', label: 'Tag' },
  { key: 'collection', label: 'Collection' },
  { key: 'missing-cover', label: 'Sans cover' },
  { key: 'missing-metadata', label: 'Sans metadata' },
  { key: 'new-chapters', label: 'Nouveaux chapitres' },
  { key: 'recent-added', label: 'Ajoute recemment' },
  { key: 'recent-read', label: 'Lu recemment' },
  { key: 'query', label: 'Recherche texte' },
  { key: 'min-chapters', label: 'Chapitres minimum' },
  { key: 'max-chapters', label: 'Chapitres maximum' },
  { key: 'private', label: 'Dans le coffre' }
];

function SmartCollectionIcon({ iconKey, size = 18 }) {
  const match = ICON_OPTIONS.find((item) => item.value === iconKey) || ICON_OPTIONS[0];
  const Icon = match.icon;
  return <Icon size={size} />;
}

function isPinActive(sidebarPins, type, refId) {
  return (sidebarPins || []).some((pin) => pin.type === type && pin.refId === refId);
}

function defaultSmartCollectionDraft() {
  return {
    name: '',
    description: '',
    icon: 'sparkles',
    color: '#64748b',
    appearance: normalizeCollectionAppearance(null),
    rules: {
      matchMode: 'all',
      sort: 'title-asc',
      conditions: [{ key: 'status', value: 'continue' }]
    }
  };
}

function normalizeSmartDraft(collection) {
  const base = defaultSmartCollectionDraft();
  if (!collection) return base;
  return {
    id: collection.id,
    name: collection.name || '',
    description: collection.description || '',
    icon: collection.icon || 'sparkles',
    color: collection.color || '#64748b',
    appearance: normalizeCollectionAppearance(collection.appearance),
    rules: {
      matchMode: collection.rules?.matchMode === 'any' ? 'any' : 'all',
      sort: collection.rules?.sort || 'title-asc',
      conditions: Array.isArray(collection.rules?.conditions) && collection.rules.conditions.length > 0
        ? collection.rules.conditions.map((condition) => ({ key: condition.key || 'status', value: condition.value ?? 'continue' }))
        : [{ key: collection.rules?.type || 'status', value: collection.rules?.days || 'continue' }]
    }
  };
}

function AppearanceEditor({ value, mangas, onChange }) {
  const appearance = normalizeCollectionAppearance(value);
  const [featuredQuery, setFeaturedQuery] = useState('');
  const [featuredPage, setFeaturedPage] = useState(0);
  const featuredOptions = useMemo(
    () => getFeaturedMangaPage(mangas, { query: featuredQuery, page: featuredPage, pageSize: 40 }),
    [featuredPage, featuredQuery, mangas]
  );
  return (
    <div className="collection-appearance-editor">
      <div className="collection-appearance-options" role="group" aria-label="Apparence de la collection">
        {COLLECTION_APPEARANCE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={appearance.type === option.value ? 'active' : ''}
            onClick={() => onChange({ ...appearance, type: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>
      <CollectionCoverPreview collection={{ appearance }} mangas={mangas} />
      {mangas.length ? (
        <details className="collection-featured-picker">
          <summary>Mangas mis en avant (facultatif)</summary>
          <input
            type="search"
            value={featuredQuery}
            placeholder="Rechercher un manga…"
            onChange={(event) => {
              setFeaturedQuery(event.target.value);
              setFeaturedPage(0);
            }}
          />
          <div>
            {featuredOptions.items.map((manga) => (
              <label key={manga.id}>
                <input
                  type="checkbox"
                  checked={appearance.featuredMangaIds.includes(String(manga.id))}
                  onChange={() => onChange(toggleFeaturedManga(appearance, manga.id))}
                />
                <span>{manga.displayTitle || manga.name}</span>
              </label>
            ))}
          </div>
          {featuredOptions.totalPages > 1 ? (
            <div className="collection-featured-pagination">
              <button type="button" disabled={featuredOptions.page === 0} onClick={() => setFeaturedPage((page) => Math.max(0, page - 1))}>Précédents</button>
              <span>{featuredOptions.page + 1}/{featuredOptions.totalPages} · {featuredOptions.total} mangas</span>
              <button type="button" disabled={featuredOptions.page >= featuredOptions.totalPages - 1} onClick={() => setFeaturedPage((page) => Math.min(featuredOptions.totalPages - 1, page + 1))}>Suivants</button>
            </div>
          ) : null}
          <small>Jusqu’à quatre mangas. Si l’un disparaît, Sawa choisit automatiquement le suivant.</small>
        </details>
      ) : null}
    </div>
  );
}

function CollectionFormModal({ onClose, onSubmit, initial, mangas = [] }) {
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [appearance, setAppearance] = useState(() => normalizeCollectionAppearance(initial?.appearance));

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim(), appearance });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="tag-modal-header" style={{ marginBottom: 12 }}>
          <div className="tag-modal-title">
            <div className="tag-modal-icon"><LayersIcon size={20} /></div>
            <h3 style={{ margin: 0 }}>{initial ? 'Modifier la collection' : 'Nouvelle collection'}</h3>
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            Nom de la collection
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Shonen favoris" autoFocus />
          </label>
          <label>
            Description
            <textarea rows="3" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Une courte intention..." />
          </label>
          <AppearanceEditor value={appearance} mangas={mangas} onChange={setAppearance} />
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Annuler</button>
            <button type="submit" className="primary-button" disabled={!name.trim()}>{initial ? 'Enregistrer' : 'Creer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConditionEditor({ condition, index, tags, collections, onChange, onRemove }) {
  const option = CONDITION_OPTIONS.find((item) => item.key === condition.key) || CONDITION_OPTIONS[0];

  let valueField = null;
  if (condition.key === 'status') {
    valueField = (
      <select value={condition.value || 'continue'} onChange={(event) => onChange(index, { ...condition, value: event.target.value })}>
        <option value="continue">A reprendre</option>
        <option value="unread">Non lu</option>
        <option value="in-progress">En cours</option>
        <option value="completed">Termine</option>
      </select>
    );
  } else if (condition.key === 'favorite' || condition.key === 'private') {
    valueField = (
      <select value={String(condition.value ?? true)} onChange={(event) => onChange(index, { ...condition, value: event.target.value === 'true' })}>
        <option value="true">Oui</option>
        <option value="false">Non</option>
      </select>
    );
  } else if (condition.key === 'tag') {
    valueField = (
      <select value={condition.value || ''} onChange={(event) => onChange(index, { ...condition, value: event.target.value })}>
        <option value="">Choisir un tag</option>
        {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </select>
    );
  } else if (condition.key === 'collection') {
    valueField = (
      <select value={condition.value || ''} onChange={(event) => onChange(index, { ...condition, value: event.target.value })}>
        <option value="">Choisir une collection</option>
        {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
      </select>
    );
  } else if (condition.key === 'recent-added' || condition.key === 'recent-read' || condition.key === 'min-chapters' || condition.key === 'max-chapters') {
    valueField = (
      <input type="number" min="0" value={condition.value ?? 0} onChange={(event) => onChange(index, { ...condition, value: Number(event.target.value || 0) })} />
    );
  } else if (condition.key === 'query') {
    valueField = (
      <input value={condition.value || ''} onChange={(event) => onChange(index, { ...condition, value: event.target.value })} placeholder="Mot cle, auteur, tag..." />
    );
  }

  return (
    <div className="smart-rule-row">
      <select value={option.key} onChange={(event) => onChange(index, { key: event.target.value, value: event.target.value === 'status' ? 'continue' : true })}>
        {CONDITION_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      {valueField ? <div className="smart-rule-value">{valueField}</div> : <div className="smart-rule-value smart-rule-value-empty">Sans valeur supplementaire</div>}
      <button type="button" className="ghost-button" onClick={() => onRemove(index)}><TrashIcon size={14} /></button>
    </div>
  );
}

function SmartCollectionModal({ initial, tags, collections, mangas = [], onClose, onSubmit }) {
  const [draft, setDraft] = useState(() => normalizeSmartDraft(initial));

  const handleConditionChange = (index, nextCondition) => {
    setDraft((current) => ({
      ...current,
      rules: {
        ...current.rules,
        conditions: current.rules.conditions.map((condition, conditionIndex) => conditionIndex === index ? nextCondition : condition)
      }
    }));
  };

  const handleConditionRemove = (index) => {
    setDraft((current) => ({
      ...current,
      rules: {
        ...current.rules,
        conditions: current.rules.conditions.filter((_, conditionIndex) => conditionIndex !== index)
      }
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    onSubmit({
      ...initial,
      ...draft,
      name: draft.name.trim(),
      description: draft.description.trim(),
      rules: {
        ...draft.rules,
        conditions: draft.rules.conditions.filter((condition) => condition?.key)
      }
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel modal-panel-wide smart-modal" onClick={(event) => event.stopPropagation()}>
        <div className="smart-modal-header">
          <div>
            <span className="smart-modal-kicker">Collection intelligente</span>
            <h3>{initial ? 'Modifier la collection intelligente' : 'Nouvelle collection intelligente'}</h3>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Fermer</button>
        </div>

        <form className="smart-modal-form" onSubmit={handleSubmit}>
          <div className="smart-modal-grid">
            <label>
              Nom
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex: A corriger ce soir" autoFocus />
            </label>
            <label>
              Icone
              <select value={draft.icon} onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))}>
                {ICON_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="smart-modal-span-2">
              Description
              <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="A quoi sert cette vue intelligente" />
            </label>
            <label>
              Mode de correspondance
              <select value={draft.rules.matchMode} onChange={(event) => setDraft((current) => ({ ...current, rules: { ...current.rules, matchMode: event.target.value } }))}>
                <option value="all">Toutes les regles</option>
                <option value="any">Au moins une regle</option>
              </select>
            </label>
            <label>
              Tri
              <select value={draft.rules.sort} onChange={(event) => setDraft((current) => ({ ...current, rules: { ...current.rules, sort: event.target.value } }))}>
                <option value="title-asc">Titre A ? Z</option>
                <option value="title-desc">Titre Z ? A</option>
                <option value="recent-read">Lecture recente</option>
                <option value="recent-added">Ajout recent</option>
                <option value="progress-desc">Progression</option>
                <option value="chapters-desc">Chapitres</option>
              </select>
            </label>
          </div>

          <div className="smart-rule-block">
            <div className="smart-rule-head">
              <strong>Regles</strong>
              <button type="button" className="ghost-button" onClick={() => setDraft((current) => ({ ...current, rules: { ...current.rules, conditions: [...current.rules.conditions, { key: 'query', value: '' }] } }))}>
                <PlusIcon size={14} /> Ajouter une regle
              </button>
            </div>
            <div className="smart-rule-list">
              {draft.rules.conditions.map((condition, index) => (
                <ConditionEditor
                  key={`${condition.key}-${index}`}
                  condition={condition}
                  index={index}
                  tags={tags}
                  collections={collections}
                  onChange={handleConditionChange}
                  onRemove={handleConditionRemove}
                />
              ))}
            </div>
          </div>

          <AppearanceEditor
            value={draft.appearance}
            mangas={mangas}
            onChange={(appearance) => setDraft((current) => ({ ...current, appearance }))}
          />

          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>Annuler</button>
            <button type="submit" className="primary-button" disabled={!draft.name.trim()}>Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CollectionCard({ collection, mangas, onOpen, onContextMenu, pinned, onTogglePin, isSmart = false, count }) {
  return (
    <div className={`collection-showcase-card ${isSmart ? 'collection-showcase-card-smart' : ''}`} onContextMenu={(event) => onContextMenu?.(event, { type: 'collection', collection })}>
      <button type="button" className="collection-showcase-main" onClick={() => onOpen(collection.id)}>
        <div className="collection-showcase-head">
          <span className="collection-showcase-icon" style={{ '--collection-accent': collection.color || '#64748b' }}>
            <SmartCollectionIcon iconKey={collection.icon || 'layers'} size={18} />
          </span>
          <div className="collection-showcase-copy">
            <strong>{collection.name}</strong>
            <span>{count} manga{count > 1 ? 's' : ''}</span>
          </div>
        </div>
        <p>{collection.description || (isSmart ? 'Vue dynamique basee sur tes regles.' : 'Collection manuelle pour ranger tes series.')}</p>
        <CollectionCoverPreview collection={collection} mangas={mangas} />
      </button>
      <button type="button" className={`ghost-button collection-showcase-pin ${pinned ? 'active' : ''}`} onClick={() => onTogglePin(collection)}>
        <PinIcon size={14} /> {pinned ? 'Epinglee' : 'Epingler'}
      </button>
    </div>
  );
}

function CollectionDetailView({
  collection,
  mangas,
  onBack,
  onOpenManga,
  onOpenMangaInBackgroundTab,
  onToggleFavorite,
  onEditCollection,
  onDeleteCollection,
  onContextMenu,
  pinned,
  onTogglePin,
  selectionMode,
  selectedIds,
  onToggleSelect,
  onToggleSelectionMode,
  initialScrollTop = 0,
  initialScrollPosition = null,
  scrollKey = '',
  onScrollPositionChange,
  cardSize = 'comfortable',
  visualVariant = 'classic',
  foilEnabled = true,
  foilIntensity = 28,
  adaptiveVisualEffects = true
}) {
  return (
    <div className="collection-detail">
      <div className="collection-detail-header">
        <button className="ghost-button" onClick={onBack}><ChevronLeftIcon size={16} /> Retour</button>
        <div className="collection-detail-actions">
          <button type="button" className={`ghost-button ${selectionMode ? 'active' : ''}`} onClick={onToggleSelectionMode}>
            <SearchIcon size={14} /> {selectionMode ? `${selectedIds.size} selection(s)` : 'Selection'}
          </button>
          <button type="button" className={`ghost-button ${pinned ? 'active' : ''}`} onClick={() => onTogglePin(collection)}>
            <PinIcon size={14} /> {pinned ? 'Epinglee' : 'Epingler'}
          </button>
          {!collection.isSmart || !collection.builtIn ? <button type="button" className="ghost-button" onClick={onEditCollection}><EditIcon size={16} /></button> : null}
          {!collection.isSmart || !collection.builtIn ? <button type="button" className="ghost-button" onClick={onDeleteCollection}><TrashIcon size={16} /></button> : null}
        </div>
      </div>

      <div className="collection-detail-info">
        <span className="collection-detail-kicker"><SmartCollectionIcon iconKey={collection.icon || 'layers'} size={16} /> {collection.isSmart ? 'Collection intelligente' : 'Collection manuelle'}</span>
        <h2>{collection.name}</h2>
        <p className="muted-text">{collection.description || (collection.isSmart ? 'Vue automatique basee sur tes regles.' : 'Collection manuelle composee au fil de ta bibliotheque.')}</p>
        <span className="collection-detail-count">{mangas.length} manga{mangas.length > 1 ? 's' : ''}</span>
      </div>

      {mangas.length === 0 ? (
        <div className="empty-card">
          <h3>Collection vide</h3>
          <p>Ajoute des mangas depuis le menu contextuel ou ajuste les regles de cette vue intelligente.</p>
        </div>
      ) : (
        <VirtualMangaGrid
          mangas={mangas}
          cardSize={cardSize}
          visualVariant={visualVariant}
          foilEnabled={foilEnabled}
          foilIntensity={foilIntensity}
          adaptiveVisualEffects={adaptiveVisualEffects}
          className="collection-manga-grid-virtual"
          initialScrollTop={initialScrollTop}
          initialScrollPosition={initialScrollPosition}
          scrollKey={scrollKey}
          onScrollPositionChange={onScrollPositionChange}
          onOpen={onOpenManga}
          onOpenBackground={onOpenMangaInBackgroundTab}
          onToggleFavorite={onToggleFavorite}
          onContextMenu={onContextMenu}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
        />
      )}
    </div>
  );
}

function CollectionsView({
  allMangas = [],
  persisted = {},
  onOpenManga,
  onOpenMangaInBackgroundTab,
  onToggleFavorite,
  onCreateCollection,
  onDeleteCollection,
  onUpdateCollection,
  onContextMenu,
  onSaveSmartCollection,
  onDeleteSmartCollection,
  sidebarPins = [],
  onToggleSidebarPin,
  requestedCollectionId,
  requestedTab,
  selectionMode,
  selectedMangaIds,
  onToggleSelect,
  onSelectionModeChange,
  onVisibleSelectionChange,
  initialScrollTop = 0,
  initialScrollPosition = null,
  scrollKey = '',
  onScrollPositionChange,
  cardSize = 'comfortable',
  visualVariant = 'classic',
  foilEnabled = true,
  foilIntensity = 28,
  adaptiveVisualEffects = true
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [editingCollection, setEditingCollection] = useState(null);
  const [editingSmartCollection, setEditingSmartCollection] = useState(null);
  const [activeTab, setActiveTab] = useState('manual');

  useEffect(() => {
    if (!requestedCollectionId) return;
    setActiveCollectionId(requestedCollectionId);
  }, [requestedCollectionId]);

  useEffect(() => {
    if (requestedTab) setActiveTab(requestedTab);
  }, [requestedTab]);

  const manualCollections = useMemo(() => Object.values(persisted?.collections ?? {}).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')), [persisted?.collections]);
  const smartCollections = useMemo(() => Object.values(persisted?.smartCollections ?? {}).sort((a, b) => Number(Boolean(a.builtIn)) - Number(Boolean(b.builtIn)) || a.name.localeCompare(b.name)), [persisted?.smartCollections]);
  const tagList = useMemo(() => Object.values(persisted?.tags ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [persisted?.tags]);
  const mangaById = useMemo(() => Object.fromEntries(allMangas.map((manga) => [manga.id, manga])), [allMangas]);

  const smartCounts = useMemo(() => Object.fromEntries(smartCollections.map((collection) => [collection.id, resolveSmartCollection(allMangas, collection, persisted).length])), [smartCollections, allMangas, persisted]);

  const activeCollection = useMemo(() => {
    if (!activeCollectionId) return null;
    const smart = smartCollections.find((collection) => collection.id === activeCollectionId);
    if (smart) {
      return {
        collection: { ...smart, isSmart: true },
        mangas: resolveSmartCollection(allMangas, smart, persisted)
      };
    }
    const manual = (persisted?.collections ?? {})[activeCollectionId];
    if (!manual) return null;
    return {
      collection: { ...manual, isSmart: false },
      mangas: (manual.mangaIds || []).map((id) => mangaById[id]).filter(Boolean)
    };
  }, [activeCollectionId, smartCollections, allMangas, persisted, mangaById]);

  useEffect(() => {
    onVisibleSelectionChange?.({
      viewId: activeCollection ? `collection:${activeCollection.collection.id}` : 'overview',
      ids: activeCollection ? activeCollection.mangas.map((manga) => manga.id) : []
    });
  }, [activeCollection, onVisibleSelectionChange]);

  const handleTogglePin = (collection) => {
    const type = collection.isSmart ? 'smart-collection' : 'collection';
    onToggleSidebarPin?.({
      type,
      refId: collection.id,
      label: collection.name,
      icon: collection.icon || 'layers'
    });
  };

  if (activeCollection) {
    const pinned = isPinActive(sidebarPins, activeCollection.collection.isSmart ? 'smart-collection' : 'collection', activeCollection.collection.id);
    return (
      <section className="collections-view">
        <CollectionDetailView
          collection={activeCollection.collection}
          mangas={activeCollection.mangas}
          onBack={() => setActiveCollectionId(null)}
          onOpenManga={onOpenManga}
          onOpenMangaInBackgroundTab={onOpenMangaInBackgroundTab}
          onToggleFavorite={onToggleFavorite}
          onEditCollection={() => {
            if (activeCollection.collection.isSmart) setEditingSmartCollection(activeCollection.collection);
            else setEditingCollection(activeCollection.collection);
          }}
          onDeleteCollection={() => {
            if (activeCollection.collection.isSmart) onDeleteSmartCollection?.(activeCollection.collection.id);
            else onDeleteCollection?.(activeCollection.collection.id);
            setActiveCollectionId(null);
          }}
          onContextMenu={onContextMenu}
          pinned={pinned}
          onTogglePin={handleTogglePin}
          selectionMode={selectionMode}
          selectedIds={selectedMangaIds}
          onToggleSelect={onToggleSelect}
          onToggleSelectionMode={onSelectionModeChange}
          initialScrollTop={initialScrollTop}
          initialScrollPosition={initialScrollPosition}
          scrollKey={scrollKey}
          onScrollPositionChange={onScrollPositionChange}
          cardSize={cardSize}
          visualVariant={visualVariant}
          foilEnabled={foilEnabled}
          foilIntensity={foilIntensity}
          adaptiveVisualEffects={adaptiveVisualEffects}
        />

        {editingCollection ? (
          <CollectionFormModal
            initial={editingCollection}
            mangas={activeCollection.mangas}
            onClose={() => setEditingCollection(null)}
            onSubmit={(data) => {
              onUpdateCollection?.(editingCollection.id, data);
              setEditingCollection(null);
            }}
          />
        ) : null}

        {editingSmartCollection ? (
          <SmartCollectionModal
            initial={editingSmartCollection}
            tags={tagList}
            collections={manualCollections}
            mangas={activeCollection.mangas}
            onClose={() => setEditingSmartCollection(null)}
            onSubmit={(collection) => {
              onSaveSmartCollection?.(collection);
              setEditingSmartCollection(null);
            }}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="collections-view">
      <div className="collections-hero">
        <div>
          <span className="collections-kicker">Organisation</span>
          <h2>Collections manuelles et intelligentes</h2>
          <p>Compose des espaces de rangement a la main ou laisse des regles evoluer toutes seules avec ta bibliotheque.</p>
        </div>
        <div className="collections-hero-actions">
          <button className={`ghost-button ${selectionMode ? 'active' : ''}`} onClick={onSelectionModeChange}>
            <SearchIcon size={14} /> {selectionMode ? `${selectedMangaIds.size} selection(s)` : 'Selection'}
          </button>
          <button className="primary-button" onClick={() => setShowCreate(true)}><PlusIcon size={16} /> Nouvelle collection</button>
          <button className="ghost-button" onClick={() => setEditingSmartCollection(defaultSmartCollectionDraft())}><SparklesIcon size={16} /> Smart collection</button>
        </div>
      </div>

      <div className="collections-tabs">
        <button className={`collections-tab ${activeTab === 'manual' ? 'collections-tab-active' : ''}`} onClick={() => setActiveTab('manual')}>Collections manuelles</button>
        <button className={`collections-tab ${activeTab === 'smart' ? 'collections-tab-active' : ''}`} onClick={() => setActiveTab('smart')}>Collections intelligentes</button>
      </div>

      {activeTab === 'manual' ? (
        manualCollections.length === 0 ? (
          <div className="empty-card">
            <h3>Aucune collection manuelle</h3>
            <p>Crée une premiere collection pour ranger tes mangas par humeur, univers ou priorite.</p>
          </div>
        ) : (
          <div className="collection-showcase-grid">
            {manualCollections.map((collection) => {
              const mangas = (collection.mangaIds || []).map((id) => mangaById[id]).filter(Boolean);
              return (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  mangas={mangas}
                  count={mangas.length}
                  pinned={isPinActive(sidebarPins, 'collection', collection.id)}
                  onOpen={setActiveCollectionId}
                  onContextMenu={onContextMenu}
                  onTogglePin={handleTogglePin}
                />
              );
            })}
          </div>
        )
      ) : (
        <div className="collection-showcase-grid">
          {smartCollections.map((collection) => {
            const mangas = resolveSmartCollection(allMangas, collection, persisted);
            return (
              <CollectionCard
                key={collection.id}
                collection={{ ...collection, isSmart: true }}
                mangas={mangas}
                count={smartCounts[collection.id] ?? mangas.length}
                pinned={isPinActive(sidebarPins, 'smart-collection', collection.id)}
                onOpen={setActiveCollectionId}
                onContextMenu={onContextMenu}
                onTogglePin={handleTogglePin}
                isSmart
              />
            );
          })}
        </div>
      )}

      {showCreate ? (
        <CollectionFormModal
          mangas={allMangas}
          onClose={() => setShowCreate(false)}
          onSubmit={(data) => {
            onCreateCollection(data.name, data.description, data.appearance);
            setShowCreate(false);
          }}
        />
      ) : null}

      {editingSmartCollection ? (
        <SmartCollectionModal
          initial={editingSmartCollection.id ? editingSmartCollection : null}
          tags={tagList}
          collections={manualCollections}
          mangas={allMangas}
          onClose={() => setEditingSmartCollection(null)}
          onSubmit={(collection) => {
            onSaveSmartCollection?.(collection);
            setEditingSmartCollection(null);
          }}
        />
      ) : null}
    </section>
  );
}

export default memo(CollectionsView);
