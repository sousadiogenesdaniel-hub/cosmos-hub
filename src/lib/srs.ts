import { fsrs, generatorParameters, Rating, State, type Card as FsrsCard, type Grade } from 'ts-fsrs';
import type { CardRow } from './types';

export const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));

export const RATINGS: { grade: Grade; label: string; key: string; cls: string }[] = [
  { grade: Rating.Again, label: 'Errei', key: '1', cls: 'again' },
  { grade: Rating.Hard, label: 'Difícil', key: '2', cls: 'hard' },
  { grade: Rating.Good, label: 'Bom', key: '3', cls: 'good' },
  { grade: Rating.Easy, label: 'Fácil', key: '4', cls: 'easy' },
];

export function toFsrs(c: CardRow): FsrsCard {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  };
}

export type SchedulingFields = Pick<CardRow,
  'due' | 'stability' | 'difficulty' | 'elapsed_days' | 'scheduled_days' | 'learning_steps' | 'reps' | 'lapses' | 'state' | 'last_review'>;

export function fromFsrs(c: FsrsCard): SchedulingFields {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : null,
  };
}

export function schedule(card: CardRow, grade: Grade, now = new Date()): SchedulingFields {
  return fromFsrs(scheduler.next(toFsrs(card), now, grade).card);
}

export function previewIntervals(card: CardRow, now = new Date()): Record<number, Date> {
  const p = scheduler.repeat(toFsrs(card), now);
  const out: Record<number, Date> = {};
  for (const r of RATINGS) out[r.grade] = p[r.grade].card.due;
  return out;
}

/** Cards que vencem dentro desta janela entram na mesma sessão (padrão do Anki). */
export const LEARN_AHEAD_MS = 20 * 60 * 1000;

export interface DeckCounts { newCount: number; learn: number; review: number }

/**
 * Monta a fila de estudo: aprendizado vencido, revisões vencidas e até `newLimit` novos.
 * Ordem: aprendizado → revisões (embaralhadas) → novos (na ordem de criação).
 */
export function buildQueue(cards: CardRow[], newLimit: number, now = new Date()): CardRow[] {
  const horizon = now.getTime() + LEARN_AHEAD_MS;
  const active = cards.filter((c) => !c.suspended);
  const learn = active.filter((c) => (c.state === 1 || c.state === 3) && new Date(c.due).getTime() <= horizon)
    .sort((a, b) => a.due.localeCompare(b.due));
  const review = shuffle(active.filter((c) => c.state === 2 && new Date(c.due).getTime() <= now.getTime()));
  const fresh = active.filter((c) => c.state === 0).slice(0, Math.max(0, newLimit));
  return [...learn, ...review, ...fresh];
}

export function countDue(cards: CardRow[], newLimit: number, now = new Date()): DeckCounts {
  const horizon = now.getTime() + LEARN_AHEAD_MS;
  let newCount = 0, learn = 0, review = 0;
  for (const c of cards) {
    if (c.suspended) continue;
    if (c.state === 0) newCount++;
    else if (c.state === 2) { if (new Date(c.due).getTime() <= now.getTime()) review++; }
    else if (new Date(c.due).getTime() <= horizon) learn++;
  }
  return { newCount: Math.min(newCount, Math.max(0, newLimit)), learn, review };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
