import { useEffect, useRef, useState } from 'react';
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../lib/types';
import { deleteHighlight, updateHighlight } from '../lib/api';
import { useAction } from '../lib/context';

export function ColorDots({ value, onPick, title = 'Grifar' }: { value?: HighlightColor; onPick: (c: HighlightColor) => void; title?: string }) {
  return (
    <span className="color-dots" role="group" aria-label={title}>
      {HIGHLIGHT_COLORS.map((c) => (
        <button key={c.value} type="button" className={`dot dot-${c.value}${value === c.value ? ' on' : ''}`}
          title={`${title} · ${c.label}`} aria-label={`${title} ${c.label}`} onClick={() => onPick(c.value)} />
      ))}
    </span>
  );
}

/** Comentário com salvamento automático ao sair do campo. */
export function CommentBox({ hl, onSaved, autoFocus }: { hl: Highlight; onSaved: (h: Highlight) => void; autoFocus?: boolean }) {
  const [text, setText] = useState(hl.comment ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const run = useAction();
  useEffect(() => { setText(hl.comment ?? ''); }, [hl.id, hl.comment]);

  async function save() {
    const v = text.trim() || null;
    if (v === (hl.comment ?? null)) return;
    setState('saving');
    const h = await run(() => updateHighlight(hl.id, { comment: v }));
    if (h) { onSaved(h); setState('saved'); setTimeout(() => setState('idle'), 1500); } else setState('idle');
  }

  return (
    <div className="comment-box">
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} autoFocus={autoFocus}
        placeholder="Comentário (opcional): sua explicação, dúvida, conexão com outro assunto…" />
      <span className="muted small">{state === 'saving' ? 'Salvando…' : state === 'saved' ? 'Salvo ✓' : 'Salva sozinho ao sair do campo'}</span>
    </div>
  );
}

interface Props {
  hl: Highlight;
  x: number;
  y: number;
  onChange: (h: Highlight) => void;
  onDeleted: (id: string) => void;
  onCard: (h: Highlight) => void;
  onClose: () => void;
}

export default function HighlightPopover({ hl, x, y, onChange, onDeleted, onCard, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const run = useAction();
  const [pos, setPos] = useState({ left: x, top: y + 12 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
    const top = y + 12 + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height - 12) : y + 12;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(t); window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  async function recolor(color: HighlightColor) {
    const h = await run(() => updateHighlight(hl.id, { color }));
    if (h) onChange(h);
  }

  async function remove() {
    const ok = await run(() => deleteHighlight(hl.id).then(() => true), 'Grifo apagado');
    if (ok) { onDeleted(hl.id); onClose(); }
  }

  return (
    <div ref={ref} className="hl-pop" style={pos} role="dialog" aria-label="Grifo">
      <div className="row between gap-s">
        <ColorDots value={hl.color} onPick={recolor} title="Cor" />
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
      </div>
      <CommentBox hl={hl} onSaved={onChange} />
      <div className="row between gap-s">
        <button className="btn small ghost danger" onClick={remove}>Apagar grifo</button>
        <button className="btn small primary" onClick={() => { onCard(hl); onClose(); }}>⚡ Criar card</button>
      </div>
    </div>
  );
}
