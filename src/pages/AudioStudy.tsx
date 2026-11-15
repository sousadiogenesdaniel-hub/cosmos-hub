import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Grade } from 'ts-fsrs';
import type { CardRow, Note } from '../lib/types';
import { deckPath } from '../lib/api';
import { cardFaces } from '../lib/cards';
import { RATINGS, previewIntervals } from '../lib/srs';
import { fmtInterval } from '../lib/dates';
import { useApp } from '../lib/context';
import { useStudySession } from '../lib/useStudySession';
import { Finished } from './Study';
import { KeepAlive } from '../lib/backgroundAudio';
import { AudioTimeline, ttsSeconds } from '../lib/audioTimeline';

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

/** Quanto áudio deixar agendado à frente (toca mesmo se o app ficar parado). */
const LOOKAHEAD_S = 90;

/** Um card já agendado na linha do tempo do áudio. */
interface Item {
  key: string;
  card: CardRow;
  note: Note;
  qStart: number; qEnd: number; aStart: number; aEnd: number; end: number;
  sources: AudioBufferSourceNode[];
  tts: { q: string | null; a: string | null };
  spoken: { q: boolean; a: boolean };
  paths: (string | null)[];
}

const cardKey = (c: CardRow) => `${c.id}:${c.reps}:${c.due}`;

