import type { CardRow, DailyMust, Deck, DocumentRow, ReadingLog, ReviewLog } from './types';
import { deckPath, subtreeIds } from './api';
import { deckCounts } from './queue';
import { PAGE_MIN_SECONDS } from './stats';

export interface MustStatus { must: DailyMust; label: string; done: boolean; detail: string; link: string }

export function mustStatus(m: DailyMust, ctx: { decks: Deck[]; docs: DocumentRow[]; cards: CardRow[]; todayLogs: ReviewLog[]; todayReading: ReadingLog[] }): MustStatus {
  if (m.kind === 'doc_pages') {
    const doc = ctx.docs.find((d) => d.id === m.ref_id);
    const read = ctx.todayReading.filter((r) => r.document_id === m.ref_id && r.seconds >= PAGE_MIN_SECONDS).length;
    return { must: m, label: `Ler ${m.target} pág. de ${doc?.title ?? 'arquivo apagado'}`, done: read >= m.target, detail: `${read}/${m.target}`, link: `/ler/${m.ref_id}` };
  }
  const name = deckPath(m.ref_id, ctx.decks) || 'deck apagado';
  if (m.kind === 'deck_clear') {
    const c = deckCounts(m.ref_id, ctx.decks, ctx.cards, ctx.todayLogs);
    const left = c.newCount + c.learn + c.review;
    return { must: m, label: `Zerar ${name}`, done: left === 0, detail: left ? `${left} restantes` : 'zerado', link: `/estudar/${m.ref_id}` };
  }
  const ids = new Set(subtreeIds(m.ref_id, ctx.decks));
  const done = ctx.todayLogs.filter((l) => l.deck_id && ids.has(l.deck_id)).length;
  return { must: m, label: `${m.target} cards de ${name}`, done: done >= m.target, detail: `${done}/${m.target}`, link: `/estudar/${m.ref_id}` };
}
