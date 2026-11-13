import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHighlightSelection } from '../lib/useHighlightSelection';
import { filterQuery } from '../lib/highlightFilter';
import { CommentBox } from '../components/HighlightPopover';

function shuffled<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

/** Releitura rápida dos grifos, um por vez (não altera nenhum agendamento). */
export default function HighlightReview() {
  const { filter, list, titleOf, setHls } = useHighlightSelection();
  const [shuffle, setShuffle] = useState(false);
  const [seed, setSeed] = useState(0);
  const [i, setI] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const back = `/biblioteca${filterQuery(filter) ? filterQuery(filter) + '&' : '?'}tab=grifos`;

  const ids = useMemo(() => {
    const base = (list ?? []).map((h) => h.id);
    return shuffle ? shuffled(base) : base;
  }, [list?.length, shuffle, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = ids.length;
  const h = list?.find((x) => x.id === ids[i]) ?? null;
  const done = list !== null && i >= total;

  const go = (d: number) => { stopVoice(); setI((v) => Math.max(0, Math.min(total, v + d))); };

  function stopVoice() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setSpeaking(false);
  }

  function speak() {
    if (!h || typeof speechSynthesis === 'undefined') return;
    if (speaking) { stopVoice(); return; }
    const u = new SpeechSynthesisUtterance(h.text + (h.comment ? `. Comentário: ${h.comment}` : ''));
    u.lang = 'pt-BR';
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    setSpeaking(true);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => stopVoice, []);

  if (list === null) return <div className="center-pad"><div className="spinner" /></div>;

  if (total === 0 || done) {
    return (
      <div className="center-screen">
        <div className="panel narrow center">
          <div className="big-emoji" aria-hidden>🖍</div>
          <h1>{total === 0 ? 'Nenhum grifo aqui' : 'Releitura concluída!'}</h1>
          <p className="muted">{total === 0 ? 'Nenhum grifo combina com esses filtros.' : `Você releu ${total} grifo${total === 1 ? '' : 's'}.`}</p>
          <div className="row center gap-s wrap">
            {total > 0 && <button className="btn" onClick={() => { setI(0); setSeed((s) => s + 1); }}>↺ De novo</button>}
            <Link className="btn primary" to={back}>Voltar aos grifos</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="study">
      <header className="study-head">
        <Link to={back} className="icon-btn" title="Sair">←</Link>
        <div className="grow">
          <div className="study-title">🖍 Revisar grifos</div>
          <div className="small muted">{i + 1} de {total}</div>
        </div>
        <label className="check small"><input type="checkbox" checked={shuffle} onChange={(e) => { setShuffle(e.target.checked); setI(0); }} /> Embaralhar</label>
      </header>
      <div className="progress thin"><div style={{ width: `${((i + 1) / total) * 100}%` }} /></div>

      {h && (
        <div className="card-stage">
          <article className={`flashcard hl-review hl-border-${h.color}`}>
            <div className="hl-review-src muted small">{titleOf(h.document_id)} · p. {h.page}</div>
            <blockquote className="hl-review-text">{h.text}</blockquote>
            <CommentBox key={h.id} hl={h} onSaved={(n) => setHls((l) => l.map((x) => (x.id === n.id ? n : x)))} />
            <div className="card-extras">
              <button className="btn small ghost" onClick={speak}>{speaking ? '■ Parar' : '🔊 Ouvir'}</button>
              <Link className="btn small ghost" to={`/ler/${h.document_id}?page=${h.page}&hl=${h.id}`}>📖 Ver no arquivo</Link>
            </div>
          </article>
        </div>
      )}

      <footer className="study-actions">
        <div className="row gap-s hl-nav">
          <button className="btn big ghost" onClick={() => go(-1)} disabled={i === 0}>← Anterior</button>
          <button className="btn big primary" onClick={() => go(1)}>{i === total - 1 ? 'Concluir ✓' : 'Próximo →'}</button>
        </div>
      </footer>
    </div>
  );
}
