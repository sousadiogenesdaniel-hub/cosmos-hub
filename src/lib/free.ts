/**
 * Estudo livre: revisar cards fora do agendamento.
 * Nada aqui altera as datas de revisão (FSRS) — é só prática.
 */
import type { CardRow, ReviewLog } from './types';

export type FreeSel = 'all' | 'errors' | 'hard';
export interface FreeOptions { sel: FreeSel; n: number; includeNew: boolean; shuffle: boolean }

export const FREE_DEFAULTS: FreeOptions = { sel: 'all', n: 20, includeNew: false, shuffle: true };
export const ERRORS_DAYS = 14;

export function readFree(params: URLSearchParams): FreeOptions | null {
  if (params.get('livre') !== '1') return null;
  const sel = params.get('sel');
  const n = Number(params.get('n'));
  return {
    sel: sel === 'errors' || sel === 'hard' ? sel : 'all',
    n: Number.isFinite(n) && n >= 0 ? n : FREE_DEFAULTS.n,
    includeNew: params.get('new') === '1',
    shuffle: params.get('order') !== 'deck',
  };
}

export function freeQuery(o: FreeOptions): string {
  return `?livre=1&sel=${o.sel}&n=${o.n}&new=${o.includeNew ? 1 : 0}&order=${o.shuffle ? 'random' : 'deck'}`;
}

/** Escolhe os cards do estudo livre. `logs` = revisões dos últimos dias (para "os que errei"). */
export function selectFree(cards: CardRow[], logs: ReviewLog[], o: FreeOptions, random = Math.random): CardRow[] {
  let pool = cards.filter((c) => !c.suspended && (o.includeNew || c.state !== 0));
  if (o.sel === 'errors') {
    const missed = new Set(logs.filter((l) => l.rating === 1 && l.card_id).map((l) => l.card_id));
    pool = pool.filter((c) => missed.has(c.id));
  }
  if (o.sel === 'hard') {
    pool = [...pool].sort((a, b) => b.difficulty - a.difficulty || b.lapses - a.lapses);
    if (o.n) pool = pool.slice(0, o.n);
  }
  if (o.shuffle) {
    pool = [...pool];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  }
  return o.n ? pool.slice(0, o.n) : pool;
}

export const isFreeLog = (l: Pick<ReviewLog, 'mode'>) => l.mode.startsWith('livre');

/** Botões do estudo livre: errou volta mais adiante na sessão; acertou sai. */
export const FREE_RATINGS = [
  { grade: 1 as const, label: 'Errei ↺', key: '1', cls: 'again' },
  { grade: 3 as const, label: 'Acertei', key: '3', cls: 'good' },
];