export default function AudioStudy() {
  const { deckId = '' } = useParams();
  const { decks, profile } = useApp();
  const { queue, notes, current, note, rate, dismiss, stats } = useStudySession(deckId, 'audio');
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState<{ phase: Phase; countdown: number; key: string | null }>({ phase: 'question', countdown: 0, key: null });
  const [think, setThink] = useState(profile?.audio_think_seconds ?? 15);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [showText, setShowText] = useState(false);

  const tl = useRef<AudioTimeline | null>(null);
  const keep = useRef<KeepAlive | null>(null);
  const plan = useRef<Item[]>([]);
  const building = useRef(false);
  const epoch = useRef(0);
  const finalized = useRef(new Set<string>());
  const skipQuestion = useRef(false);
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

  /** Monta e agenda um card a partir do instante `start`. */
  async function buildItem(card: CardRow, n: Note, start: number, skipQ: boolean): Promise<Item | null> {
    const t = tl.current!;
    const f = cardFaces(n, card.ord);
    const [qBuf, aBuf] = await Promise.all([
      !skipQ && f.questionAudio ? t.load(f.questionAudio) : Promise.resolve(null),
      f.answerAudio ? t.load(f.answerAudio) : Promise.resolve(null),
    ]);
    const tts = prefsRef.current.tts;
    const qTts = !skipQ && !qBuf && tts && f.questionText ? f.questionText : null;
    const aTts = !aBuf && tts && f.answerText ? f.answerText : null;
    const qDur = skipQ ? 0 : qBuf ? qBuf.duration : qTts ? ttsSeconds(qTts) : 1;
    const aDur = aBuf ? aBuf.duration : aTts ? ttsSeconds(aTts) : 1;
    const qStart = Math.max(start, t.now + 0.15);
    const qEnd = qStart + qDur;
    const aStart = qEnd + (skipQ ? 0.2 : thinkRef.current);
    const aEnd = aStart + aDur;
    const end = aEnd + (prefsRef.current.after === 'wait' ? 0 : Math.max(1, prefsRef.current.gap));
    const sources: AudioBufferSourceNode[] = [];
    if (qBuf) sources.push(t.schedule(qBuf, qStart));
    if (aBuf) sources.push(t.schedule(aBuf, aStart));
    return {
      key: cardKey(card), card, note: n, qStart, qEnd, aStart, aEnd, end, sources,
      tts: { q: qTts, a: aTts }, spoken: { q: false, a: false }, paths: [f.questionAudio, f.answerAudio],
    };
  }

  /** Mantém a fila de áudio agendada à frente. */
  async function extend() {
    const t = tl.current;
    if (!t || building.current || t.paused) return;
    building.current = true;
    const my = epoch.current;
    try {
      for (;;) {
        const items = plan.current;
        if (prefsRef.current.after === 'wait' && items.length >= 1) break;
        const lastEnd = items.length ? items[items.length - 1].end : t.now;
        if (items.length && lastEnd - t.now > LOOKAHEAD_S) break;
        const planned = new Set(items.map((i) => i.card.id));
        const next = (queueRef.current ?? []).find((c) => !planned.has(c.id) && !finalized.current.has(cardKey(c)));
        const n = next && notesRef.current.get(next.note_id);
        if (!next || !n) break;
        const skipQ = items.length === 0 && skipQuestion.current;
        skipQuestion.current = false;
        const item = await buildItem(next, n, lastEnd, skipQ);
        if (my !== epoch.current || !item) { if (item) t.cancel(item.sources); break; }
        plan.current = [...plan.current, item];
      }
    } finally {
      building.current = false;
    }
  }

  /** Recomeça o agendamento a partir do card atual (após avaliar, pular, repetir…). */
  function reset() {
    epoch.current++;
    tl.current?.cancel();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    plan.current = [];
  }

  function finalize(item: Item, grade: Grade | null) {
    finalized.current.add(item.key);
    tl.current?.forget(item.paths);
    const ms = Math.max(0, ((tl.current?.now ?? item.end) - item.qStart) * 1000);
    if (grade === null) dismiss();
    else rate(item.card, grade, Math.min(ms, (item.end - item.qStart) * 1000 + 60000));
  }

  /** O "relógio" da tela. Se o celular congelar o app, o áudio segue e isto só atualiza ao voltar. */
  const tick = useCallback(() => {
    const t = tl.current;
    if (!t) return;
    const now = t.now;
    const after = prefsRef.current.after;
    // cards que já terminaram de tocar: conta a revisão (ou pula, no Só ouvir)
    if (after !== 'wait') {
      while (plan.current[0] && now >= plan.current[0].end) {
        const item = plan.current[0];
        plan.current = plan.current.slice(1);
        finalize(item, after === 'auto' ? (3 as Grade) : null);
      }
    }
    // voz sintetizada para cards sem áudio gravado (só funciona com o app ativo)
    for (const it of plan.current) {
      if (it.tts.q && !it.spoken.q && now >= it.qStart - 0.05) { it.spoken.q = true; if (now < it.qEnd) speak(it.tts.q); }
      if (it.tts.a && !it.spoken.a && now >= it.aStart - 0.05) { it.spoken.a = true; if (now < it.aEnd) speak(it.tts.a); }
    }
    const head = plan.current[0];
    if (head) {
      let phase: Phase, countdown = 0;
      if (now < head.qEnd) phase = 'question';
      else if (now < head.aStart) { phase = 'thinking'; countdown = Math.ceil(head.aStart - now); }
      else if (now < head.aEnd) phase = 'answer';
      else { phase = 'rating'; countdown = Math.max(1, Math.ceil(head.end - now)); }
      setView((v) => (v.phase === phase && v.countdown === countdown && v.key === head.key ? v : { phase, countdown, key: head.key }));
    }
    extend();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(tick, 250);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    tick();
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [running, tick]);

  // ---------- ações
  function start() {
    if (!tl.current) tl.current = new AudioTimeline();
    else tl.current.resume();
    (keep.current ??= new KeepAlive()).start();
    setPaused(false);
    setRunning(true);
  }

  function pause() {
    tl.current?.pause();
    keep.current?.pause();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setPaused(true);
  }

  function resume() {
    tl.current?.resume();
    keep.current?.start();
    setPaused(false);
  }

  function doRate(grade: Grade) {
    const head = plan.current[0];
    if (!head) return;
    reset();
    finalize(head, grade);
    tick();
  }

  function skip() {
    const head = plan.current[0];
    if (!head) return;
    reset();
    finalize(head, null);
    tick();
  }

  function replay() { reset(); tick(); }
  function answerNow() { skipQuestion.current = true; reset(); tick(); }

  // controles na tela de bloqueio / fone
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const head = plan.current[0];
    const q = head ? cardFaces(head.note, head.card.ord).questionText : '';
    ms.metadata = new MediaMetadata({
      title: running ? `Card ${stats.done + 1} · ${paused ? 'Pausado' : PHASE_LABEL[view.phase].replace('…', '')}` : 'Revisão por áudio',
      artist: deckPath(deckId, decks),
      album: q ? (q.length > 70 ? q.slice(0, 70) + '…' : q) : 'Cosmos Hub',
      artwork: [{ src: `${import.meta.env.BASE_URL}icon-512.png`, sizes: '512x512', type: 'image/png' }],
    });
    try { ms.playbackState = running && !paused ? 'playing' : 'paused'; } catch { /* ignore */ }
    const set = (a: MediaSessionAction, h: (() => void) | null) => { try { ms.setActionHandler(a, h); } catch { /* sem suporte */ } };
    if (prefs.after === 'listen') { set('nexttrack', skip); set('previoustrack', replay); }
    else { set('nexttrack', () => doRate(3 as Grade)); set('previoustrack', () => doRate(1 as Grade)); }
    set('play', () => (running ? resume() : start()));
    set('pause', pause);
    return () => { (['nexttrack', 'previoustrack', 'play', 'pause'] as MediaSessionAction[]).forEach((a) => set(a, null)); };
  });

  useEffect(() => () => { reset(); tl.current?.close(); keep.current?.destroy(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // fila acabou: desliga o áudio
  const finished = queue !== null && !current;
  useEffect(() => { if (finished) { tl.current?.pause(); keep.current?.pause(); } }, [finished]);

  const title = deckPath(deckId, decks);
  if (queue === null) return <div className="center-pad"><div className="spinner" /></div>;
  if (!current || !note) return <Finished title={title} stats={stats} deckId={deckId} />;

  const head = plan.current[0];
  const shownCard = head?.card ?? current;
  const shownNote = head?.note ?? note;
  const faces = cardFaces(shownNote, shownCard.ord);
  const now = new Date();
  const intervals = previewIntervals(shownCard, now);
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
          <div className="study-title">🎧 {title}</div>
          <div className="small muted">{queue.length} na fila · {stats.done} revisados</div>
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
            <p className="muted small">Fone ou tela de bloqueio: ⏯ pausa · ⏭ = Bom · ⏮ = Errei (no modo Só ouvir: ⏭ pula e ⏮ repete).</p>
            <p className="muted small">🔒 Pode bloquear a tela: os áudios gravados ficam agendados e tocam na hora certa, como uma playlist.</p>
            {missingAudio > 0 && prefs.tts && (
              <p className="notice small">{missingAudio} de {queue.length} cards não têm áudio gravado e serão lidos pela voz do celular. Essa voz só funciona com o app aberto na tela: com a tela bloqueada, esses trechos ficam em silêncio. Para estudar caminhando, grave os áudios dos cards.</p>
            )}
            <button className="btn primary big" onClick={start}>▶ Começar</button>
          </div>
        ) : (
          <>
            <div className={`audio-orb ${paused ? 'rating' : phase}`}>
              <span className="orb-label">{paused ? 'Pausado' : phase === 'rating' && prefs.after !== 'wait' ? 'Próximo card em' : PHASE_LABEL[phase]}</span>
              {!paused && (phase === 'thinking' || (phase === 'rating' && prefs.after !== 'wait')) && <span className="orb-count">{view.countdown}</span>}
            </div>
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
              <button className="btn ghost" onClick={replay} disabled={paused}>↺ Repetir card</button>
              {(phase === 'question' || phase === 'thinking') && !paused && <button className="btn ghost" onClick={answerNow}>⏩ Resposta já</button>}
              {prefs.after === 'listen' && !paused && <button className="btn ghost" onClick={skip}>⏭ Pular</button>}
            </div>
          </>
        )}
      </div>

      {running && prefs.after !== 'listen' && (
        <footer className="study-actions">
          <div className="ratings big-touch">
            {RATINGS.map((r) => (
              <button key={r.grade} className={`rate ${r.cls}`} onClick={() => doRate(r.grade)} disabled={paused}>
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
