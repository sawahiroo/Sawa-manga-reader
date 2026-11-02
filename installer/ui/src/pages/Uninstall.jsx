import React, { useEffect, useRef, useState } from 'react';
import {
  InstallerShell,
  Check,
  Notice,
  Progress,
  ConsoleLog,
} from '../components/Shell.jsx';
import installerAPI from '../lib/ipc.js';

const UNINSTALL_STEPS = ['Confirmation', 'Nettoyage', 'Fin'];

export function UninstallPage({ state, dispatch }) {
  const [stage, setStage] = useState('confirm'); // 'confirm' | 'running' | 'done'
  const [keepData, setKeepData] = useState(state.uninstall.keepData);
  const [keepLib, setKeepLib] = useState(state.uninstall.keepLib);
  const [keepRuntime, setKeepRuntime] = useState(state.uninstall.keepRuntime);
  const [progress, setProgress] = useState(0);
  const [task, setTask] = useState('Initialisation…');
  const [lines, setLines] = useState([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (stage !== 'running' || startedRef.current) return;
    startedRef.current = true;

    const opts = { keepData, keepLib, keepRuntime };
    const unsubProgress = installerAPI.onProgress((evt) => {
      setLines((l) => [...l, evt]);
      if (typeof evt.p === 'number') setProgress(evt.p);
      if (evt.task) setTask(evt.task);
    });
    const unsubDone = installerAPI.onDone(() => {
      setProgress(100);
      setStage('done');
    });

    installerAPI.startUninstall(opts).then((res) => {
      if (!res || res.started === false) {
        // dev fallback: simulate
        const script = [
          { task: 'Process Sawa', m: 'Arrêt des processus en cours', p: 8 },
          { task: 'Process Sawa', m: '  java.exe / javaw.exe terminés', p: 16 },
          { task: 'Fichiers', m: 'Suppression du dossier programme', p: 32 },
          { task: 'Fichiers', m: '  resources/, vendor/, locales/', p: 48 },
          { task: 'Registre', m: 'Nettoyage HKCU/HKLM\\Software\\Sawa', p: 60 },
          {
            task: 'Registre',
            m: '  protocole sawa://, associations .cbz/.cbr/.cb7/.pdf',
            p: 72,
          },
          { task: 'Raccourcis', m: 'Bureau, Menu Démarrer, Auto-start', p: 84 },
          {
            task: 'Caches',
            m: keepRuntime
              ? '  caches conservés (option active)'
              : '  caches SQLite/OCR/thumbnails supprimés',
            p: 92,
          },
          {
            task: 'Bibliothèque',
            m: keepLib
              ? '  dossier bibliothèque conservé'
              : '  dossier bibliothèque supprimé',
            p: 96,
          },
          {
            task: 'Données utilisateur',
            m: keepData
              ? '  user-data/*.json conservé'
              : '  user-data/*.json supprimé',
            p: 99,
          },
          {
            task: 'Terminé',
            m: 'Sawa désinstallé avec succès',
            p: 100,
            c: 'ok',
          },
        ];
        let i = 0;
        const tick = () => {
          if (i >= script.length) {
            setStage('done');
            return;
          }
          const s = script[i++];
          setLines((l) => [...l, s]);
          if (typeof s.p === 'number') setProgress(s.p);
          if (s.task) setTask(s.task);
          setTimeout(tick, 280);
        };
        setTimeout(tick, 350);
      }
    });

    return () => {
      unsubProgress && unsubProgress();
      unsubDone && unsubDone();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  if (stage === 'confirm') {
    return (
      <InstallerShell
        steps={UNINSTALL_STEPS}
        current={0}
        header={{
          eyebrow: 'Désinstallation',
          title: 'Retirer Sawa Manga Library',
          sub: 'v5.0.1 · Sawa Horizon',
        }}
        footer={
          <>
            <button
              className="btn"
              onClick={() => installerAPI.quit()}
            >
              Annuler
            </button>
            <button
              className="btn danger"
              onClick={() => {
                dispatch({
                  set: {
                    uninstall: { keepData, keepLib, keepRuntime },
                  },
                });
                setStage('running');
              }}
            >
              Désinstaller
            </button>
          </>
        }
      >
        <Notice kind="warn" title="Cette opération supprimera :">
          Sawa Manga Library.exe · resources · vendor/suwayomi · raccourcis menu Démarrer /
          bureau · associations de fichiers · entrées du registre.
        </Notice>

        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            À conserver ?
          </div>
          <Check
            on={keepData}
            onClick={() => setKeepData(!keepData)}
            title="Conserver mes données utilisateur"
            desc="user-data/*.json — progression, favoris, tags, collections, coffre, reading queue"
          />
          <Check
            on={keepLib}
            onClick={() => setKeepLib(!keepLib)}
            title="Conserver le dossier bibliothèque"
            desc="Vos fichiers manga locaux (fortement recommandé — non reconstructibles)"
          />
          <Check
            on={keepRuntime}
            onClick={() => setKeepRuntime(!keepRuntime)}
            title="Conserver les caches dérivés"
            desc="SQLite, OCR, thumbnails — reconstructibles depuis les JSON + fichiers source"
          />
        </div>

        <Notice kind="info">
          Les caches décochés seront supprimés. Les mangas déjà importés depuis
          Sources web restent dans le dossier bibliothèque et ne sont jamais
          supprimés par la désinstallation.
        </Notice>
      </InstallerShell>
    );
  }

  if (stage === 'running') {
    return (
      <InstallerShell
        steps={UNINSTALL_STEPS}
        current={1}
        header={{
          eyebrow: 'Désinstallation',
          title: 'Nettoyage en cours',
          sub: task,
        }}
        footer={
          <>
            <button className="btn ghost" disabled>
              Annuler
            </button>
            <button className="btn danger" disabled>
              Désinstallation…
            </button>
          </>
        }
        footerLeft={
          <div
            style={{
              marginLeft: 14,
              fontSize: 10.5,
              color: 'var(--text-muted)',
              fontFamily: 'var(--ff-mono)',
            }}
          >
            <span style={{ color: 'var(--gold-soft)' }}>●</span>
            &nbsp;{progress}%
          </div>
        }
      >
        <Progress value={progress} />
        <div
          style={{
            fontSize: 11.5,
            color: 'var(--text-secondary)',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <span
            className="h-serif"
            style={{ fontStyle: 'italic', color: 'var(--gold-soft)' }}
          >
            ✦
          </span>
          <span>{task}</span>
          <span style={{ flex: 1 }} />
          <span
            className="mono"
            style={{ fontSize: 10.5, color: 'var(--text-muted)' }}
          >
            {progress}%
          </span>
        </div>
        <ConsoleLog lines={lines} />
      </InstallerShell>
    );
  }

  // done
  return (
    <InstallerShell
      steps={UNINSTALL_STEPS}
      current={2}
      header={{
        eyebrow: 'Désinstallation',
        title: 'Sawa a été retirée',
        sub: 'Vous pouvez fermer cette fenêtre',
      }}
      footer={
        <>
          <button className="btn ghost" disabled>
            ‹ Précédent
          </button>
          <button className="btn" disabled>
            Annuler
          </button>
          <button
            className="btn primary"
            onClick={() => installerAPI.quit()}
          >
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
        <div className="eyebrow">✓ Désinstallation terminée</div>
        <h1
          className="h-serif"
          style={{
            margin: 0,
            fontSize: 22,
            lineHeight: 1.2,
            color: 'var(--silver-cool)',
          }}
        >
          Sawa s'est{' '}
          <span style={{ color: 'var(--gold-soft)', fontStyle: 'italic' }}>
            retirée discrètement
          </span>
          .
        </h1>
        <div className="rule-ornament">✦ Midnight Ember ✦</div>
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
            margin: 0,
          }}
        >
          {keepLib
            ? 'Votre dossier bibliothèque est intact. '
            : ''}
          {keepData
            ? "Vos données utilisateur (user-data/*.json) sont conservées — vous pourrez les retrouver à la prochaine installation. "
            : ''}
          Merci d'avoir utilisé Sawa.
        </p>
        <div style={{ flex: 1 }} />
      </div>
    </InstallerShell>
  );
}

export default UninstallPage;
