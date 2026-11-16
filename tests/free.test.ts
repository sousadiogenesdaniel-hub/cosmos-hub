import { describe, expect, it } from 'vitest';
import { freeQuery, readFree, selectFree } from '../src/lib/free';
import { remainingNew } from '../src/lib/queue';
import type { CardRow, Deck, ReviewLog } from '../src/lib/types';

const card = (id: string, o: Partial<CardRow> = {}): CardRow => ({ id, note_id: id, deck_id: 'd', ord: 0, due: '2030-01-01T00:00:00Z', stability: 5, difficulty: 5, elapsed_days: 0, scheduled_days: 10, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: null, suspended: false, ...o });
const log = (card_id: string, rating: number, mode = 'normal', state_before = 2): ReviewLog => ({ id: card_id + rating + mode, card_id, deck_id: 'd', rating, state_before, duration_ms: 1000, mode, day: '2026-11-15', reviewed_at: '' });

describe('estudo livre', () => {
  const cards = [card('a', { difficulty: 3 }), card('b', { difficulty: 9 }), card('c', { difficulty: 6 }), card('novo', { state: 0, reps: 0 }), card('susp', { suspended: true })];
  it('pega cards em dia, fora do agendamento (sem novos e suspensos por padrão)', () => {
    expect(selectFree(cards, [], { sel: 'all', n: 0, includeNew: false, shuffle: false }).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(selectFree(cards, [], { sel: 'all', n: 0, includeNew: true, shuffle: false }).map((c) => c.id)).toEqual(['a', 'b', 'c', 'novo']);
  });
  it('“os que errei” e “mais difíceis”', () => {
    expect(selectFree(cards, [log('c', 1), log('a', 3)], { sel: 'errors', n: 0, includeNew: false, shuffle: false }).map((c) => c.id)).toEqual(['c']);
    expect(selectFree(cards, [], { sel: 'hard', n: 2, includeNew: false, shuffle: false }).map((c) => c.id)).toEqual(['b', 'c']);
  });
  it('limite e embaralhar', () => {
    const r = selectFree(cards, [], { sel: 'all', n: 2, includeNew: false, shuffle: true }, () => 0);
    expect(r).toHaveLength(2);
  });
  it('lê e escreve as opções na URL', () => {
    const o = { sel: 'errors' as const, n: 50, includeNew: true, shuffle: false };
    expect(readFree(new URLSearchParams(freeQuery(o)))).toEqual(o);
    expect(readFree(new URLSearchParams('sel=all'))).toBeNull();
  });
  it('estudo livre não gasta o limite de cards novos do dia', () => {
    const decks = [{ id: 'd', name: 'D', parent_id: null, new_per_day: 5, created_at: '' }] as Deck[];
    expect(remainingNew('d', decks, [log('x', 3, 'livre', 0), log('y', 3, 'livre-audio', 0)])).toBe(5);
    expect(remainingNew('d', decks, [log('x', 3, 'normal', 0)])).toBe(4);
  });
});
