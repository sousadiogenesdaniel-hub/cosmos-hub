import { describe, expect, it } from 'vitest';
import { filterHighlights, highlightsMarkdown, readFilter, safeFilename } from '../src/lib/highlightFilter';
import { mergeRects } from '../src/lib/highlights';
import { addDays, localDay } from '../src/lib/dates';
import type { DocumentRow, Highlight } from '../src/lib/types';

const today = localDay();
const at = (day: string) => new Date(`${day}T12:00:00`).toISOString();
const hl = (o: Partial<Highlight>): Highlight => ({ id: Math.random().toString(36), document_id: 'a', page: 1, text: 't', color: 'yellow', comment: null, position: {}, created_at: at(today), updated_at: '', ...o });
const docs = [{ id: 'a', title: 'Óptica' }, { id: 'b', title: 'Mecânica' }] as DocumentRow[];
const titleOf = (id: string) => docs.find((d) => d.id === id)!.title;

describe('filtro de grifos', () => {
  const all = [
    hl({ document_id: 'a', page: 9, text: 'lente', color: 'blue' }),
    hl({ document_id: 'a', page: 2, text: 'luz', comment: 'refração' }),
    hl({ document_id: 'b', page: 5, text: 'força', created_at: at(addDays(today, -10)) }),
  ];
  it('ordena por arquivo (título) e página', () => {
    expect(filterHighlights(all, readFilter(new URLSearchParams()), titleOf).map((h) => h.text)).toEqual(['força', 'luz', 'lente']);
  });
  it('filtra por período, cor, arquivo e busca no comentário', () => {
    expect(filterHighlights(all, readFilter(new URLSearchParams('period=7')), titleOf)).toHaveLength(2);
    expect(filterHighlights(all, readFilter(new URLSearchParams('period=30')), titleOf)).toHaveLength(3);
    expect(filterHighlights(all, readFilter(new URLSearchParams('color=blue')), titleOf).map((h) => h.text)).toEqual(['lente']);
    expect(filterHighlights(all, readFilter(new URLSearchParams('doc=b')), titleOf)).toHaveLength(1);
    expect(filterHighlights(all, readFilter(new URLSearchParams('q=refra')), titleOf).map((h) => h.text)).toEqual(['luz']);
    expect(readFilter(new URLSearchParams('color=roxo&period=x')).color).toBe('');
  });
  it('gera o resumo em texto', () => {
    const md = highlightsMarkdown(filterHighlights(all, readFilter(new URLSearchParams('doc=a')), titleOf), readFilter(new URLSearchParams('doc=a')), docs);
    expect(md).toContain('# Grifos — Óptica');
    expect(md).toContain('**p. 2** · Amarelo\n\n> luz\n\n💬 refração');
    expect(md.indexOf('p. 2')).toBeLessThan(md.indexOf('p. 9'));
    expect(safeFilename('Física: Óptica & Ondas')).toBe('Fisica-Optica-Ondas');
  });
  it('junta retângulos da mesma linha', () => {
    const r = mergeRects([{ p: 1, x: 0.1, y: 0.2, w: 0.1, h: 0.02 }, { p: 1, x: 0.205, y: 0.2, w: 0.1, h: 0.02 }, { p: 1, x: 0.1, y: 0.25, w: 0.2, h: 0.02 }]);
    expect(r).toHaveLength(2);
    expect(r[0].w).toBeCloseTo(0.205);
  });
});
