import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/globals.css';
import './styles/horizon.css';
import { shouldEscalateUnhandledRejection } from './utils/fatalErrors.js';

function normalizeErrorMessage(errorLike) {
  if (!errorLike) return 'Erreur inconnue';
  if (typeof errorLike === 'string') return errorLike;
  if (typeof errorLike?.message === 'string' && errorLike.message.trim()) return errorLike.message;
  try {
    return JSON.stringify(errorLike);
  } catch (_error) {
    return 'Erreur inconnue';
  }
}

function FatalScreen({ title = 'Erreur de demarrage', message = 'Une erreur inattendue a interrompu le rendu.' }) {
  const [actionStatus, setActionStatus] = React.useState('');
  const safeMessage = String(message || 'Erreur inconnue')
    .replace(/[A-Za-z]:\\[^\r\n"'<>]+/g, '[chemin local masque]')
    .slice(0, 600);
  const runAction = async (label, action) => {
    setActionStatus(`${label}...`);
    try {
      const result = await action();
      setActionStatus(result?.ok === false ? (result.error || `${label} impossible.`) : `${label}: OK`);
    } catch (error) {
      setActionStatus(error?.message || `${label} impossible.`);
    }
  };
  return (
    <div className="boot-screen">
      <div className="boot-screen-panel" style={{ maxWidth: 760, textAlign: 'left', justifyItems: 'stretch' }}>
        <p style={{ fontWeight: 700, marginBottom: 6 }}>{title}</p>
        <p style={{ margin: 0 }}>{safeMessage}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={() => runAction('Rechargement', () => window.mangaAPI.reloadApp())}>Recharger</button>
          <button type="button" onClick={() => runAction('Redemarrage', () => window.mangaAPI.restartApp({ safeMode: false }))}>Redemarrer</button>
          <button type="button" onClick={() => runAction('Mode sans echec', () => window.mangaAPI.restartApp({ safeMode: true }))}>Mode sans echec</button>
          <button type="button" onClick={() => runAction('Copie du diagnostic', () => window.mangaAPI.copyDiagnostics({ message: safeMessage }))}>Copier le diagnostic</button>
          <button type="button" onClick={() => runAction('Ouverture des diagnostics', () => window.mangaAPI.openDiagnostics())}>Ouvrir les diagnostics</button>
        </div>
        {actionStatus ? <p role="status" style={{ margin: '12px 0 0', opacity: 0.8 }}>{actionStatus}</p> : null}
      </div>
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // Keep a trace in devtools/main logs while rendering a user-friendly screen.
    // eslint-disable-next-line no-console
    console.error('Renderer fatal error:', error);
  }

  render() {
    if (this.state.error) {
      return <FatalScreen title="Erreur de rendu" message={normalizeErrorMessage(this.state.error)} />;
    }
    return this.props.children;
  }
}

function AppRoot() {
  const [globalError, setGlobalError] = React.useState(null);
  const [LoadedApp, setLoadedApp] = React.useState(null);
  const [appModuleError, setAppModuleError] = React.useState(null);

  React.useEffect(() => {
    const onWindowError = (event) => {
      setGlobalError(event?.error || event?.message || 'Erreur runtime');
    };
    const onUnhandledRejection = (event) => {
      if (shouldEscalateUnhandledRejection(event?.reason)) {
        setGlobalError(event?.reason || 'Promesse rejetee fatale');
      } else {
        // Les echecs recuperables restent visibles dans les outils de diagnostic
        // sans remplacer durablement toute l interface.
        console.warn('Unhandled rejection recuperable:', event?.reason);
      }
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  React.useEffect(() => {
    let disposed = false;
    import('./App.jsx').then((module) => {
      if (disposed) return;
      if (typeof module?.default !== 'function') {
        throw new Error('Le module App n exporte pas un composant valide.');
      }
      setLoadedApp(() => module.default);
      setAppModuleError(null);
    }).catch((error) => {
      if (!disposed) {
        setAppModuleError(error);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  if (globalError) {
    return <FatalScreen title="Erreur runtime" message={normalizeErrorMessage(globalError)} />;
  }

  if (appModuleError) {
    return <FatalScreen title="Erreur de chargement" message={normalizeErrorMessage(appModuleError)} />;
  }

  if (!LoadedApp) {
    return <FatalScreen title="Demarrage de l interface" message="Chargement en cours..." />;
  }

  return (
    <AppErrorBoundary>
      <LoadedApp />
    </AppErrorBoundary>
  );
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Element #root introuvable');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>
);
