/**
 * Modo leitura: transforma o texto posicionado de uma página de PDF em parágrafos
 * corridos (como num leitor de e-book), guardando onde cada pedaço está na página
 * para que os grifos valham nos dois modos (original e leitura).
 *
 * Coordenadas: tudo normalizado de 0 a 1 em relação à página (como os grifos).
 */
import type { HlRect } from './types';

export interface RItem { str: string; x: number; y: number; w: number; h: number }
export interface RPart { i: number; text: string; sep: string } // sep = texto antes da parte (espaço ou nada)
/**
 * p = parágrafo · h = título · f = fórmula isolada · fig = buraco no texto onde há
 * uma figura/tabela/fórmula em imagem (sem partes; `y` = posição na página, 0–1).
 */
export interface RBlock { kind: 'p' | 'h' | 'f' | 'fig'; parts: RPart[]; y?: number; caption?: boolean }
export interface RPage { num: number; items: RItem[]; blocks: RBlock[]; chars: number }

/** Item cru como o pdf.js entrega, já convertido para coordenadas normalizadas. */
export interface RawItem { str: string; x: number; y: number; w: number; h: number; eol: boolean }

interface Line { items: number[]; x0: number; x1: number; top: number; bottom: number; h: number; text: string }

/** Legenda de figura/tabela: indica que há algo para VER na página. */
export const CAPTION = /^(figuras?|fig\.|tabelas?|tab\.|gr[áa]ficos?|quadros?|ilustra[çc][ãa]o|diagrama|figures?|tables?|charts?)\s*\d/i;

const BAND = 0.075; // faixa de cabeçalho/rodapé (7,5% do topo e da base)

export function buildPage(num: number, raw: RawItem[]): RPage {
  const items: RItem[] = raw.map(({ str, x, y, w, h }) => ({ str, x, y, w, h }));

  // 1) linhas: o pdf.js entrega os itens em ordem de leitura; quebra quando muda a altura (y)
  const lines: Line[] = [];
  let cur: Line | null = null;
  raw.forEach((it, i) => {
    if (!it.str.trim()) {
      if (it.eol && cur) cur = null;
      return;
    }
    const mid = it.y + it.h / 2;
    const sameLine = cur && Math.abs(mid - (cur.top + cur.bottom) / 2) < Math.max(it.h, cur.h) * 0.55 && it.x > cur.x0 - 0.01;
    if (!sameLine) {
      cur = { items: [], x0: it.x, x1: it.x + it.w, top: it.y, bottom: it.y + it.h, h: it.h, text: '' };
      lines.push(cur);
    }
    const l = cur!;
    l.items.push(i);
    l.x0 = Math.min(l.x0, it.x);
    l.x1 = Math.max(l.x1, it.x + it.w);
    l.top = Math.min(l.top, it.y);
    l.bottom = Math.max(l.bottom, it.y + it.h);
    l.h = Math.max(l.h, it.h);
    l.text += it.str;
    if (it.eol) cur = null;
  });

  // 2) tira cabeçalho, rodapé e número de página
  const body = lines.filter((l) => {
    const t = l.text.trim();
    const inBand = l.bottom < BAND || l.top > 1 - BAND;
    if (inBand && t.length < 90) return false;
    if (/^\d{1,4}$/.test(t) && (l.top < 0.15 || l.bottom > 0.85)) return false;
    return true;
  });
  if (!body.length) return { num, items, blocks: [], chars: 0 };

  const heights = body.map((l) => l.h).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)];
  const left = percentile(body.map((l) => l.x0), 0.1);
  const right = percentile(body.map((l) => l.x1), 0.9);
  const width = Math.max(0.01, right - left);

  // 3) parágrafos e títulos
  const blocks: RBlock[] = [];
  let block: RBlock | null = null;
  body.forEach((l, li) => {
    const prev = li > 0 ? body[li - 1] : null;
    const t = l.text.trim();
    const big = l.h > medH * 1.18;
    const short = l.x1 - l.x0 < width * 0.7;
    const next = body[li + 1];
    const gapAbove = prev ? l.top - prev.bottom : 1;
    const gapBelow = next ? next.top - l.bottom : 1;
    const mathy = /[=±×÷√∑∫∂≤≥≈∞]/.test(t);
    // fórmula isolada: linha curta com símbolos matemáticos
    const isFormula = mathy && short && t.length < 80;
    // buraco vertical grande = figura, tabela ou fórmula em imagem naquele ponto
    const figGap = Math.max(0.07, medH * 4.5);
    if (prev ? gapAbove > figGap : l.top > 0.3) {
      blocks.push({ kind: 'fig', parts: [], y: prev ? prev.bottom + gapAbove / 2 : l.top / 2 });
      block = null;
    }
    const isHeading = !mathy && !CAPTION.test(t) && ((big && t.length < 120) || (short && t.length < 80 && !/[.,;:?!)]$/.test(t)
      && gapAbove > medH * 0.25 && (!next || gapBelow > medH * 0.25 || next.x0 > left + width * 0.03) && /^[\p{Lu}\d]/u.test(t) && !/^[■•▪●◦\-–]/.test(t)));

    let newBlock = !block || isHeading || isFormula || block.kind !== 'p';
    if (!newBlock && prev) {
      const prevText = prev.text.trim();
      const prevEndsShort = prev.x1 < right - width * 0.06;
      const indented = l.x0 > left + width * 0.025;
      const bullet = /^[■•▪●◦\-–]\s?/.test(t) || /^\(?[a-z0-9]{1,2}[).]\s/.test(t);
      if (gapAbove > medH * 0.9) newBlock = true;
      else if (bullet) newBlock = true;
      else if (prevEndsShort && /[.:;?!)]$/.test(prevText)) newBlock = true;
      else if (indented && /[.:;?!]$/.test(prevText)) newBlock = true;
    }
    if (newBlock) {
      block = { kind: isFormula ? 'f' : isHeading ? 'h' : 'p', parts: [], y: l.top };
      if (!isFormula && CAPTION.test(t)) block.caption = true;
      blocks.push(block);
    }

    l.items.forEach((idx, k) => {
      const it = items[idx];
      let text = it.str;
      let sep = '';
      if (k === 0 && block!.parts.length) {
        // emenda com a linha anterior do mesmo parágrafo
        const lastPart = block!.parts[block!.parts.length - 1];
        if (/[\p{L}]-$/u.test(lastPart.text) && /^[\p{Ll}]/u.test(text.trimStart())) {
          lastPart.text = lastPart.text.slice(0, -1); // remove o hífen de fim de linha
        } else if (!/\s$/.test(lastPart.text)) sep = ' ';
      } else if (k > 0) {
        const p = items[l.items[k - 1]];
        const gap = it.x - (p.x + p.w);
        if (gap > Math.min(it.h, p.h) * 0.12 && !/\s$/.test(p.str) && !/^\s/.test(text)) sep = ' ';
      }
      if (k === 0) text = text.replace(/^\s+/, '');
      block!.parts.push({ i: idx, text, sep });
    });
  });

  const chars = blocks.reduce((s, b) => s + b.parts.reduce((t, p) => t + p.text.length, 0), 0);
  return { num, items, blocks, chars };
}

