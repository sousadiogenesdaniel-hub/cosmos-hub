import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Deck, Profile } from './types';
import * as api from './api';

interface Toast { id: number; text: string; kind: 'ok' | 'error' }

interface AppState {
  profile: Profile | null;
  setProfile: (p: Profile) => void;
  decks: Deck[];
  refreshDecks: () => Promise<Deck[]>;
  toast: (text: string, kind?: 'ok' | 'error') => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const refreshDecks = useCallback(async () => {
    const d = await api.listDecks();
    setDecks(d);
    return d;
  }, []);

  useEffect(() => {
    api.getProfile().then(setProfile).catch((e) => toast(e.message, 'error'));
    refreshDecks().catch((e) => toast(e.message, 'error'));
  }, [refreshDecks, toast]);

  return (
    <Ctx.Provider value={{ profile, setProfile, decks, refreshDecks, toast }}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fora do AppProvider');
  return v;
}

/** Envolve uma ação assíncrona mostrando o erro num toast. */
export function useAction() {
  const { toast } = useApp();
  return useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      return undefined;
    }
  }, [toast]);
}
