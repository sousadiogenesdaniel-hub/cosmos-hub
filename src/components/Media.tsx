import { useEffect, useRef, useState } from 'react';
import { signedUrl } from '../lib/api';
import { youtubeId } from '../lib/cards';

/** Resolve um caminho do storage (ou Blob local) para uma URL utilizável. */
export function useMediaUrl(src: string | Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    if (!src) setUrl(null);
    else if (src instanceof Blob) { objectUrl = URL.createObjectURL(src); setUrl(objectUrl); }
    else signedUrl(src).then((u) => { if (alive) setUrl(u); }).catch(() => alive && setUrl(null));
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return url;
}

export function StoredImage({ src, alt = '' }: { src: string | Blob | null; alt?: string }) {
  const url = useMediaUrl(src);
  if (!url) return null;
  return <img className="card-image" src={url} alt={alt} />;
}

export function AudioButton({ src, label = 'Ouvir', autoPlay }: { src: string | Blob | null; label?: string; autoPlay?: boolean }) {
  const url = useMediaUrl(src);
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (autoPlay && url && ref.current) ref.current.play().catch(() => {});
  }, [autoPlay, url]);
  if (!src) return null;
  return (
    <>
      <audio ref={ref} src={url ?? undefined} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} preload="auto" />
      <button type="button" className="btn small ghost" disabled={!url}
        onClick={() => { const a = ref.current; if (!a) return; if (playing) a.pause(); else { a.currentTime = 0; a.play().catch(() => {}); } }}>
        {playing ? '❚❚ Pausar' : `🔊 ${label}`}
      </button>
    </>
  );
}

export function YouTubeEmbed({ url, start }: { url: string; start: number | null }) {
  const id = youtubeId(url);
  if (!id) return <p className="muted">Link do YouTube inválido.</p>;
  const params = new URLSearchParams({ rel: '0', modestbranding: '1', autoplay: '1' });
  if (start) params.set('start', String(start));
  return (
    <div className="yt-wrap">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}?${params}`}
        title="Vídeo do YouTube"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  return options.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) ?? '';
}

export function audioExt(blob: Blob): string {
  if (blob.type.includes('mp4')) return 'm4a';
  if (blob.type.includes('ogg')) return 'ogg';
  return 'webm';
}

/** Grava áudio pelo microfone. value = caminho salvo, Blob recém-gravado ou null. */
export function AudioRecorder({ value, onChange, label }: { value: string | Blob | null; onChange: (v: Blob | null) => void; label: string }) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const timer = useRef<number>(0);

  useEffect(() => () => { window.clearInterval(timer.current); recRef.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        onChange(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.start();
      recRef.current = rec;
      setRecording(true); setSecs(0);
      timer.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
    } catch {
      setErr('Não consegui acessar o microfone. Verifique a permissão do navegador.');
    }
  }

  function stop() {
    window.clearInterval(timer.current);
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }

  return (
    <div className="recorder">
      <span className="recorder-label">{label}</span>
      {recording ? (
        <button type="button" className="btn small danger" onClick={stop}>■ Parar ({secs}s)</button>
      ) : (
        <button type="button" className="btn small ghost" onClick={start}>● {value ? 'Regravar' : 'Gravar'}</button>
      )}
      {value && !recording && <AudioButton src={value} />}
      {value && !recording && <button type="button" className="btn small link" onClick={() => onChange(null)}>Remover</button>}
      {err && <span className="error-text">{err}</span>}
    </div>
  );
}
