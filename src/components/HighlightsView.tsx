import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HIGHLIGHT_COLORS, type DocumentRow, type Highlight, type HighlightColor } from '../lib/types';
import { deleteHighlight, listHighlights, updateHighlight } from '../lib/api';
import { useAction } from '../lib/context';
import { ColorDots, CommentBox } from './HighlightPopover';
import Modal from './Modal';
import CardEditor from './CardEditor';

export default function HighlightsView({ docs }: { docs: DocumentRow[] }) {
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState<Highlight[] | null>(null);
  const [color, setColor] = useState<HighlightColor | ''>('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [cardFrom, setCardFrom] = useState<Highlight | null>(null);
  const run = useAction();
  const docId = params.get('doc') ?? '';
  // objeto estável: o editor reinicia os campos quando o prefill muda
  const prefill = useMemo(() => cardFrom ? { front: cardFrom.text, sourceDocumentId: cardFrom.document_id, sourcePage: cardFrom.page } : undefined, [cardFrom]);

  useEffect(() => { run(() => listHighlights()).then((h) => h && setAll(h)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of all ?? []) m.set(h.document_id, (m.get(h.document_id) ?? 0) + 1);
    return m;
  }, [all]);
  const withHl = docs.filter((d) => counts.has(d.id));

  const title = (id: string) => docs.find((d) => d.id === id)?.title ?? 'Arquivo';
  const list = (all ?? []).filter((h) => (!docId || h.document_id === docId) && (!color || h.color === color)
    && (!q || `${h.text} ${h.comment ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.document_id === b.document_id
      ? a.page - b.page || a.created_at.localeCompare(b.created_at)
      : title(a.document_id).localeCompare(title(b.document_id), 'pt-BR')));

  const pick = (id: string) => { const p = new URLSearchParams(params); if (id) p.set('doc', id); else p.delete('doc'); setParams(p, { replace: true }); };
  const replace = (h: Highlight) => setAll((l) => (l ?? []).map((x) => (x.id === h.id ? h : x)));

  async function remove(h: Highlight) {
    if (!window.confirm('Apagar este grifo?')) return;
    const ok = await run(() => deleteHighlight(h.id).then(() => true), 'Grifo apagado');
    if (ok) setAll((l) => (l ?? []).filter((x) => x.id !== h.id));
  }

  if (all === null) return <div className="center-pad"><div className="spinner" /></div>;
  if (all.length === 0) return (
    <div className="empty">
      <p>Nenhum grifo ainda.</p>
      <p className="muted">No leitor, selecione um trecho e toque numa das bolinhas coloridas para grifar. Seus grifos aparecem aqui, organizados por arquivo.</p>
    </div>
  );

  return (
    <div className="hl-view">
      <div className="filters">
        <select value={docId} onChange={(e) => pick(e.target.value)}>
          <option value="">Todos os arquivos ({all.length})</option>
          {withHl.map((d) => <option key={d.id} value={d.id}>{d.title} ({counts.get(d.id)})</option>)}
        </select>
        <input type="search" placeholder="Buscar nos grifos e comentários…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          <button className={`chip${color === '' ? ' on' : ''}`} onClick={() => setColor('')}>Todas as cores</button>
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.value} className={`chip${color === c.value ? ' on' : ''}`} onClick={() => setColor(color === c.value ? '' : c.value)}>
              <span className={`dot-mini dot-${c.value}`} /> {c.label}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? <p className="muted">Nada encontrado com esses filtros.</p> : (
        <ul className="hl-list">
          {list.map((h, i) => {
            const newDoc = !docId && (i === 0 || list[i - 1].document_id !== h.document_id);
            const isOpen = open === h.id;
            return (
              <li key={h.id} className="hl-li">
                {newDoc && <h3 className="group-title">{title(h.document_id)}</h3>}
                <div className={`hl-item hl-border-${h.color}${isOpen ? ' open' : ''}`}>
                  <button className="hl-main" onClick={() => setOpen(isOpen ? null : h.id)} aria-expanded={isOpen}>
                    <span className="hl-page">p. {h.page}</span>
                    <span className="hl-text">{h.text}</span>
                    {!isOpen && h.comment && <span className="hl-comment-preview">💬 {h.comment}</span>}
                  </button>
                  {isOpen && (
                    <div className="hl-detail">
                      <CommentBox hl={h} onSaved={replace} />
                      <div className="row between wrap gap-s">
                        <ColorDots value={h.color} title="Cor" onPick={async (c) => { const n = await run(() => updateHighlight(h.id, { color: c })); if (n) replace(n); }} />
                        <div className="row gap-s wrap">
                          <button className="btn small ghost danger" onClick={() => remove(h)}>Apagar</button>
                          <button className="btn small ghost" onClick={() => setCardFrom(h)}>⚡ Criar card</button>
                          <Link className="btn small" to={`/ler/${h.document_id}?page=${h.page}&hl=${h.id}`}>📖 Ver no arquivo</Link>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cardFrom && (
        <Modal title="Novo flashcard a partir do grifo" onClose={() => setCardFrom(null)} wide>
          <CardEditor prefill={prefill}
            sourceLabel={`${title(cardFrom.document_id)}, p. ${cardFrom.page}`} onClose={() => setCardFrom(null)} />
        </Modal>
      )}
    </div>
  );
}
