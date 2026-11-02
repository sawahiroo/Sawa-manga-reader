import React, { useState } from 'react';
import { InstallerShell, Check } from '../components/Shell.jsx';
import installerAPI from '../lib/ipc.js';

export function FinishPage({ state, dispatch }) {
  const [launch, setLaunch] = useState(true);
  const [readme, setReadme] = useState(false);
  const [scan, setScan] = useState(true);

  async function finish() {
    const scanOpts = { libraryPath: state.libraryPath };
    if (scan) await installerAPI.startInitialScan(scanOpts);
    if (launch) {
      await installerAPI.launchApp({
        installPath: state.installPath,
        libraryPath: state.libraryPath,
        initialScan: scan,
      });
    }
    if (readme) await installerAPI.openReadme();
    installerAPI.quit();
  }

  return (
    <InstallerShell
      variant="finish"
      footer={
        <>
          <button className="btn ghost" disabled>
            ‹ Précédent
          </button>
          <button className="btn" disabled>
            Annuler
          </button>
          <button className="btn primary" onClick={finish}>
            Terminer
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
        <div className="eyebrow">✓ Installation terminée</div>
        <h1
          className="h-serif"
          style={{
            margin: 0,
            fontSize: 24,
            lineHeight: 1.15,
            color: 'var(--silver-cool)',
          }}
        >
          Sawa est prête à
          <br />
          <span
            style={{ color: 'var(--gold-soft)', fontStyle: 'italic' }}
          >
            recueillir vos lectures
          </span>
          .
        </h1>

        <div className="rule-ornament">✦ v 5.0.1 · sawa horizon ✦</div>

        <p
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            margin: 0,
          }}
        >
          Au premier lancement, Sawa créera le carnet utilisateur, initialisera
          le coffre et proposera d'ajouter une première catégorie.
        </p>

        <div className="card" style={{ padding: '10px 12px' }}>
          <Check
            on={launch}
            onClick={() => setLaunch(!launch)}
            title="Lancer Sawa Manga Library maintenant"
            desc="Ouvre l'application à l'écran d'accueil"
          />
          <Check
            on={scan}
            onClick={() => setScan(!scan)}
            title="Lancer un scan initial de la bibliothèque"
            desc="Indexe les fichiers du dossier bibliothèque choisi"
          />
          <Check
            on={readme}
            onClick={() => setReadme(!readme)}
            title="Afficher les notes de version"
            desc="Ouvre README.md — changements de la v4"
          />
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            fontSize: 10.5,
            color: 'var(--text-muted)',
            letterSpacing: '.04em',
            fontFamily: 'var(--ff-mono)',
          }}
        >
          JOURNAL D'INSTALLATION → %TEMP%\Sawa-setup-{state.runId}.log
        </div>
      </div>
    </InstallerShell>
  );
}

export default FinishPage;