function percentile(v: number[], q: number): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** Retângulo (na página) dos caracteres [a, b) de um item: proporcional ao número de letras. */
export function itemRect(page: number, it: RItem, a: number, b: number, len: number): HlRect {
  const n = Math.max(1, len);
  return { p: page, x: it.x + (it.w * a) / n, y: it.y, w: (it.w * (b - a)) / n, h: it.h };
}

/** Para cada caractere de uma parte, qual grifo o cobre (ou null). */
export function partCoverage(page: number, it: RItem, text: string, hls: { id: string; rects: HlRect[] }[]): (string | null)[] {
  const out: (string | null)[] = new Array(text.length).fill(null);
  if (!hls.length) return out;
  const cy = it.y + it.h / 2;
  const n = Math.max(1, text.length);
  for (const h of hls) {
    for (const r of h.rects) {
      if (r.p !== page || cy < r.y - it.h * 0.25 || cy > r.y + r.h + it.h * 0.25) continue;
      for (let j = 0; j < text.length; j++) {
        const cx = it.x + (it.w * (j + 0.5)) / n;
        if (cx >= r.x - 0.002 && cx <= r.x + r.w + 0.002) out[j] = h.id;
      }
    }
  }
  return out;
}

/** Caixa do texto nas páginas de amostra (para cortar margens no modo original). */
export function contentBox(pages: RPage[]): { x0: number; x1: number } | null {
  let x0 = 1, x1 = 0, n = 0;
  for (const p of pages) {
    for (const b of p.blocks) for (const part of b.parts) {
      const it = p.items[part.i];
      if (!part.text.trim()) continue;
      x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x + it.w); n++;
    }
  }
  if (n < 10 || x1 - x0 < 0.3) return null;
  const pad = 0.025;
  return { x0: Math.max(0, x0 - pad), x1: Math.min(1, x1 + pad) };
}
