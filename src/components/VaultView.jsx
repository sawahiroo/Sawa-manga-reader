import { memo, useMemo, useState } from 'react';
import VirtualMangaGrid from './VirtualMangaGrid.jsx';
import { ArchiveIcon, EyeIcon, EyeOffIcon, LockIcon, SettingsIcon } from './Icons.jsx';

function getSecurityLabel(vault) {
  if (vault?.securityMode === 'system') return 'Protection systeme Windows';
  if (vault?.securityMode === 'basic') return 'PIN local';
  if (vault?.systemProtectionAvailable) return 'Protection systeme disponible';
  return 'PIN local';
}

function getSecurityCopy(vault) {
  if (vault?.securityMode === 'system') {
    return 'Le code du coffre est protege par le chiffrement local de Windows en plus du PIN.';
  }
  if (vault?.systemProtectionAvailable) {
    return 'La protection systeme locale est disponible. Reconfigurer le coffre appliquera ce niveau de protection.';
  }
  return 'Le coffre reste verrouille par PIN local et masque son contenu hors de la vue dediee.';
}

function VaultMetaPill({ label, value }) {
  return (
    <div className="vault-meta-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function VaultSetupCard({ configured, onSubmit, title, description, submitLabel, vault, visualVariant = 'classic' }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');

  const requiresConfirm = !configured;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (pin.trim().length < 4) {
      setError('Le code PIN doit contenir au moins 4 caracteres.');
      return;
    }
    if (requiresConfirm && pin !== confirmPin) {
      setError('Les codes PIN ne correspondent pas.');
      return;
    }
    setError('');
    try {
      await onSubmit(pin);
      setPin('');
      setConfirmPin('');
    } catch (submitError) {
      setError(submitError?.message || 'Operation impossible.');
    }
  };

  const form = (
    <form className="vault-form" onSubmit={handleSubmit}>
      <label className="vault-pin-field">
        <span>Code PIN</span>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="Saisir le code PIN"
          autoFocus
          autoComplete="current-password"
        />
      </label>
      {requiresConfirm ? (
        <label className="vault-pin-field">
          <span>Confirmation</span>
          <input
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(event) => setConfirmPin(event.target.value)}
            placeholder="Confirmer le code PIN"
            autoComplete="new-password"
          />
        </label>
      ) : null}
      {error ? <span className="vault-form-error" role="alert">{error}</span> : null}
      <button type="submit" className="primary-button vault-unlock-action"><LockIcon size={15} /> {submitLabel}</button>
    </form>
  );

  if (visualVariant === 'horizon') {
    return (
      <div className="vault-unlock-stage">
        <div className="vault-lock-emblem" aria-hidden="true">
          <span><LockIcon size={30} /></span>
        </div>
        <div className="vault-unlock-heading">
          <span className="vault-kicker">Coffre prive</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {form}
        <details className="vault-security-details">
          <summary>Protection et verrouillage automatique</summary>
          <div className="vault-security-details-body">
            <VaultMetaPill label="Protection" value={getSecurityLabel(vault)} />
            <VaultMetaPill label="Fermeture" value="Verrouillage auto" />
            <p>{getSecurityCopy(vault)}</p>
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="vault-locked-card">
      <div className="vault-locked-copy">
        <span className="vault-kicker">Coffre prive</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="vault-meta-row">
          <VaultMetaPill label="Protection" value={getSecurityLabel(vault)} />
          <VaultMetaPill label="Fermeture" value="Verrouillage auto" />
        </div>
        <p className="vault-security-copy">{getSecurityCopy(vault)}</p>
      </div>
      {form}
    </div>
  );
}

