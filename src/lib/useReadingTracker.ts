import { useEffect, useRef } from 'react';
import { logReading } from './api';

const TICK = 5; // segundos
const IDLE_LIMIT = 3 * 60 * 1000; // sem interação por 3 min = pausa

/** Conta o tempo em cada página enquanto a aba está visível e você está ativo. */
export function useReadingTracker(documentId: string | undefined, page: number) {
  const pageRef = useRef(page);
  const pending = useRef(new Map<number, number>());
  const lastActive = useRef(Date.now());
  pageRef.current = page;

  useEffect(() => {
    if (!documentId) return;
    const bump = () => { lastActive.current = Date.now(); };
    const evs = ['scroll', 'mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));

    const flush = () => {
      const entries = [...pending.current.entries()];
      pending.current.clear();
      for (const [p, s] of entries) if (s > 0) logReading(documentId, p, s);
    };
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActive.current > IDLE_LIMIT) return;
      const p = pageRef.current;
      pending.current.set(p, (pending.current.get(p) ?? 0) + TICK);
    }, TICK * 1000);
    const flusher = window.setInterval(flush, 15000);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump, { capture: true }));
      window.clearInterval(tick);
      window.clearInterval(flusher);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [documentId]);
}
