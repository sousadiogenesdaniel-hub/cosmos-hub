import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Grade } from 'ts-fsrs';
import type { CardRow, Note } from '../lib/types';
import { deckPath } from '../lib/api';
import { cardFaces } from '../lib/cards';
import { RATINGS, previewIntervals } from '../lib/srs';
import { fmtInterval } from '../lib/dates';
import { useApp } from '../lib/context';
import { useStudySession } from '../lib/useStudySession';
import { Finished } from './Study';
import { quietWav } from '../lib/backgroundAudio';
import { FREE_RATINGS, readFree } from '../lib/free';
import { decodeClip, forgetClips, renderWav, ttsSeconds, type Placement } from '../lib/audioRender';

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

/** Tamanho máximo de cada "faixa" montada (mãos livres / só ouvir): ~15 min ≈ 29 MB. */
const MAX_TRACK_S = 15 * 60;

/** Um card dentro da faixa de áudio (tempos em segundos desde o início da faixa). */
interface Item {
  key: string;
  card: CardRow;
  note: Note;
  qStart: number; qEnd: number; aStart: number; aEnd: number; end: number;
  tts: { q: string | null; a: string | null };
  spoken: { q: boolean; a: boolean };
  paths: (string | null)[];
}
interface Track { url: string; items: Item[]; duration: number }

const cardKey = (c: CardRow) => `${c.id}:${c.reps}:${c.due}`;

