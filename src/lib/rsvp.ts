/**
 * Leitura rápida (uma palavra por vez, num ponto fixo da tela).
 * Transforma os parágrafos do modo leitura numa sequência de palavras e de "paradas"
 * (figura, fórmula, página sem texto), e calcula o ritmo de cada palavra.
 */
import type { HlRect } from './types';
import { itemRect, type RPage } from './reflow';

/** Pedaço de uma palavra dentro de um item do PDF (para grifar a frase lida). */
export interface WordSeg { i: number; a: number; b: number; len: number }

export interface Word { kind: 'word'; text: string; block: number; segs: WordSeg[]; endSentence: boolean; endPara: boolean; heading: boolean }
export interface Stop { kind: 'stop'; reason: 'fig' | 'formula' | 'blank'; block: number; y: number }
export type Seq = Word | Stop;

export const MIN_PAGE_CHARS = 120;

export function pageSequence(page: RPage): Seq[] {
  if (page.chars < MIN_PAGE_CHARS) return [{ kind: 'stop', reason: 'blank', block: 0, y: 0 }];
  const out: Seq[] = [];
  const stop = (reason: Stop['reason'], block: number, y: number) => {
    const last = out[out.length - 1];
    if (last?.kind === 'stop') { if (reason === 'formula') last.reason = last.reason === 'fig' ? 'fig' : 'formula'; return; } // não empilha paradas
    out.push({ kind: 'stop', reason, block, y });
  };
  page.blocks.forEach((b, bi) => {
    if (b.kind === 'fig') { stop('fig', bi, b.y ?? 0); return; }
    if (b.kind === 'f') { stop('formula', bi, b.y ?? 0); return; }
    if (b.caption) stop('fig', bi, b.y ?? 0);
    let cur: Word | null = null;
    const flush = () => { if (cur && cur.text) out.push(cur); cur = null; };
    for (const part of b.parts) {
      if (/\s/.test(part.sep)) flush();
      const len = part.text.length;
      for (let j = 0; j < len; j++) {
        const ch = part.text[j];
        if (/\s/.test(ch)) { flush(); continue; }
        if (!cur) cur = { kind: 'word', text: '', block: bi, segs: [], endSentence: false, endPara: false, heading: b.kind === 'h' };
        cur.text += ch;
        const seg = cur.segs[cur.segs.length - 1];
        if (seg && seg.i === part.i && seg.b === j) seg.b = j + 1;
        else cur.segs.push({ i: part.i, a: j, b: j + 1, len });
      }
    }
    flush();
    const last = out[out.length - 1];
    if (last?.kind === 'word' && last.block === bi) { last.endPara = true; last.endSentence = true; }
  });
  for (const w of out) if (w.kind === 'word' && /[.!?…]["'”’)\]]*$/.test(w.text)) w.endSentence = true;
  return out;
}

/** Letra em que o olho deve fixar (um pouco à esquerda do meio da palavra). */
export function pivotIndex(text: string): number {
  const core = text.replace(/[^\p{L}\p{N}]+$/u, '');
  const lead = text.length - text.replace(/^[^\p{L}\p{N}]+/u, '').length;
  const n = Math.max(1, core.length - lead);
  const k = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
  return Math.min(text.length - 1, lead + k);
}

/** Tempo na tela (ms): palavras longas, números e pontuação ganham um respiro. */
export function wordDelay(w: Word, wpm: number): number {
  const base = 60000 / Math.max(50, wpm);
  let f = 1;
  const n = w.text.length;
  if (n > 8) f += Math.min(0.6, (n - 8) * 0.05);
  if (/\d/.test(w.text)) f += 0.3;
  if (w.endPara) f += 1.6;
  else if (w.endSentence) f += 1.2;
  else if (/[,;:]["'”’)\]]*$/.test(w.text)) f += 0.6;
  if (w.heading) f += 0.3;
  return base * f;
}

/** Início e fim (índices) da frase que contém a posição `idx`. */
export function sentenceBounds(seq: Seq[], idx: number): [number, number] {
  let a = idx, b = idx;
  while (a > 0 && seq[a - 1].kind === 'word' && !(seq[a - 1] as Word).endSentence) a--;
  while (b < seq.length - 1 && seq[b].kind === 'word' && !(seq[b] as Word).endSentence) b++;
  if (seq[b]?.kind !== 'word') b = Math.max(a, b - 1);
  return [a, b];
}

/** Retângulos, na página original, das palavras [a..b] (para grifar a frase). */
export function wordsRects(page: RPage, seq: Seq[], a: number, b: number): HlRect[] {
  const out: HlRect[] = [];
  for (let k = a; k <= b; k++) {
    const w = seq[k];
    if (w?.kind !== 'word') continue;
    for (const s of w.segs) out.push(itemRect(page.num, page.items[s.i], s.a, s.b, s.len));
  }
  return out;
}

export function wordsText(seq: Seq[], a: number, b: number): string {
  return seq.slice(a, b + 1).filter((w): w is Word => w.kind === 'word').map((w) => w.text).join(' ');
}

/** Minutos estimados para ler `words` palavras. */
export const etaMinutes = (words: number, wpm: number) => Math.max(1, Math.round((words / Math.max(50, wpm)) * 1.25));
