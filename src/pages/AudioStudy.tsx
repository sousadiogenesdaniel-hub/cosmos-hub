import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Grade } from 'ts-fsrs';
import { deckPath, signedUrl } from '../lib/api';
import { cardFaces } from '../lib/cards';
import { RATINGS, previewIntervals } from '../lib/srs';
import { fmtInterval } from '../lib/dates';
import { useApp } from '../lib/context';
import { useStudySession } from '../lib/useStudySession';
import { Finished } from './Study';

type Phase = 'question' | 'thinking' | 'answer' | 'rating';
type After = 'wait' | 'auto' | 'listen';

const PREF = 'cosmos:audioPrefs';
interface Prefs { tts: boolean; after: After; gap: number }
const DEFAULT_PREFS: Prefs = { tts: true, after: 'wait', gap: 5 };
function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return DEFAULT_PREFS; }
}

const MODES: { value: After; title: string; desc: string }[] = [
  { value: 'wait', title: 'Eu avalio', desc: 'Depois da resposta, você toca em Errei / Difícil / Bom / Fácil.' },
  { value: 'auto', title: 'Mãos livres', desc: 'Depois da resposta, o card conta como "Bom" sozinho e vem o próximo. Se não souber, toque em Errei na pausa.' },
  { value: 'listen', title: 'Só ouvir', desc: 'Só passa os cards, sem mexer no agendamento (não conta como revisão).' },
];

const PHASE_LABEL: Record<Phase, string> = {
  question: 'Pergunta',
  thinking: 'Pense na resposta…',
  answer: 'Resposta',
  rating: 'Como foi?',
};

