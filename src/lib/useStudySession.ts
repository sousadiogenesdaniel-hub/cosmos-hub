import { useCallback, useEffect, useRef, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { CardRow, Note } from './types';
import { getNotes, listCards, listReviewLogs, logFreeReview, saveReview, subtreeIds } from './api';
import { addDays, localDay } from './dates';
import { ERRORS_DAYS, selectFree, type FreeOptions } from './free';
import { deckQueue } from './queue';
import { LEARN_AHEAD_MS, schedule } from './srs';
import { useApp } from './context';

export interface SessionStats { done: number; correct: number; ms: number }

/**
 * Carrega a fila de um deck e aplica as avaliações (FSRS) salvando no banco.
 * Com `free`, é estudo livre: cards escolhidos fora do agendamento e nada é reagendado.
 */
export function useStudySession(deckId: string, mode: 'normal' | 'audio', free: FreeOptions | null = null) {
  const { decks, toast } = useApp();
  const [queue, setQueue] = useState<CardRow[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [stats, setStats] = useState<SessionStats>({ done: 0, correct: 0, ms: 0 });
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const ids = subtreeIds(deckId, decks);
      const since = free ? addDays(localDay(), -ERRORS_DAYS) : localDay();
      const [cards, logs] = await Promise.all([listCards(ids), listReviewLogs(since)]);
      const q = free ? selectFree(cards, logs, free) : deckQueue(deckId, decks, cards, logs);
      const ns = await getNotes([...new Set(q.map((c) => c.note_id))]);
      setNotes(new Map(ns.map((n) => [n.id, n])));
      setQueue(q);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      setQueue([]);
    }
  }, [deckId, decks, toast, free?.sel, free?.n, free?.includeNew, free?.shuffle]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!decks.length || loaded.current) return;
    loaded.current = true;
    load();
  }, [decks.length, load]);

  const current = queue?.[0] ?? null;

  const rate = useCallback(async (card: CardRow, grade: Grade, durationMs: number) => {
    const ms = Math.min(durationMs, mode === 'audio' ? 180000 : 60000); // limita tempo ocioso
    if (free) {
      // estudo livre: errou → volta 3 cards adiante; acertou → sai. Agendamento intacto.
      setQueue((q) => {
        if (!q) return q;
        const at = q.findIndex((c) => c.id === card.id);
        const rest = at === -1 ? [...q] : [...q.slice(0, at), ...q.slice(at + 1)];
        if (grade === 1) rest.splice(Math.min(rest.length, 3), 0, { ...card, due: new Date().toISOString() });
        return rest;
      });
      setStats((s) => ({ done: s.done + 1, correct: s.correct + (grade > 1 ? 1 : 0), ms: s.ms + ms }));
      try { await logFreeReview(card, grade, ms, mode === 'audio' ? 'livre-audio' : 'livre'); } catch { /* métrica opcional */ }
      return;
    }
    const next = schedule(card, grade);
    const updated: CardRow = { ...card, ...next };
    setQueue((q) => {
      if (!q) return q;
      // tira ESTE card da fila (no modo áudio a ordem pode já ter andado)
      const at = q.findIndex((c) => c.id === card.id);
      const rest = at === -1 ? [...q] : [...q.slice(0, at), ...q.slice(at + 1)];
      // card ainda em aprendizado e vencendo logo volta para a fila
      if (new Date(updated.due).getTime() <= Date.now() + LEARN_AHEAD_MS) {
        const idx = rest.findIndex((c) => c.state !== 1 && c.state !== 3);
        const pos = Math.min(rest.length, Math.max(idx === -1 ? rest.length : idx, 2));
        rest.splice(pos, 0, updated);
      }
      return rest;
    });
    setStats((s) => ({ done: s.done + 1, correct: s.correct + (grade > 1 ? 1 : 0), ms: s.ms + ms }));
    try {
      await saveReview(card, next, grade, ms, mode);
    } catch (e) {
      toast(`Falha ao salvar a revisão: ${e instanceof Error ? e.message : e}`, 'error');
    }
  }, [mode, toast, free]);

  /** Pula o card sem avaliar (vai para o fim da fila). */
  const skip = useCallback(() => setQueue((q) => (q && q.length > 1 ? [...q.slice(1), q[0]] : q)), []);

  /** Tira o card da fila desta sessão sem avaliar (modo "só ouvir"). */
  const dismiss = useCallback((cardId?: string) => setQueue((q) => {
    if (!q) return q;
    const at = cardId ? q.findIndex((c) => c.id === cardId) : 0;
    return at === -1 ? q : [...q.slice(0, at), ...q.slice(at + 1)];
  }), []);

  const replaceNote = useCallback((n: Note) => setNotes((m) => new Map(m).set(n.id, n)), []);

  return { queue, notes, current, note: current ? notes.get(current.note_id) ?? null : null, rate, skip, dismiss, stats, replaceNote };
}