function VaultView({
  vault,
  mangas,
  categories = [],
  cardSize = 'comfortable',
  activeCategoryId = null,
  initialScrollTop = 0,
  initialScrollPosition = null,
  scrollKey,
  selectionMode,
  selectedIds,
  onScrollPositionChange,
  onToggleSelectionMode,
  onSelectCategory,
  onToggleSelect,
  onOpenManga,
  onOpenMangaInBackgroundTab,
  onToggleFavorite,
  onContextMenu,
  onSetupPin,
  onUnlock,
  onLock,
  onToggleBlur,
  onToggleStealth,
  visualVariant = 'classic',
  foilEnabled = true,
  foilIntensity = 28,
  adaptiveVisualEffects = true
}) {
  const activeCategory = useMemo(
    () => categories.find((category) => category.id === activeCategoryId) || null,
    [activeCategoryId, categories]
  );

  if (!vault?.configured) {
    return (
      <section className="vault-view">
        <VaultSetupCard
          configured={false}
          vault={vault}
          visualVariant={visualVariant}
          title="Configure un coffre discret pour les contenus sensibles."
          description="Les titres prives et les categories envoyees au coffre disparaissent de la navigation normale tant que tu restes hors du coffre."
          submitLabel="Activer le coffre"
          onSubmit={onSetupPin}
        />
      </section>
    );
  }

  if (vault.locked) {
    return (
      <section className="vault-view">
        <VaultSetupCard
          configured
          vault={vault}
          visualVariant={visualVariant}
          title="Le coffre est verrouille."
          description="Entre ton code pour retrouver les mangas prives. A la fermeture de l application, le coffre se reverrouille automatiquement."
          submitLabel="Deverrouiller"
          onSubmit={onUnlock}
        />
      </section>
    );
  }

  const totalProtected = Number(vault?.privateCount || mangas.length || 0);
  const categoryCount = Number(vault?.privateCategoryCount || categories.length || 0);
  const visibleCount = mangas.length;
  const title = activeCategory
    ? `${visibleCount} titre${visibleCount > 1 ? 's' : ''} dans ${activeCategory.name}`
    : `${totalProtected} titre${totalProtected > 1 ? 's' : ''} proteges`;

  const vaultHeader = (
    <div className="vault-scroll-header">
      <div className="vault-hero">
        <div>
          <span className="vault-kicker">Coffre prive</span>
          <h1>{title}</h1>
          <p>
            Les categories envoyees ici disparaissent entierement de la bibliotheque normale et restent accessibles
            uniquement depuis cette vue.
          </p>
        </div>
        <div className="vault-hero-actions">
          <button type="button" className="ghost-button" onClick={onToggleSelectionMode}>
            <SettingsIcon size={14} /> {selectionMode ? 'Quitter la selection' : 'Selection multiple'}
          </button>
          <button type="button" className="ghost-button" onClick={onToggleStealth}>
            <LockIcon size={14} /> {vault.stealthMode ? 'Stealth actif' : 'Activer stealth'}
          </button>
          <button type="button" className="ghost-button" onClick={onToggleBlur}>
            {vault.blurCovers ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
            {vault.blurCovers ? 'Retirer le flou' : 'Flouter les covers'}
          </button>
          <button type="button" className="primary-button" onClick={onLock}>
            <LockIcon size={14} /> Reverrouiller
          </button>
        </div>
      </div>

      <div className="vault-meta-row">
        <VaultMetaPill label="Protection" value={getSecurityLabel(vault)} />
        <VaultMetaPill label="Fermeture" value="Verrouillage auto" />
        <VaultMetaPill label="Categories" value={`${categoryCount}`} />
        <VaultMetaPill label="Vue" value={activeCategory ? activeCategory.name : 'Tout le coffre'} />
        <VaultMetaPill label="Stealth" value={vault.stealthMode ? 'Masquage strict' : 'Normal'} />
      </div>

      <p className="vault-security-copy">{getSecurityCopy(vault)}</p>

      {categories.length > 0 ? (
        <div className="vault-category-strip">
          <button
            type="button"
            className={`vault-category-chip ${!activeCategoryId ? 'active' : ''}`}
            onClick={() => onSelectCategory?.(null)}
          >
            <span>Tous</span>
            <span className="vault-category-chip-count">{totalProtected}</span>
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`vault-category-chip ${activeCategoryId === category.id ? 'active' : ''}`}
              onClick={() => onSelectCategory?.(category.id)}
              onContextMenu={(event) => onContextMenu?.(event, { type: 'category', category, scope: 'vault' })}
              title={`${category.name} - clic droit pour actions rapides`}
            >
              <span>{category.name}</span>
              <span className="vault-category-chip-count">{category.mangaCount ?? 0}</span>
            </button>
          ))}
        </div>
      ) : null}

    </div>
  );

  if (mangas.length === 0) {
    return (
      <section className="vault-view">
        {vaultHeader}
        <div className="vault-empty-card">
          <ArchiveIcon size={18} />
          <strong>{activeCategory ? 'Cette categorie privee est vide.' : 'Le coffre est vide.'}</strong>
          <span>
            {activeCategory
              ? 'Retire le filtre ou envoie de nouveaux mangas dans cette categorie depuis le menu contextuel.'
              : 'Envoie des mangas ou une categorie complete ici depuis le menu contextuel ou les actions en masse.'}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="vault-view vault-view-virtualized">
        <VirtualMangaGrid
          mangas={mangas}
          className="vault-grid-virtual"
          cardSize={cardSize}
          header={vaultHeader}
          initialScrollTop={initialScrollTop}
          initialScrollPosition={initialScrollPosition}
          scrollKey={scrollKey}
          onScrollPositionChange={onScrollPositionChange}
          onOpen={onOpenManga}
          onOpenBackground={onOpenMangaInBackgroundTab}
          onToggleFavorite={onToggleFavorite}
          onContextMenu={onContextMenu}
          selectedIds={selectedIds}
          selectionMode={selectionMode}
          onToggleSelect={onToggleSelect}
          privateBlur={vault.blurCovers}
          visualVariant={visualVariant}
          foilEnabled={foilEnabled}
          foilIntensity={foilIntensity}
          adaptiveVisualEffects={adaptiveVisualEffects}
        />
    </section>
  );
}

export default memo(VaultView);