export default function AudioStudy() {
  const { deckId = '' } = useParams();
  const { decks, profile } = useApp();
  const [params] = useSearchParams();
  const free = useMemo(() => readFree(params), [params]);
  const { queue, notes, current, note, rate, dismiss, stats } = useStudySession(deckId, 'audio', free);
  const buttons = free ? FREE_RATINGS : RATINGS;
  const modes = free ? MODES.map((m) => (m.value === 'auto' ? { ...m, desc: 'Depois da resposta, conta como acerto sozinho e vem o próximo. Se não souber, toque em Errei na pausa (o card volta mais adiante).' } : m.value === 'wait' ? { ...m, desc: 'Depois da resposta, você toca em Errei (o card volta mais adiante) ou Acertei.' } : m)) : MODES;
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [view, setView] = useState<{ phase: Phase; countdown: number; key: string | null }>({ phase: 'question', countdown: 0, key: null });
  const [think, setThink] = useState(profile?.audio_think_seconds ?? 15);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [showText, setShowText] = useState(false);

  const el = useRef<HTMLAudioElement | null>(null);
  const track = useRef<Track | null>(null);
  const nextTrack = useRef<Promise<Track | null> | null>(null);
  const finalized = useRef(new Set<string>());
  const switching = useRef(false);
  const queueRef = useRef(queue); queueRef.current = queue;
  const notesRef = useRef(notes); notesRef.current = notes;
  const thinkRef = useRef(think); thinkRef.current = think;
  const prefsRef = useRef(prefs); prefsRef.current = prefs;

  useEffect(() => { if (profile) setThink(profile.audio_think_seconds); }, [profile]);
  useEffect(() => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);

  function speak(text: string) {
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  /**
   * Monta a próxima faixa a partir da fila: no "Eu avalio" um card por faixa; nos
   * outros modos, vários cards seguidos (até ~15 min), para tocar sem o app acordado.
   */
  async function buildTrack(exclude: Set<string>, showProgress: boolean): Promise<Track | null> {
    const wait = prefsRef.current.after === 'wait';
    const candidates = (queueRef.current ?? []).filter((c) => !exclude.has(c.id) && !finalized.current.has(cardKey(c)));
    const items: Item[] = [];
    const placements: Placement[] = [];
    let t = 0.3;
    for (const card of candidates) {
      const n = notesRef.current.get(card.note_id);
      if (!n) continue;
      if (showProgress) setPreparing(`Preparando o áudio… ${items.length + 1}`);
      const f = cardFaces(n, card.ord);
      const [qBuf, aBuf] = await Promise.all([
        f.questionAudio ? decodeClip(f.questionAudio) : Promise.resolve(null),
        f.answerAudio ? decodeClip(f.answerAudio) : Promise.resolve(null),
      ]);
      const tts = prefsRef.current.tts;
      const qTts = !qBuf && tts && f.questionText ? f.questionText : null;
      const aTts = !aBuf && tts && f.answerText ? f.answerText : null;
      const qStart = t;
      const qEnd = qStart + (qBuf ? qBuf.duration : qTts ? ttsSeconds(qTts) : 1);
      const aStart = qEnd + thinkRef.current;
      const aEnd = aStart + (aBuf ? aBuf.duration : aTts ? ttsSeconds(aTts) : 1);
      const end = aEnd + (wait ? 0.3 : Math.max(1, prefsRef.current.gap));
      if (qBuf) placements.push({ buffer: qBuf, at: qStart });
      if (aBuf) placements.push({ buffer: aBuf, at: aStart });
      items.push({ key: cardKey(card), card, note: n, qStart, qEnd, aStart, aEnd, end, tts: { q: qTts, a: aTts }, spoken: { q: false, a: false }, paths: [f.questionAudio, f.answerAudio] });
      t = end;
      if (wait || t >= MAX_TRACK_S) break;
    }
    if (!items.length) return null;
    if (showProgress) setPreparing('Preparando o áudio…');
    const blob = await renderWav(placements, t);
    return { url: URL.createObjectURL(blob), items, duration: t };
  }

  /** Troca para a próxima faixa (já pré-montada, se possível) e toca. */
  async function playNext() {
    if (switching.current) return;
    switching.current = true;
    try {
      const old = track.current;
      const exclude = new Set(old?.items.filter((i) => !finalized.current.has(i.key)).map((i) => i.card.id) ?? []);
      let next = nextTrack.current ? await nextTrack.current : null;
      nextTrack.current = null;
      // a faixa pré-montada pode conter um card que já foi avaliado/pulado nesse meio-tempo
      if (next && next.items.some((i) => finalized.current.has(i.key))) { URL.revokeObjectURL(next.url); next = null; }
      if (!next) next = await buildTrack(exclude, !old);
      setPreparing(null);
      if (old) URL.revokeObjectURL(old.url);
      track.current = next;
      if (!next || !el.current) return;
      el.current.src = next.url;
      el.current.currentTime = 0;
      await el.current.play().catch(() => {});
      tick();
    } finally {
      switching.current = false;
    }
  }

  function finalize(item: Item, grade: Grade | null) {
    if (finalized.current.has(item.key)) return;
    finalized.current.add(item.key);
    forgetClips(item.paths);
    const pos = el.current?.currentTime ?? item.end;
    const ms = Math.max(0, Math.min(pos, item.end) - item.qStart) * 1000;
    if (grade === null) dismiss(item.card.id);
    else rate(item.card, grade, ms);
  }

  const head = () => track.current?.items.find((i) => !finalized.current.has(i.key)) ?? null;

  /** Lê em que ponto da faixa estamos e atualiza a tela (o áudio não depende disto). */
  const tick = useCallback(() => {
    const tr = track.current;
    const a = el.current;
    if (!tr || !a) return;
    const now = a.currentTime;
    const after = prefsRef.current.after;
    // cards que já tocaram por inteiro: conta a revisão (ou só tira da fila)
    if (after !== 'wait') for (const it of tr.items) if (now >= it.end) finalize(it, after === 'auto' ? (3 as Grade) : null);
    // voz sintetizada (cards sem áudio gravado): só com o app ativo
    if (!a.paused) for (const it of tr.items) {
      if (it.tts.q && !it.spoken.q && now >= it.qStart - 0.05) { it.spoken.q = true; if (now < it.qEnd) speak(it.tts.q); }
      if (it.tts.a && !it.spoken.a && now >= it.aStart - 0.05) { it.spoken.a = true; if (now < it.aEnd) speak(it.tts.a); }
    }
    const h = head();
    if (h) {
      let phase: Phase, countdown = 0;
      if (now < h.qEnd) phase = 'question';
      else if (now < h.aStart) { phase = 'thinking'; countdown = Math.ceil(h.aStart - now); }
      else if (now < h.aEnd) phase = 'answer';
      else { phase = 'rating'; countdown = Math.max(1, Math.ceil(h.end - now)); }
      setView((v) => (v.phase === phase && v.countdown === countdown && v.key === h.key ? v : { phase, countdown, key: h.key }));
    }
    // pré-monta a próxima faixa (no "Eu avalio": o próximo card, enquanto este toca)
    if (!nextTrack.current && !switching.current) {
      const remaining = tr.duration - now;
      if (after === 'wait' || remaining < 90) {
        const exclude = new Set(tr.items.map((i) => i.card.id));
        nextTrack.current = buildTrack(exclude, false);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(tick, 250);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [running, tick]);

  // ---------- ações
  function start() {
    // cria e "libera" o player dentro do toque (regra de autoplay dos celulares)
    if (!el.current) {
      const a = new Audio();
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.onended = () => {
        if (prefsRef.current.after === 'wait') { tick(); return; }
        for (const it of track.current?.items ?? []) finalize(it, prefsRef.current.after === 'auto' ? (3 as Grade) : null);
        playNext();
      };
      el.current = a;
    }
    el.current.src = URL.createObjectURL(quietWav(1));
    el.current.play().catch(() => {});
    setPaused(false);
    setRunning(true);
    setPreparing('Preparando o áudio…');
    playNext();
  }

  function pause() {
    el.current?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setPaused(true);
  }

  function resume() {
    el.current?.play().catch(() => {});
    setPaused(false);
  }

  /** Avaliar o card atual (no meio dele ou na pausa). */
  function doRate(grade: Grade) {
    const h = head();
    const a = el.current;
    if (!h || !a) return;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    finalize(h, grade);
    if (prefsRef.current.after === 'wait' || !head()) { a.pause(); playNext(); }
    else { a.currentTime = h.end; tick(); }
  }

  function skip() {
    const h = head();
    const a = el.current;
    if (!h || !a) return;
    finalize(h, null);
    if (!head()) { a.pause(); playNext(); } else { a.currentTime = h.end; tick(); }
  }

  function replay() {
    const h = head();
    if (!h || !el.current) return;
    h.spoken = { q: false, a: false };
    el.current.currentTime = h.qStart;
    el.current.play().catch(() => {});
    tick();
  }

  function answerNow() {
    const h = head();
    if (!h || !el.current) return;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    h.spoken.q = true;
    if (el.current.currentTime < h.aStart) el.current.currentTime = h.aStart - 0.05;
    tick();
  }

  // controles na tela de bloqueio / fone
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const h = head();
    const q = h ? cardFaces(h.note, h.card.ord).questionText : '';
    ms.metadata = new MediaMetadata({
      title: running ? `Card ${stats.done + 1} · ${paused ? 'Pausado' : PHASE_LABEL[view.phase].replace('…', '')}` : 'Revisão por áudio',
      artist: deckPath(deckId, decks),
      album: q ? (q.length > 70 ? q.slice(0, 70) + '…' : q) : 'Cosmos Hub',
      artwork: [{ src: `${import.meta.env.BASE_URL}icon-512.png`, sizes: '512x512', type: 'image/png' }],
    });
    try { ms.playbackState = running && !paused ? 'playing' : 'paused'; } catch { /* ignore */ }
    const set = (a: MediaSessionAction, fn: (() => void) | null) => { try { ms.setActionHandler(a, fn); } catch { /* sem suporte */ } };
    if (prefs.after === 'listen') { set('nexttrack', skip); set('previoustrack', replay); }
    else { set('nexttrack', () => doRate(3 as Grade)); set('previoustrack', () => doRate(1 as Grade)); }
    set('play', () => (running ? resume() : start()));
    set('pause', pause);
    return () => { (['nexttrack', 'previoustrack', 'play', 'pause'] as MediaSessionAction[]).forEach((a) => set(a, null)); };
  });

  useEffect(() => () => {
    el.current?.pause();
    if (track.current) URL.revokeObjectURL(track.current.url);
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, []);

  // fila acabou: para o áudio
  const finished = queue !== null && !current;
  useEffect(() => { if (finished) el.current?.pause(); }, [finished]);

  const title = deckPath(deckId, decks);
  if (queue === null) return <div className="center-pad"><div className="spinner" /></div>;
  if (!current || !note) return <Finished title={title} stats={stats} deckId={deckId} free={!!free} />;

  const h = head();
  const shownCard = h?.card ?? current;
  const shownNote = h?.note ?? note;
  const faces = cardFaces(shownNote, shownCard.ord);
  const now = new Date();
  const intervals = free ? null : previewIntervals(shownCard, now);
  const phase = view.phase;
  const missingAudio = queue.filter((c) => {
    const n = notes.get(c.note_id);
    if (!n) return false;
    const f = cardFaces(n, c.ord);
    return !f.questionAudio || !f.answerAudio;
  }).length;

  return (
    <div className="study audio-mode">
      <header className="study-head">
        <Link to="/decks" className="icon-btn" title="Sair">←</Link>
        <div className="grow">
          <div className="study-title">🎧 {free && <span className="free-badge">🔁 Livre</span>}{title}</div>
          <div className="small muted">{queue.length} na fila · {stats.done} revisados</div>
        </div>
      </header>

      <div className="audio-stage">
        {!running ? (
          <div className="audio-setup panel">
            <h2>{free ? 'Estudo livre por áudio' : 'Revisão por áudio'}</h2>
            {free && <p className="muted small">Fora do agendamento: as datas de revisão dos cards não mudam.</p>}
            <p className="muted">Ouça a pergunta, pense, e a resposta toca sozinha. Cards sem áudio gravado são lidos pela voz do navegador (se ativado).</p>
            <label>Tempo para pensar: <strong>{think}s</strong>
              <input type="range" min={3} max={60} value={think} onChange={(e) => setThink(Number(e.target.value))} />
            </label>
            <label className="check"><input type="checkbox" checked={prefs.tts} onChange={(e) => setPrefs({ ...prefs, tts: e.target.checked })} /> Ler o texto em voz alta quando o card não tiver áudio</label>
            <div className="mode-pick" role="radiogroup" aria-label="Depois da resposta">
              {modes.map((m) => (
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
            <p className="muted small">Fone ou tela de bloqueio: ⏯ pausa · ⏭ = {free ? 'Acertei' : 'Bom'} · ⏮ = Errei (no modo Só ouvir: ⏭ pula e ⏮ repete).</p>
            <p className="muted small">🔒 Pode bloquear a tela: os cards viram uma faixa de áudio contínua, que toca como música.{prefs.after === 'wait' ? ' No "Eu avalio", depois de cada resposta avalie pelos botões da tela de bloqueio ou do fone.' : ''}</p>
            {missingAudio > 0 && prefs.tts && (
              <p className="notice small">{missingAudio} de {queue.length} cards não têm áudio gravado e serão lidos pela voz do celular. Essa voz só funciona com o app aberto na tela: com a tela bloqueada, esses trechos ficam em silêncio. Para estudar caminhando, grave os áudios dos cards.</p>
            )}
            <button className="btn primary big" onClick={start}>▶ Começar</button>
          </div>
        ) : (
          <>
            <div className={`audio-orb ${paused || preparing ? 'rating' : phase}`}>
              <span className="orb-label">{preparing ? 'Preparando…' : paused ? 'Pausado' : phase === 'rating' && prefs.after !== 'wait' ? 'Próximo card em' : PHASE_LABEL[phase]}</span>
              {!paused && !preparing && (phase === 'thinking' || (phase === 'rating' && prefs.after !== 'wait')) && <span className="orb-count">{view.countdown}</span>}
            </div>
            {preparing && <p className="muted small">{preparing}</p>}
            <button className="btn small link" onClick={() => setShowText(!showText)}>{showText ? 'Esconder texto' : 'Mostrar texto'}</button>
            {showText && (
              <div className="flashcard small-card">
                <div className="card-face" dangerouslySetInnerHTML={{ __html: faces.questionHtml }} />
                {(phase === 'answer' || phase === 'rating') && <><hr className="answer-sep" /><div className="card-face" dangerouslySetInnerHTML={{ __html: faces.answerHtml }} /></>}
              </div>
            )}
            <div className="row center gap-s wrap">
              {paused
                ? <button className="btn primary" onClick={resume}>▶ Continuar</button>
                : <button className="btn ghost" onClick={pause}>❚❚ Pausar</button>}
              <button className="btn ghost" onClick={replay} disabled={paused || !!preparing}>↺ Repetir card</button>
              {(phase === 'question' || phase === 'thinking') && !paused && !preparing && <button className="btn ghost" onClick={answerNow}>⏩ Resposta já</button>}
              {prefs.after === 'listen' && !paused && <button className="btn ghost" onClick={skip}>⏭ Pular</button>}
            </div>
          </>
        )}
      </div>

      {running && prefs.after !== 'listen' && (
        <footer className="study-actions">
          <div className={`ratings big-touch${free ? ' two' : ''}`}>
            {buttons.map((r) => (
              <button key={r.grade} className={`rate ${r.cls}`} onClick={() => doRate(r.grade as Grade)} disabled={paused || !!preparing}>
                <span className="rate-int">{intervals ? fmtInterval(now, intervals[r.grade]) : ''}</span>
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
