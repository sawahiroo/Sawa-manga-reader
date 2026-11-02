import { memo, useEffect, useState } from 'react';

function MetadataCandidateCover({ candidate, className = '', fallback = null, alt = '' }) {
  const identity = String(candidate?.identity || '').trim();
  const [state, setState] = useState({ identity: '', src: '', error: false });

  useEffect(() => {
    let disposed = false;
    if (!identity || !(candidate?.coverPreviewUrl || candidate?.coverUrl || candidate?.coverDownloadUrl)) {
      setState({ identity, src: '', error: false });
      return () => { disposed = true; };
    }
    setState({ identity, src: '', error: false });
    window.mangaAPI.getMetadataCandidateCover(identity).then((result) => {
      if (disposed || identity !== String(candidate?.identity || '').trim()) return;
      setState({ identity, src: result?.ok ? result.dataUrl : '', error: !result?.ok });
    }).catch(() => {
      if (!disposed) setState({ identity, src: '', error: true });
    });
    return () => { disposed = true; };
  }, [candidate?.coverDownloadUrl, candidate?.coverPreviewUrl, candidate?.coverUrl, identity]);

  if (!state.src) return fallback;
  return <img src={state.src} alt={alt} className={className} loading="lazy" draggable={false} />;
}

export default memo(MetadataCandidateCover);
