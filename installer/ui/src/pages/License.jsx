import React, { useEffect, useState } from 'react';
import { InstallerShell, Check } from '../components/Shell.jsx';
import { STEP_LABELS } from '../lib/state.js';
import installerAPI from '../lib/ipc.js';

// Fallback EULA — also extracted to build/LICENSE.txt at packaging time and
// loaded at runtime via installerAPI.loadLicense().
const FALLBACK_EULA = (
  <>
    <p style={{ margin: '0 0 10px' }}>
      Ce logiciel est distribué gratuitement. En l'installant, vous acceptez
      les conditions suivantes :
    </p>
    <p style={{ margin: '0 0 10px' }}>
      <b style={{ color: 'var(--silver-cool)' }}>1. Stockage local.</b> Vos
      fichiers manga et vos données utilisateur (
      <span className="mono">user-data/*.json</span>) restent locaux. Aucune
      télémétrie n'est envoyée.
    </p>
    <p style={{ margin: '0 0 10px' }}>
      <b style={{ color: 'var(--silver-cool)' }}>2. Runtime Sources web.</b>{' '}
      Sawa pilote un runtime local compatible Suwayomi/Mihon écoutant sur
      <span className="mono"> 127.0.0.1</span>. Les dépôts d'extensions tiers
      ne sont pas livrés par défaut et doivent être ajoutés explicitement.
    </p>
    <p style={{ margin: '0 0 10px' }}>
      <b style={{ color: 'var(--silver-cool)' }}>3. Java.</b> Un JRE 21+ est
      requis pour Sources web. À défaut, définir{' '}
      <span className="mono">SAWA_JAVA_PATH</span>.
    </p>
    <p style={{ margin: '0 0 10px' }}>
      <b style={{ color: 'var(--silver-cool)' }}>4. Contenus importés.</b> Les
      chapitres importés depuis Sources web deviennent des fichiers locaux de
      votre bibliothèque et ne sont jamais supprimés par une désactivation ou
      désinstallation de l'addon.
    </p>
    <p style={{ margin: '0 0 10px' }}>
      <b style={{ color: 'var(--silver-cool)' }}>5. Garantie.</b> Le logiciel
      est fourni « en l'état », sans garantie d'aucune sorte.
    </p>
    <p style={{ margin: 0, color: 'var(--text-muted)' }}>
      — Version 5.0.1 · Sawa Horizon
    </p>
  </>
);

export function LicensePage({ state, dispatch }) {
  const [agreed, setAgreed] = useState(state.agreed);
  const [licenseText, setLicenseText] = useState(null);

  useEffect(() => {
    let cancelled = false;
    installerAPI.loadLicense().then((txt) => {
      if (!cancelled && txt && typeof txt === 'string' && txt.trim()) {
        setLicenseText(txt);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <InstallerShell
      steps={STEP_LABELS}
      current={1}
      header={{
        eyebrow: 'Étape 02',
        title: 'Contrat de licence',
        sub: 'Veuillez lire avant de continuer',
      }}
      footer={
        <>
          <button
            className="btn"
            onClick={() => dispatch({ goto: 'welcome' })}
          >
            ‹ Précédent
          </button>
          <button className="btn" onClick={() => dispatch({ abort: true })}>
            Annuler
          </button>
          <button
            className="btn primary"
            disabled={!agreed}
            onClick={() => {
              dispatch({ set: { agreed: true }, goto: 'prereq' });
            }}
          >
            J'accepte ›
          </button>
        </>
      }
    >
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        Appuyez sur{' '}
        <span className="mono" style={{ color: 'var(--text-secondary)' }}>
          Page ↓
        </span>{' '}
        pour voir la suite.
      </div>
      <div
        className="card"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '12px 14px',
          fontSize: 11.5,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          background: 'var(--bg-field)',
          fontFamily: 'var(--ff-mono)',
        }}
      >
        <div
          className="h-serif"
          style={{
            fontSize: 13,
            color: 'var(--gold-soft)',
            marginBottom: 8,
            fontStyle: 'italic',
          }}
        >
          Sawa Manga Library — End-User License
        </div>
        {licenseText ? (
          <pre
            style={{
              margin: 0,
              fontFamily: 'inherit',
              fontSize: 'inherit',
              lineHeight: 'inherit',
              whiteSpace: 'pre-wrap',
            }}
          >
            {licenseText}
          </pre>
        ) : (
          FALLBACK_EULA
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <Check
          radio
          on={agreed}
          onClick={() => setAgreed(true)}
          title="J'accepte les termes du contrat de licence"
        />
        <Check
          radio
          on={!agreed}
          onClick={() => setAgreed(false)}
          title="Je refuse"
        />
      </div>
    </InstallerShell>
  );
}

export default LicensePage;
