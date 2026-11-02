import React from 'react';
import { Modal } from '../components/Shell.jsx';

export function ExistingInstallModal({
  version,
  onRepair,
  onUpgrade,
  onUninstall,
  onCancel,
}) {
  return (
    <Modal
      kind="info"
      title="Une version de Sawa est déjà installée"
      sub={`v${version || '3.x.x'} → v5.0.1 · Sawa Horizon`}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn" onClick={onRepair}>
            Réparer
          </button>
          <button className="btn" onClick={onUninstall}>
            Désinstaller
          </button>
          <button className="btn primary" onClick={onUpgrade}>
            Mettre à jour
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 10px' }}>
        Comment souhaitez-vous procéder ? Vos données utilisateur
        (<span className="mono">user-data/*.json</span>) seront conservées
        intactes dans tous les cas — elles sont la source de vérité v4.
      </p>
      <div
        className="card"
        style={{
          padding: 10,
          fontSize: 11,
          lineHeight: 1.5,
          background: 'var(--bg-field)',
        }}
      >
        <div>
          <span style={{ color: 'var(--gold-soft)' }}>Mettre à jour</span> —
          remplace les binaires, migre le schéma SQLite dérivé.
        </div>
        <div>
          <span style={{ color: 'var(--gold-soft)' }}>Réparer</span> —
          réinstalle par-dessus la version existante.
        </div>
        <div>
          <span style={{ color: 'var(--gold-soft)' }}>Désinstaller</span> —
          retire la version actuelle avant de continuer.
        </div>
      </div>
    </Modal>
  );
}

export default ExistingInstallModal;
