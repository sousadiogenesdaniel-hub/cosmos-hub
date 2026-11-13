import { HIGHLIGHT_COLORS, type DocumentRow, type Highlight, type HighlightColor } from './types';
import { addDays, localDay } from './dates';

export type Period = '' | 'today' | '7' | '30';

export const PERIODS: { value: Period; label: string }[] = [
  { value: '', label: 'Qualquer data' },
  { value: 'today', label: 'Grifados hoje' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
];

export interface HlFilter { doc: string; color: HighlightColor | ''; period: Period; q: string }

/** Os filtros vivem na URL, assim a revisão e a exportação recebem a mesma seleção. */
export function readFilter(params: URLSearchParams): HlFilter {
  const color = params.get('color') ?? '';
  const period = params.get('period') ?? '';
  return {
    doc: params.get('doc') ?? '',
    color: HIGHLIGHT_COLORS.some((c) => c.value === color) ? (color as HighlightColor) : '',
    period: (['today', '7', '30'].includes(period) ? period : '') as Period,
    q: params.get('q') ?? '',
  };
}

export function filterQuery(f: HlFilter): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function periodStart(period: Period, today = localDay()): string | null {
  if (period === 'today') return today;
  if (period === '7') return addDays(today, -6);
  if (period === '30') return addDays(today, -29);
  return null;
}

/** Filtra e ordena: por título do arquivo, depois página e ordem em que foi grifado. */
export function filterHighlights(all: Highlight[], f: HlFilter, titleOf: (docId: string) => string): Highlight[] {
  const since = periodStart(f.period);
  const q = f.q.toLowerCase();
  return all
    .filter((h) => (!f.doc || h.document_id === f.doc)
      && (!f.color || h.color === f.color)
      && (!since || localDay(new Date(h.created_at)) >= since)
      && (!q || `${h.text} ${h.comment ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => (a.document_id === b.document_id
      ? a.page - b.page || a.created_at.localeCompare(b.created_at)
      : titleOf(a.document_id).localeCompare(titleOf(b.document_id), 'pt-BR')));
}

export const colorLabel = (c: HighlightColor) => HIGHLIGHT_COLORS.find((x) => x.value === c)?.label ?? c;

export function exportTitle(f: HlFilter, docs: DocumentRow[]): string {
  return f.doc ? docs.find((d) => d.id === f.doc)?.title ?? 'Arquivo' : 'Todos os arquivos';
}

/** Resumo em Markdown (abre em qualquer editor de texto, Word, Notion, Obsidian…). */
export function highlightsMarkdown(list: Highlight[], f: HlFilter, docs: DocumentRow[]): string {
  const titleOf = (id: string) => docs.find((d) => d.id === id)?.title ?? 'Arquivo';
  const extras = [f.color && `cor ${colorLabel(f.color).toLowerCase()}`, PERIODS.find((p) => p.value === f.period && p.value)?.label.toLowerCase(), f.q && `busca "${f.q}"`].filter(Boolean);
  const out = [
    `# Grifos — ${exportTitle(f, docs)}`,
    '',
    `_Exportado do Cosmos Hub em ${new Date().toLocaleDateString('pt-BR')} · ${list.length} grifo${list.length === 1 ? '' : 's'}${extras.length ? ` · ${extras.join(', ')}` : ''}_`,
  ];
  let lastDoc = '';
  for (const h of list) {
    if (h.document_id !== lastDoc) {
      lastDoc = h.document_id;
      out.push('', `## ${titleOf(h.document_id)}`);
    }
    out.push('', `**p. ${h.page}** · ${colorLabel(h.color)}`, '', ...h.text.split('\n').map((l) => `> ${l}`));
    if (h.comment?.trim()) out.push('', `💬 ${h.comment.trim().replace(/\n/g, '\n   ')}`);
  }
  return out.join('\n') + '\n';
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'grifos';
}
