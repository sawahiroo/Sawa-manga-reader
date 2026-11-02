import React from 'react';
import { InstallerShell } from '../components/Shell.jsx';

export function WelcomePage({ state, dispatch }) {
  return (
    <InstallerShell
      variant="welcome"
      footer={
        <>
          <button className="btn ghost" disabled>
            Précédent
          </button>
          <button
            className="btn"
            onClick={() => dispatch({ abort: true })}
          >
            Annuler
          </button>
          <button
            className="btn primary"
            onClick={() => dispatch({ goto: 'license' })}
          >
            Suivant ›
          </button>
        </>
      }
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          gap: 14,
        }}
      >
        <div className="eyebrow">Le Carnet de Sawa</div>
        <h1
          className="h-serif"
          style={{
            margin: 0,
            fontSize: 26,
            lineHeight: 1.15,
            color: 'var(--silver-cool)',
          }}
        >
          Installation de
          <br />
          <span style={{ color: 'var(--gold-soft)' }}>
            Sawa Manga Library
          </span>
        </h1>
        <div className="rule-ornament">✦ v 5.0.1 ✦</div>

        <p
          style={{
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
            margin: 0,
          }}
        >
          Bibliothèque manga locale, calme et sous contrôle. Cet assistant vous
          guide à travers l'installation de Sawa sur votre ordinateur.
        </p>
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--text-muted)',
            margin: 0,
          }}
        >
          Il est recommandé de fermer toutes les autres applications avant de
          continuer. L'assistant vérifiera également que le runtime Sources web
          n'est pas en cours d'exécution.
        </p>

        <div style={{ flex: 1 }} />

        <div
          className="card"
          style={{
            padding: '10px 12px',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: 'var(--mint)',
              boxShadow: '0 0 8px var(--mint)',
            }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Signature du package{' '}
            <span
              className="mono"
              style={{ color: 'var(--text-secondary)' }}
            >
              vérifiée
            </span>{' '}
            · SHA-256 valide
          </div>
        </div>
      </div>
    </InstallerShell>
  );
}

export default WelcomePage;
