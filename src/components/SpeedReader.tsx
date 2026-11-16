import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HlRect } from '../lib/types';
import { reflowPage, type PDFDocumentProxy } from '../lib/pdf';
import type { RPage } from '../lib/reflow';
import { mergeRects } from '../lib/highlights';
import { etaMinutes, pageSequence, pivotIndex, sentenceBounds, wordDelay, wordsRects, wordsText, type Seq, type Stop, type Word } from '../lib/rsvp';
import { PageImage } from './ReflowViewer';

interface Props {
  pdf: PDFDocumentProxy;
  start: { page: number; block: number };
  onPage: (page: number) => void;
  onExit: (page: number) => void;
  onHighlight: (rects: HlRect[], text: string, page: number) => Promise<boolean>;
}

const PREF = 'cosmos:speedPrefs';
interface Prefs { wpm: number; stops: boolean }
function loadPrefs(): Prefs {
  try { return { wpm: 300, stops: true, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { wpm: 300, stops: true }; }
}

const STOP_TEXT: Record<Stop['reason'], { icon: string; text: string }> = {
  fig: { icon: '🖼', text: 'Tem uma figura ou tabela nesta parte da página.' },
  formula: { icon: '∑', text: 'Tem uma fórmula aqui.' },
  blank: { icon: '🖼', text: 'Esta página não tem texto para ler (figura ou página escaneada).' },
};

/** Leitura rápida: uma palavra por vez, num ponto fixo, no ritmo escolhido. */
export default function SpeedReader({ pdf, start, onPage, onExit, onHighlight }: Props) {
  const [page, setPage] = useState(start.page);
  const [data, setData] = useState<{ page: RPage; seq: Seq[] } | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [viewPage, setViewPage] = useState(false);
  const [finished, setFinished] = useState(false);
  const [marked, setMarked] = useState<string | null>(null);
  const firstLoad = useRef(true);
  const warm = useRef(true);
  const n = pdf.numPages;

  useEffect(() => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);

  // carrega a página atual (e já deixa a próxima preparada)
  useEffect(() => {
    let alive = true;
    setData(null);
    reflowPage(pdf, page).then((p) => {
      if (!alive) return;
      const seq = pageSequence(p);
      let at = 0;
      if (firstLoad.current && start.block > 0) {
        const i = seq.findIndex((s) => s.block >= start.block);
        if (i > 0) at = i;
      }
      firstLoad.current = false;
      setIdx(at);
      setData({ page: p, seq });
      if (page < n) reflowPage(pdf, page + 1).catch(() => {});
    }).catch(() => {});
    onPage(page);
    return () => { alive = false; };
  }, [pdf, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const seq = data?.seq ?? null;
  const cur = seq?.[idx] ?? null;

  const advance = useCallback(() => {
    if (!seq) return;
    if (idx + 1 < seq.length) setIdx(idx + 1);
    else if (page < n) setPage(page + 1);
    else { setPlaying(false); setFinished(true); }
  }, [seq, idx, page, n]);

  // o "motor": mostra cada palavra pelo tempo certo
  useEffect(() => {
    if (!playing || !cur || viewPage) return;
    if (cur.kind === 'stop') {
      if (prefs.stops || cur.reason === 'blank') { setPlaying(false); return; }
      advance();
      return;
    }
    const extra = warm.current ? 350 : 0;
    warm.current = false;
    const t = window.setTimeout(advance, wordDelay(cur, prefs.wpm) + extra);
    return () => window.clearTimeout(t);
  }, [playing, cur, viewPage, prefs.wpm, prefs.stops, advance]);

  // tela ligada e leitura contando enquanto roda
  useEffect(() => {
    if (!playing) return;
    let lock: { release: () => Promise<void> } | null = null;
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((l) => { lock = l; }).catch(() => {});
    const alive = window.setInterval(() => window.dispatchEvent(new Event('pointerdown')), 20000);
    return () => { lock?.release().catch(() => {}); window.clearInterval(alive); };
  }, [playing]);

  const play = () => { warm.current = true; setMarked(null); setFinished(false); setViewPage(false); setPlaying(true); };
  const toggle = () => (playing ? setPlaying(false) : cur?.kind === 'stop' ? resumeAfterStop() : play());
  function resumeAfterStop() { setViewPage(false); advance(); play(); }

  function jumpSentence(dir: -1 | 1) {
    if (!seq) return;
    const at = Math.min(idx, seq.length - 1);
    const [a, b] = sentenceBounds(seq, at);
    if (dir === -1) {
      // no meio da frase: volta ao início dela; no início: vai para a frase anterior
      if (at > a) setIdx(a);
      else if (a > 0) setIdx(sentenceBounds(seq, a - 1)[0]);
      else if (page > 1) setPage(page - 1);
    } else if (b + 1 < seq.length) setIdx(b + 1);
    else if (page < n) setPage(page + 1);
    warm.current = true;
  }

  const setWpm = (d: number) => setPrefs((p) => ({ ...p, wpm: Math.min(1000, Math.max(100, p.wpm + d)) }));

  async function markSentence() {
    if (!seq || !data) return;
    let at = idx;
    while (at > 0 && seq[at].kind !== 'word') at--;
    if (seq[at].kind !== 'word') return;
    const [a, b] = sentenceBounds(seq, at);
    const text = wordsText(seq, a, b);
    const ok = await onHighlight(mergeRects(wordsRects(data.page, seq, a, b)), text, page);
    if (ok) setMarked(`${a}-${b}`);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') jumpSentence(-1);
      else if (e.key === 'ArrowRight') jumpSentence(1);
      else if (e.key === 'ArrowUp') setWpm(25);
      else if (e.key === 'ArrowDown') setWpm(-25);
      else if (e.key === 'Escape') onExit(page);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // parágrafo atual (aparece quando pausado, para retomar o contexto)
  const context = useMemo(() => {
    if (!seq || !cur) return [];
    const block = cur.block;
    return seq.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === 'word' && s.block === block) as { s: Word; i: number }[];
  }, [seq, cur?.block]); // eslint-disable-line react-hooks/exhaustive-deps

  const wordsLeft = seq ? seq.slice(idx).filter((s) => s.kind === 'word').length : 0;
  const progress = seq && seq.length > 1 ? idx / (seq.length - 1) : 0;
  const word = cur?.kind === 'word' ? cur : null;
  const stop = cur?.kind === 'stop' ? cur : null;
  const pv = word ? pivotIndex(word.text) : 0;
  const shrink = word && word.text.length > 13 ? 13 / word.text.length : 1;

  return (
    <div className="speed" role="dialog" aria-label="Leitura rápida">
      <header className="speed-bar">
        <button className="btn small ghost" onClick={() => onExit(page)}>✕ Sair</button>
        <span className="muted small">p. {page} de {n}{seq && wordsLeft > 0 ? ` · ~${etaMinutes(wordsLeft, prefs.wpm)} min nesta página` : ''}</span>
        <div className="btn-group" role="group" aria-label="Velocidade">
          <button className="btn small ghost" onClick={() => setWpm(-25)} aria-label="Mais devagar">−</button>
          <span className="btn small ghost speed-wpm"><strong>{prefs.wpm}</strong> ppm</span>
          <button className="btn small ghost" onClick={() => setWpm(25)} aria-label="Mais rápido">+</button>
        </div>
      </header>
      <div className="progress thin"><div style={{ width: `${progress * 100}%` }} /></div>

      {viewPage ? (
        <div className="speed-pageview">
          <PageImage pdf={pdf} num={page} focusY={stop?.y} zoomable />
        </div>
      ) : (
        <div role="button" tabIndex={0} className="speed-stage" onClick={toggle} aria-label={playing ? 'Pausar' : 'Ler'}>
          {!data ? <div className="spinner" /> : finished ? (
            <div className="speed-stop"><span className="speed-stop-icon">✦</span><p>Fim do arquivo!</p></div>
          ) : stop ? (
            <div className="speed-stop">
              <span className="speed-stop-icon">{STOP_TEXT[stop.reason].icon}</span>
              <p>{STOP_TEXT[stop.reason].text}</p>
            </div>
          ) : word ? (
            <div className={`speed-word${word.heading ? ' heading' : ''}`} style={{ fontSize: `${shrink}em` }}>
              <span className="sw-left">{word.text.slice(0, pv)}</span>
              <span className="sw-pivot">{word.text[pv]}</span>
              <span className="sw-right">{word.text.slice(pv + 1)}</span>
            </div>
          ) : null}
          {!playing && word && !finished && <span className="speed-hint">Toque para ler</span>}
        </div>
      )}

      <div className="speed-panel">
        {stop && !playing && !finished && (
          <div className="row center gap-s wrap">
            <button className="btn" onClick={() => setViewPage(!viewPage)}>{viewPage ? 'Fechar página' : '🖼 Ver página'}</button>
          </div>
        )}
        {!playing && !stop && !finished && context.length > 0 && (
          <p className="speed-context">
            {context.map(({ s, i }) => (
              <span key={i} className={i === idx ? 'now' : marked && i >= Number(marked.split('-')[0]) && i <= Number(marked.split('-')[1]) ? 'marked' : ''} onClick={() => { setIdx(i); warm.current = true; }}>{s.text} </span>
            ))}
          </p>
        )}
        <div className="speed-controls">
          <button className="btn ghost" onClick={() => jumpSentence(-1)} title="Voltar uma frase (←)">⏮ <span className="hide-sm">Frase</span></button>
          <button className="btn primary speed-play" onClick={toggle}>{playing ? '❚❚ Pausar' : stop && !finished ? 'Continuar ▶' : '▶ Ler'}</button>
          <button className="btn ghost" onClick={() => jumpSentence(1)} title="Avançar uma frase (→)"><span className="hide-sm">Frase</span> ⏭</button>
        </div>
        {!playing && (
          <div className="row center gap-s wrap speed-extra">
            {word && <button className="btn small ghost" onClick={markSentence}>🖍 Grifar esta frase</button>}
            {!stop && <button className="btn small ghost" onClick={() => setViewPage(!viewPage)}>{viewPage ? 'Fechar página' : '🖼 Ver página'}</button>}
            <label className="check small"><input type="checkbox" checked={prefs.stops} onChange={(e) => setPrefs({ ...prefs, stops: e.target.checked })} /> Parar em figuras e fórmulas</label>
          </div>
        )}
      </div>
    </div>
  );
}
