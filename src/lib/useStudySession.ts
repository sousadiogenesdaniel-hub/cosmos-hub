import { useCallback, useEffect, useRef, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { CardRow, Note } from './types';
import { getNotes, listCards, listReviewLogs, saveReview, subtreeIds } from './api';
import { localDay } from './dates';
import { deckQueue } from './queue';
import { LEARN_AHEAD_MS, schedule } from './srs';
import { useApp } from './context';

export interface SessionStats { done: number; correct: number; ms: number }

/** Carrega a fila de um deck e aplica as avaliações (FSRS) salvando no banco. */
export function useStudySession(deckId: string, mode: 'normal' | 'audio') {
  const { decks, toast } = useApp();
  const [queue, setQueue] = useState<CardRow[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [stats, setStats] = useState<SessionStats>({ done: 0, correct: 0, ms: 0 });
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const ids = subtreeIds(deckId, decks);
      const [cards, today] = await Promise.all([listCards(ids), listReviewLogs(localDay())]);
      const q = deckQueue(deckId, decks, cards, today);
      const ns = await getNotes([...new Set(q.map((c) => c.note_id))]);
      setNotes(new Map(ns.map((n) => [n.id, n])));
      setQueue(q);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      setQueue([]);
    }
  }, [deckId, decks, toast]);

  useEffect(() => {
    if (!decks.length || loaded.current) return;
    loaded.current = true;
    load();
  }, [decks.length, load]);

  const current = queue?.[0] ?? null;

  const rate = useCallback(async (card: CardRow, grade: Grade, durationMs: number) => {
    const ms = Math.min(durationMs, mode === 'audio' ? 180000 : 60000); // limita tempo ocioso
    const next = schedule(card, grade);
    const updated: CardRow = { ...card, ...next };
    setQueue((q) => {
      if (!q) return q;
      const rest = q.slice(1);
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
  }, [mode, toast]);

  /** Pula o card sem avaliar (vai para o fim da fila). */
  const skip = useCallback(() => setQueue((q) => (q && q.length > 1 ? [...q.slice(1), q[0]] : q)), []);

  /** Tira o card da fila desta sessão sem avaliar (modo "só ouvir"). */
  const dismiss = useCallback(() => setQueue((q) => (q ? q.slice(1) : q)), []);

  const replaceNote = useCallback((n: Note) => setNotes((m) => new Map(m).set(n.id, n)), []);

  return { queue, current, note: current ? notes.get(current.note_id) ?? null : null, rate, skip, dismiss, stats, replaceNote };
}