export default function AudioStudy() {
  const { deckId = '' } = useParams();
  const { decks, profile } = useApp();
  const { queue, current, note, rate, dismiss, stats } = useStudySession(deckId, 'audio');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>('question');
  const [countdown, setCountdown] = useState(0);
  const [replay, setReplay] = useState(0);
  const [think, setThink] = useState(profile?.audio_think_seconds ?? 15);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [showText, setShowText] = useState(false);

  const token = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const pendingResolve = useRef<(() => void) | null>(null);
  const cardStart = useRef(Date.now());
  const thinkRef = useRef(think); thinkRef.current = think;
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const busy = useRef(false);
  const skipThink = useRef(false);

  useEffect(() => { if (profile) setThink(profile.audio_think_seconds); }, [profile]);
  useEffect(() => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);

  function stopAll() {
    audio.current?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    pendingResolve.current?.();
    pendingResolve.current = null;
  }

  async function play(path: string | null, text: string, alive: () => boolean) {
    if (path) {
      try {
        const url = await signedUrl(path);
        if (!alive()) return;
        const el = audio.current ?? (audio.current = new Audio());
        el.src = url;
        await new Promise<void>((res) => {
          pendingResolve.current = res;
          el.onended = () => res();
          el.onerror = () => res();
          el.play().catch(() => res());
        });
        return;
      } catch { /* cai para a voz sintetizada */ }
    }
    if (!prefsRef.current.tts || !text || typeof speechSynthesis === 'undefined') { await wait(1500, alive); return; }
    await new Promise<void>((res) => {
      pendingResolve.current = res;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 1;
      u.onend = () => res();
      u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  }

  async function wait(ms: number, alive: () => boolean) {
    const end = Date.now() + ms;
    while (Date.now() < end && alive()) await new Promise((r) => setTimeout(r, 200));
  }

  async function doRate(grade: Grade) {
    if (!current || busy.current) return;
    busy.current = true;
    token.current++;
    stopAll();
    await rate(current, grade, Date.now() - cardStart.current);
    busy.current = false;
  }

  // sequência: pergunta → pausa para pensar → resposta → avaliação
  useEffect(() => {
    if (!running || !current || !note) return;
    const my = ++token.current;
    const alive = () => token.current === my;
    cardStart.current = Date.now();
    skipThink.current = false;
    (async () => {
      const f = cardFaces(note, current.ord);
      setPhase('question');
      await play(f.questionAudio, f.questionText, alive);
      if (!alive()) return;
      setPhase('thinking');
      for (let s = thinkRef.current; s > 0 && !skipThink.current; s--) {
        setCountdown(s);
        await wait(1000, () => alive() && !skipThink.current);
        if (!alive()) return;
      }
      setPhase('answer');
      await play(f.answerAudio, f.answerText, alive);
      if (!alive()) return;
      setPhase('rating');
      const after = prefsRef.current.after;
      if (after === 'wait') return;
      for (let s = Math.max(1, prefsRef.current.gap); s > 0; s--) { setCountdown(s); await wait(1000, alive); if (!alive()) return; }
      if (after === 'auto') doRate(3 as Grade);
      else dismiss();
    })();
    return () => { token.current++; stopAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, current?.id, current?.reps, note?.id, replay]);

  // tela ligada durante a sessão
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [running]);

  // botões do fone (avançar = Bom, voltar = Errei, play/pause)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: 'Cosmos Hub — revisão por áudio', artist: deckPath(deckId, decks) });
    const set = (a: MediaSessionAction, h: (() => void) | null) => { try { ms.setActionHandler(a, h); } catch { /* sem suporte */ } };
    set('nexttrack', () => doRate(3 as Grade));
    set('previoustrack', () => doRate(1 as Grade));
    set('play', () => setRunning(true));
    set('pause', () => setRunning(false));
    return () => { (['nexttrack', 'previoustrack', 'play', 'pause'] as MediaSessionAction[]).forEach((a) => set(a, null)); };
  });

  useEffect(() => () => { token.current++; stopAll(); }, []);

  const title = deckPath(deckId, decks);
  if (queue === null) return <div className="center-pad"><div className="spinner" /></div>;
  if (!current || !note) return <Finished title={title} stats={stats} deckId={deckId} />;

  const faces = cardFaces(note, current.ord);
  const now = new Date();
  const intervals = previewIntervals(current, now);
  const withAudio = queue.length;

  return (
    <div className="study audio-mode">
      <header className="study-head">
        <Link to="/decks" className="icon-btn" title="Sair">←</Link>
        <div className="grow">
          <div className="study-title">🎧 {title}</div>
          <div className="small muted">{withAudio} na fila · {stats.done} revisados</div>
        </div>
      </header>

      <div className="audio-stage">
        {!running ? (
          <div className="audio-setup panel">
            <h2>Revisão por áudio</h2>
            <p className="muted">Ouça a pergunta, pense, e a resposta toca sozinha. Cards sem áudio gravado são lidos pela voz do navegador (se ativado).</p>
            <label>Tempo para pensar: <strong>{think}s</strong>
              <input type="range" min={3} max={60} value={think} onChange={(e) => setThink(Number(e.target.value))} />
            </label>
            <label className="check"><input type="checkbox" checked={prefs.tts} onChange={(e) => setPrefs({ ...prefs, tts: e.target.checked })} /> Ler o texto em voz alta quando o card não tiver áudio</label>
            <div className="mode-pick" role="radiogroup" aria-label="Depois da resposta">
              {MODES.map((m) => (
                <button key={m.value} type="button" role="radio" aria-checked={prefs.after === m.value}
                  className={`mode-opt${prefs.after === m.value ? ' on' : ''}`} onClick={() => setPrefs({ ...prefs, after: m.value })}>
                  <strong>{m.title}</strong><span>{m.desc}</span>
                </button>
              ))}
            </div>
            {prefs.after !== 'wait' && (
              <label>Pausa até o próximo card: <strong>{prefs.gap}s</strong>
                <input type="range" min={1} max={20} value={prefs.gap} onChange={(e) => setPrefs({ ...prefs, gap: Number(e.target.value) })} />
              </label>
            )}
            <p className="muted small">Fone com botões: ⏭ avançar = Bom · ⏮ voltar = Errei · ⏯ pausa.</p>
            <button className="btn primary big" onClick={() => setRunning(true)}>▶ Começar</button>
          </div>
        ) : (
          <>
            <div className={`audio-orb ${phase}`}>
              <span className="orb-label">{phase === 'rating' && prefs.after !== 'wait' ? 'Próximo card em' : PHASE_LABEL[phase]}</span>
              {(phase === 'thinking' || (phase === 'rating' && prefs.after !== 'wait')) && <span className="orb-count">{countdown}</span>}
            </div>
            <button className="btn small link" onClick={() => setShowText(!showText)}>{showText ? 'Esconder texto' : 'Mostrar texto'}</button>
            {showText && (
              <div className="flashcard small-card">
                <div className="card-face" dangerouslySetInnerHTML={{ __html: faces.questionHtml }} />
                {(phase === 'answer' || phase === 'rating') && <><hr className="answer-sep" /><div className="card-face" dangerouslySetInnerHTML={{ __html: faces.answerHtml }} /></>}
              </div>
            )}
            <div className="row center gap-s wrap">
              <button className="btn ghost" onClick={() => setRunning(false)}>❚❚ Pausar</button>
              <button className="btn ghost" onClick={() => setReplay((r) => r + 1)}>↺ Repetir card</button>
              {phase !== 'answer' && phase !== 'rating' && (
                <button className="btn ghost" onClick={() => {
                  skipThink.current = true;
                  if (phase === 'question') stopAll();
                }}>⏩ Resposta já</button>
              )}
            </div>
          </>
        )}
      </div>

      {running && prefs.after !== 'listen' && (
        <footer className="study-actions">
          <div className="ratings big-touch">
            {RATINGS.map((r) => (
              <button key={r.grade} className={`rate ${r.cls}`} onClick={() => doRate(r.grade)}>
                <span className="rate-int">{fmtInterval(now, intervals[r.grade])}</span>
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
