import type { Highlight, HlRect } from './types';

/**
 * PDF: converte a seleção em retângulos proporcionais (0–1) de cada página,
 * assim o grifo acompanha qualquer zoom.
 */
export function pdfRectsFromRange(range: Range, root: HTMLElement): HlRect[] {
  const pages = [...root.querySelectorAll<HTMLElement>('.pdf-page')].map((el) => ({ el, r: el.getBoundingClientRect(), p: Number(el.dataset.page) }));
  const out: HlRect[] = [];
  for (const cr of range.getClientRects()) {
    if (cr.width < 1 || cr.height < 1) continue;
    const cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    const page = pages.find(({ r }) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
    if (!page) continue;
    // ignora o "fim de conteúdo" do pdf.js, que ocupa a página inteira
    if (cr.height > page.r.height * 0.5) continue;
    out.push({
      p: page.p,
      x: (cr.left - page.r.left) / page.r.width,
      y: (cr.top - page.r.top) / page.r.height,
      w: cr.width / page.r.width,
      h: cr.height / page.r.height,
    });
  }
  return mergeRects(out);
}

/** Junta retângulos da mesma linha que se tocam (o pdf.js gera um por trecho de texto). */
export function mergeRects(rects: HlRect[]): HlRect[] {
  const sorted = [...rects].sort((a, b) => a.p - b.p || a.y - b.y || a.x - b.x);
  const out: HlRect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && last.p === r.p && Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5;
    if (sameLine && r.x <= last.x + last.w + 0.01) {
      const x = Math.min(last.x, r.x);
      const right = Math.max(last.x + last.w, r.x + r.w);
      const y = Math.min(last.y, r.y);
      const bottom = Math.max(last.y + last.h, r.y + r.h);
      Object.assign(last, { x, y, w: right - x, h: bottom - y });
    } else out.push({ ...r });
  }
  return out.map((r) => ({ p: r.p, x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }));
}

const round = (v: number) => Math.round(v * 10000) / 10000;

export function hitRect(rects: HlRect[] | undefined, page: number, x: number, y: number): boolean {
  return !!rects?.some((r) => r.p === page && x >= r.x && x <= r.x + r.w && y >= r.y - 0.003 && y <= r.y + r.h + 0.003);
}

// --------------------------------------------------------------- Word

interface TextIndex { nodes: Text[]; starts: number[]; length: number }

export function textIndex(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let pos = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(pos);
    pos += (n as Text).data.length;
  }
  return { nodes, starts, length: pos };
}

/** Posição (em caracteres) de um ponto: tamanho do texto entre o início do documento e o ponto. */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const pre = document.createRange();
  pre.setStart(root, 0);
  pre.setEnd(node, offset);
  return pre.toString().length;
}

export function docxPositionFromRange(range: Range, root: HTMLElement): { offset: number; length: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const a = offsetOf(root, range.startContainer, range.startOffset);
  const b = offsetOf(root, range.endContainer, range.endOffset);
  if (b <= a) return null;
  return { offset: a, length: b - a };
}

export function rangeFromPosition(idx: TextIndex, offset: number, length: number): Range | null {
  const end = offset + length;
  if (offset < 0 || end > idx.length) return null;
  const find = (pos: number, isEnd: boolean) => {
    for (let i = idx.nodes.length - 1; i >= 0; i--) {
      if (idx.starts[i] < pos || (!isEnd && idx.starts[i] === pos)) return { node: idx.nodes[i], off: pos - idx.starts[i] };
    }
    return null;
  };
  const s = find(offset, false), e = find(end, true);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.node, Math.min(s.off, s.node.data.length));
  r.setEnd(e.node, Math.min(e.off, e.node.data.length));
  return r;
}

/** Pinta os grifos do Word com a CSS Custom Highlight API (não altera o HTML). */
export function paintDocxHighlights(root: HTMLElement, hls: Highlight[], focusId?: string | null): Map<string, Range> {
  const ranges = new Map<string, Range>();
  const api = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  const idx = textIndex(root);
  const byColor = new Map<string, Range[]>();
  for (const h of hls) {
    if (h.position.offset == null || h.position.length == null) continue;
    const r = rangeFromPosition(idx, h.position.offset, h.position.length);
    if (!r) continue;
    ranges.set(h.id, r);
    const key = h.id === focusId ? 'hl-focus' : `hl-${h.color}`;
    byColor.set(key, [...(byColor.get(key) ?? []), r]);
  }
  if (api && HighlightCtor) {
    for (const k of ['hl-yellow', 'hl-green', 'hl-blue', 'hl-pink', 'hl-focus']) api.delete(k);
    for (const [k, rs] of byColor) api.set(k, new HighlightCtor(...rs));
  }
  return ranges;
}

export function clearDocxHighlights() {
  const api = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  if (api) for (const k of ['hl-yellow', 'hl-green', 'hl-blue', 'hl-pink', 'hl-focus']) api.delete(k);
}

export function rangeHit(r: Range, x: number, y: number): boolean {
  for (const cr of r.getClientRects()) if (x >= cr.left && x <= cr.right && y >= cr.top - 2 && y <= cr.bottom + 2) return true;
  return false;
}
