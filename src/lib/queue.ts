import type { CardRow, Deck, ReviewLog } from './types';
import { subtreeIds } from './api';
import { buildQueue, countDue, type DeckCounts } from './srs';

/** Quantos cards novos ainda cabem hoje neste deck (limite do deck − novos já vistos hoje). */
export function remainingNew(deckId: string, decks: Deck[], todayLogs: ReviewLog[]): number {
  const deck = decks.find((d) => d.id === deckId);
  if (!deck) return 0;
  const ids = new Set(subtreeIds(deckId, decks));
  const seen = new Set(todayLogs.filter((l) => l.state_before === 0 && l.deck_id && ids.has(l.deck_id)).map((l) => l.card_id));
  return Math.max(0, deck.new_per_day - seen.size);
}

export function cardsInDeck(deckId: string, decks: Deck[], cards: CardRow[]): CardRow[] {
  const ids = new Set(subtreeIds(deckId, decks));
  return cards.filter((c) => ids.has(c.deck_id));
}

export function deckCounts(deckId: string, decks: Deck[], cards: CardRow[], todayLogs: ReviewLog[]): DeckCounts {
  return countDue(cardsInDeck(deckId, decks, cards), remainingNew(deckId, decks, todayLogs));
}

export function deckQueue(deckId: string, decks: Deck[], cards: CardRow[], todayLogs: ReviewLog[]): CardRow[] {
  return buildQueue(cardsInDeck(deckId, decks, cards), remainingNew(deckId, decks, todayLogs));
}
