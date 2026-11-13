import { Link } from 'react-router-dom';
import { useHighlightSelection } from '../lib/useHighlightSelection';
import { PERIODS, colorLabel, downloadText, exportTitle, filterQuery, highlightsMarkdown, safeFilename } from '../lib/highlightFilter';

/** Resumo dos grifos pronto para imprimir / salvar como PDF ou baixar em texto. */
export default function HighlightExport() {
  const { filter, list, docs, titleOf } = useHighlightSelection();
  const back = `/biblioteca${filterQuery(filter) ? filterQuery(filter) + '&' : '?'}tab=grifos`;
  if (list === null) return <div className="center-pad"><div className="spinner" /></div>;

  const title = exportTitle(filter, docs);
  const extras = [filter.color && `cor ${colorLabel(filter.color).toLowerCase()}`, PERIODS.find((p) => p.value && p.value === filter.period)?.label.toLowerCase(), filter.q && `busca "${filter.q}"`].filter(Boolean);
  const filename = `grifos-${safeFilename(title)}.md`;

  return (
    <div className="export-page">
      <div className="export-bar no-print">
        <Link to={back} className="btn ghost small">← Voltar</Link>
        <div className="row gap-s wrap">
          <button className="btn small" disabled={!list.length} onClick={() => downloadText(filename, highlightsMarkdown(list, filter, docs))}>⤓ Baixar texto (.md)</button>
          <button className="btn small primary" disabled={!list.length} onClick={() => window.print()}>🖨 Salvar como PDF</button>
        </div>
        <p className="muted small export-tip">No "Salvar como PDF", escolha <strong>Salvar como PDF</strong> como impressora/destino. O arquivo .md abre no Bloco de Notas, Word, Notion ou Obsidian.</p>
      </div>

      <article className="export-doc">
        <header>
          <h1>Grifos — {title}</h1>
          <p className="export-meta">Cosmos Hub · {new Date().toLocaleDateString('pt-BR')} · {list.length} grifo{list.length === 1 ? '' : 's'}{extras.length ? ` · ${extras.join(', ')}` : ''}</p>
        </header>
        {list.length === 0 && <p>Nenhum grifo com esses filtros.</p>}
        {list.map((h, i) => (
          <section key={h.id} className="export-item">
            {(i === 0 || list[i - 1].document_id !== h.document_id) && <h2>{titleOf(h.document_id)}</h2>}
            <div className={`export-quote ex-${h.color}`}>
              <span className="export-page-num">p. {h.page}</span>
              <p>{h.text}</p>
              {h.comment?.trim() && <p className="export-comment">💬 {h.comment}</p>}
            </div>
          </section>
        ))}
      </article>
    </div>
  );
}
