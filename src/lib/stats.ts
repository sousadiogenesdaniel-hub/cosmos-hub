import type { GoalType, ReadingLog, ReviewLog } from './types';

/** Uma página conta como "lida" se ficou pelo menos isto na tela. */
export const PAGE_MIN_SECONDS = 8;

export interface DayStats {
  cards: number;
  reviewMs: number;
  readingMs: number;
  pages: number;
}

export function emptyDay(): DayStats {
  return { cards: 0, reviewMs: 0, readingMs: 0, pages: 0 };
}

export function statsByDay(reviews: ReviewLog[], reading: ReadingLog[]): Map<string, DayStats> {
  const map = new Map<string, DayStats>();
  const get = (d: string) => { let s = map.get(d); if (!s) { s = emptyDay(); map.set(d, s); } return s; };
  for (const r of reviews) { const s = get(r.day); s.cards++; s.reviewMs += r.duration_ms; }
  for (const r of reading) {
    const s = get(r.day);
    s.readingMs += r.seconds * 1000;
    if (r.seconds >= PAGE_MIN_SECONDS) s.pages++;
  }
  return map;
}

export function goalValue(s: DayStats, type: GoalType): number {
  if (type === 'cards') return s.cards;
  if (type === 'pages') return s.pages;
  return Math.floor((s.reviewMs + s.readingMs) / 60000);
}

export function goalFraction(s: DayStats | undefined, type: GoalType, target: number): number {
  if (!s || target <= 0) return 0;
  return goalValue(s, type) / target;
}

/** Nível de cor do mapa de assiduidade: 0 nada · 1 algo · 2 ≥50% · 3 ≥100% · 4 ≥150%. */
export function heatLevel(fraction: number): 0 | 1 | 2 | 3 | 4 {
  if (fraction <= 0) return 0;
  if (fraction < 0.5) return 1;
  if (fraction < 1) return 2;
  if (fraction < 1.5) return 3;
  return 4;
}

/** Dias seguidos (até hoje, ou até ontem se hoje ainda não teve estudo) com a meta batida. */
export function streak(days: string[], byDay: Map<string, DayStats>, type: GoalType, target: number): number {
  let n = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const hit = goalFraction(byDay.get(days[i]), type, target) >= 1;
    if (hit) n++;
    else if (i === days.length - 1) continue; // hoje ainda está em andamento
    else break;
  }
  return n;
}

export interface GroupStats {
  key: string;
  reviews: number;
  ms: number;
  correct: number;
}

/** Agrupa revisões por uma chave (ex.: matéria = deck raiz). */
export function groupReviews(reviews: ReviewLog[], keyOf: (r: ReviewLog) => string): GroupStats[] {
  const map = new Map<string, GroupStats>();
  for (const r of reviews) {
    const key = keyOf(r);
    let g = map.get(key);
    if (!g) { g = { key, reviews: 0, ms: 0, correct: 0 }; map.set(key, g); }
    g.reviews++;
    g.ms += r.duration_ms;
    if (r.rating > 1) g.correct++;
  }
  return [...map.values()].sort((a, b) => b.reviews - a.reviews);
}

export function cardsPerMinute(reviews: number, ms: number): number {
  if (ms <= 0) return 0;
  return reviews / (ms / 60000);
}

export function fmtRate(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

export function pct(part: number, total: number): string {
  if (!total) return '—';
  return `${Math.round((part / total) * 100)}%`;
}
