// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cardFaces, cardOrds, clozeNumbers, nextClozeNumber, parseTime, renderCloze, youtubeId, youtubeStartFromUrl } from '../src/lib/cards';
import { buildQueue, countDue, schedule } from '../src/lib/srs';
import { goalFraction, heatLevel, statsByDay, streak } from '../src/lib/stats';
import { addDays, dayRange } from '../src/lib/dates';
import type { CardRow, ReviewLog } from '../src/lib/types';

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: Math.random().toString(36), note_id: 'n', deck_id: 'd', ord: 0, due: new Date().toISOString(),
  stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0,
  state: 0, last_review: null, suspended: false, ...over,
});

describe('cloze', () => {
  it('encontra lacunas e gera um card por número', () => {
    const t = 'A {{c1::mitocôndria}} produz {{c2::ATP::sigla}} e {{c1::energia}}';
    expect(clozeNumbers(t)).toEqual([1, 2]);
    expect(cardOrds('cloze', t)).toEqual([1, 2]);
    expect(nextClozeNumber(t)).toBe(3);
    expect(renderCloze(t, 2, false)).toBe('A mitocôndria produz <span class="cloze-blank">[sigla]</span> e energia');
    expect(renderCloze(t, 1, true)).toContain('<span class="cloze-answer">mitocôndria</span>');
  });
  it('tipos básico e invertido', () => {
    expect(cardOrds('basic', 'x')).toEqual([0]);
    expect(cardOrds('reverse', 'x')).toEqual([0, 1]);
    const f = cardFaces({ type: 'reverse', front: 'Pergunta', back: 'Resposta', front_audio: 'a', back_audio: 'b', front_image: null }, 1);
    expect(f.questionText).toBe('Resposta');
    expect(f.questionAudio).toBe('b');
    expect(f.answerAudio).toBe('a');
  });
  it('sanitiza HTML perigoso', () => {
    const f = cardFaces({ type: 'basic', front: '<img src=x onerror=alert(1)>oi', back: '', front_audio: null, back_audio: null, front_image: null }, 0);
    expect(f.questionHtml).not.toContain('onerror');
  });
});

describe('youtube', () => {
  it('extrai id e tempo', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://example.com')).toBeNull();
    expect(youtubeStartFromUrl('https://youtu.be/dQw4w9WgXcQ?t=1m30s')).toBe(90);
    expect(parseTime('1:30')).toBe(90);
    expect(parseTime('75')).toBe(75);
  });
});

describe('FSRS', () => {
  it('card novo avaliado como Bom sai do estado novo', () => {
    const next = schedule(card(), 3);
    expect(next.state).not.toBe(0);
    expect(next.reps).toBe(1);
    expect(new Date(next.due).getTime()).toBeGreaterThan(Date.now());
  });
  it('fila respeita limite de novos, suspensos e vencimento', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 86400000).toISOString();
    const past = new Date(now.getTime() - 86400000).toISOString();
    const cards = [card(), card(), card(), card({ suspended: true }), card({ state: 2, due: past }), card({ state: 2, due: future }), card({ state: 1, due: now.toISOString() })];
    const q = buildQueue(cards, 2, now);
    expect(q).toHaveLength(2 + 1 + 1);
    expect(q[0].state).toBe(1);
    expect(countDue(cards, 2, now)).toEqual({ newCount: 2, learn: 1, review: 1 });
  });
});

describe('métricas', () => {
  const log = (day: string, ms = 10000): ReviewLog => ({ id: day + Math.random(), card_id: 'c', deck_id: 'd', rating: 3, state_before: 2, duration_ms: ms, mode: 'normal', day, reviewed_at: '' });
  it('níveis do mapa de assiduidade', () => {
    expect([0, 0.2, 0.5, 0.99, 1, 1.5].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 4]);
  });
  it('meta, páginas e sequência', () => {
    const today = '2026-11-11';
    const reviews = [...Array(10)].map(() => log(today)).concat([...Array(10)].map(() => log(addDays(today, -1)))).concat([log(addDays(today, -3))]);
    const reading = [{ document_id: 'x', page: 1, day: today, seconds: 30 }, { document_id: 'x', page: 2, day: today, seconds: 3 }];
    const by = statsByDay(reviews, reading);
    expect(by.get(today)?.pages).toBe(1);
    expect(goalFraction(by.get(today), 'cards', 20)).toBe(0.5);
    expect(streak(dayRange(today, 10), by, 'cards', 10)).toBe(2);
    expect(streak(dayRange(addDays(today, 1), 10), by, 'cards', 10)).toBe(2); // hoje sem estudo ainda não quebra
  });
});
