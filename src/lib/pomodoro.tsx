import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from './context';
import { listPomodoros, logPomodoro } from './api';
import { localDay } from './dates';
import type { PomodoroRow } from './types';
import { alarmWav, audioPosition, cycleLength, cycleWav, fmtClock, focusesDone, phaseAt, skipSeconds, type Cycle, type PomoPhase } from './pomodoroTimeline';

/** Pomodoro em andamento (guardado no aparelho: sobrevive a fechar o app). */
interface Run {
  startedAt: number;          // ms — início "virtual" (já descontadas as pausas)
  pausedAt: number | null;
  focusMin: number;
  breakMin: number;
  auto: boolean;
  recorded: number;           // focos já registrados (ou pulados)
}
export interface PomoPrefs { sound: boolean; auto: boolean }

const RUN_KEY = 'cosmos:pomodoro';
const PREF_KEY = 'cosmos:pomodoroPrefs';
const read = <T,>(k: string, fb: T): T => { try { const v = localStorage.getItem(k); return v ? { ...fb, ...JSON.parse(v) } : fb; } catch { return fb; } };
const write = (k: string, v: unknown) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export const PHASE_INFO: Record<PomoPhase, { label: string; icon: string }> = {
  focus: { label: 'Foco', icon: '🍅' },
  toBreak: { label: 'Hora da pausa!', icon: '🔔' },
  break: { label: 'Pausa', icon: '☕' },
  toFocus: { label: 'De volta ao foco!', icon: '🔔' },
  done: { label: 'Ciclo concluído', icon: '✓' },
};

interface PomoState {
  run: Run | null;
  phase: PomoPhase | null;
  remaining: number;
  progress: number;           // 0–1 da fase atual
  paused: boolean;
  needsTap: boolean;          // o alarme da tela bloqueada precisa de um toque para voltar (após reabrir o app)
  todayCount: number;
  today: PomodoroRow[];
  goal: number;
  focusMin: number;
  breakMin: number;
  prefs: PomoPrefs;
  setPrefs: (p: PomoPrefs) => void;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skip: () => void;
  enableSound: () => void;
}

const Ctx = createContext<PomoState | null>(null);

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { profile, toast } = useApp();
  const [run, setRun] = useState<Run | null>(() => { const r = read<Run | null>(RUN_KEY, null); return r && r.startedAt ? r : null; });
  const [prefs, setPrefsState] = useState<PomoPrefs>(() => read(PREF_KEY, { sound: true, auto: true }));
  const [now, setNow] = useState(Date.now());
  const [today, setToday] = useState<PomodoroRow[]>([]);
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const lastPhase = useRef<PomoPhase | null>(null);

  const focusMin = profile?.pomodoro_focus ?? 25;
  const breakMin = profile?.pomodoro_break ?? 5;
  const goal = profile?.pomodoro_goal ?? 4;

  useEffect(() => { write(RUN_KEY, run); }, [run]);
  const setPrefs = (p: PomoPrefs) => { setPrefsState(p); write(PREF_KEY, p); };

  useEffect(() => {
    listPomodoros(localDay()).then(setToday).catch(() => {});
  }, []);

  const cycle: Cycle | null = run ? { focus: run.focusMin * 60, brk: run.breakMin * 60 } : null;
  const elapsed = run ? ((run.pausedAt ?? now) - run.startedAt) / 1000 : 0;

  // ---------- faixa de áudio (alarme com a tela bloqueada)
  const stopAudio = useCallback(() => {
    audio.current?.pause();
    setSoundOn(false);
  }, []);

  /** Monta a faixa do ciclo e toca a partir da posição certa. Precisa vir de um toque. */
  const playAudio = useCallback((r: Run) => {
    const c = { focus: r.focusMin * 60, brk: r.breakMin * 60 };
    const a = audio.current ?? (audio.current = new Audio());
    a.setAttribute('playsinline', '');
    const key = `${c.focus}-${c.brk}`;
    if (a.dataset.key !== key) {
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(cycleWav(c));
      a.src = audioUrl.current;
      a.dataset.key = key;
    }
    a.loop = r.auto;
    const pos = audioPosition(((r.pausedAt ?? Date.now()) - r.startedAt) / 1000, c, r.auto);
    const setPos = () => { try { a.currentTime = pos; } catch { /* ainda carregando */ } };
    if (a.readyState >= 1) setPos(); else a.addEventListener('loadedmetadata', setPos, { once: true });
    // play() precisa acontecer já, dentro do toque, para o celular liberar o som
    a.play().then(() => setSoundOn(true)).catch(() => setSoundOn(false));
  }, []);

  // ---------- relógio da tela (o alarme não depende disto)
  useEffect(() => {
    if (!run || run.pausedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [run]);

  const info = run && cycle ? phaseAt(elapsed, cycle, run.auto) : null;

  // registra os pomodoros concluídos (mesmo os que terminaram com o app fechado)
  useEffect(() => {
    if (!run || !cycle) return;
    const done = focusesDone(elapsed, cycle, run.auto);
    if (done <= run.recorded) return;
    const len = cycleLength(cycle);
    const news: PomodoroRow[] = [];
    for (let k = run.recorded; k < done; k++) {
      const started = new Date(run.startedAt + k * len * 1000);
      const ended = new Date(started.getTime() + cycle.focus * 1000);
      news.push({ id: `local-${started.getTime()}`, day: localDay(ended), started_at: started.toISOString(), minutes: run.focusMin });
    }
    setRun({ ...run, recorded: done });
    const day = localDay();
    setToday((t) => [...t, ...news.filter((p) => p.day === day)]);
    for (const p of news) logPomodoro({ day: p.day, started_at: p.started_at, minutes: p.minutes }).catch(() => toast('Não consegui salvar o pomodoro. Rodou a atualização 003 do banco?', 'error'));
  }, [elapsed, run, cycle, toast]);

  // viradas de fase com o app aberto: título da aba, vibração, notificação e alarme (se a faixa estiver desligada)
  useEffect(() => {
    const phase = info?.phase ?? null;
    const prev = lastPhase.current;
    lastPhase.current = phase;
    if (!phase || !prev || phase === prev) return;
    if (phase === 'toBreak' || phase === 'toFocus' || phase === 'done') {
      const msg = phase === 'toBreak' ? `Pomodoro concluído! Pausa de ${run?.breakMin} min.` : phase === 'toFocus' ? 'Fim da pausa: de volta ao foco!' : 'Ciclo concluído.';
      if (!soundOn) {
        const a = new Audio(URL.createObjectURL(alarmWav(phase === 'toBreak' ? 'focusEnd' : 'breakEnd')));
        a.play().catch(() => {});
      }
      try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* ignore */ }
      if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification(`${PHASE_INFO[phase].icon} Cosmos Hub`, { body: msg, icon: `${import.meta.env.BASE_URL}icon-192.png`, tag: 'pomodoro' }); } catch { /* Android: sem notificação direta */ }
      }
    }
  }, [info?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!info || !run) { document.title = 'Cosmos Hub'; return; }
    const i = PHASE_INFO[info.phase];
    document.title = run.pausedAt ? `⏸ ${fmtClock(info.remaining)} · Cosmos Hub` : `${i.icon} ${fmtClock(info.remaining)} ${i.label} · Cosmos Hub`;
  }, [info?.phase, Math.ceil(info?.remaining ?? 0), run?.pausedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- ações
  const start = useCallback(() => {
    const r: Run = { startedAt: Date.now(), pausedAt: null, focusMin, breakMin, auto: prefs.auto, recorded: 0 };
    setRun(r);
    setNow(Date.now());
    lastPhase.current = 'focus';
    if (prefs.sound) playAudio(r); else stopAudio();
    if ('Notification' in window && Notification.permission === 'default' && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      Notification.requestPermission().catch(() => {});
    }
  }, [focusMin, breakMin, prefs, playAudio, stopAudio]);

  const pause = useCallback(() => {
    if (!run || run.pausedAt) return;
    setRun({ ...run, pausedAt: Date.now() });
    stopAudio();
  }, [run, stopAudio]);

  const resume = useCallback(() => {
    if (!run || !run.pausedAt) return;
    const r = { ...run, startedAt: run.startedAt + (Date.now() - run.pausedAt), pausedAt: null };
    setRun(r);
    setNow(Date.now());
    if (prefs.sound) playAudio(r);
  }, [run, prefs.sound, playAudio]);

  const stop = useCallback(() => {
    setRun(null);
    stopAudio();
    lastPhase.current = null;
  }, [stopAudio]);

  const skip = useCallback(() => {
    if (!run || !cycle) return;
    const e = ((run.pausedAt ?? Date.now()) - run.startedAt) / 1000;
    const ph = phaseAt(e, cycle, run.auto).phase;
    if (ph === 'done') return;
    const s = skipSeconds(e, cycle, run.auto);
    // pular o foco não conta como pomodoro feito
    const recorded = ph === 'focus' ? Math.max(run.recorded, focusesDone(e + s, cycle, run.auto)) : run.recorded;
    const r = { ...run, startedAt: run.startedAt - s * 1000, recorded };
    lastPhase.current = phaseAt(e + s, cycle, run.auto).phase;
    setRun(r);
    setNow(Date.now());
    if (soundOn && !r.pausedAt) playAudio(r);
  }, [run, cycle, soundOn, playAudio]);

  const enableSound = useCallback(() => { if (run && !run.pausedAt) playAudio(run); }, [run, playAudio]);

  // ao desligar a chave do som no meio do pomodoro
  useEffect(() => { if (!prefs.sound) stopAudio(); }, [prefs.sound, stopAudio]);
  useEffect(() => { if (info?.phase === 'done') stopAudio(); }, [info?.phase, stopAudio]);

  // controles na tela de bloqueio enquanto a faixa toca
  useEffect(() => {
    if (!soundOn || !('mediaSession' in navigator) || !info) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: `${PHASE_INFO[info.phase].icon} Pomodoro · ${PHASE_INFO[info.phase].label}`, artist: 'Cosmos Hub', artwork: [{ src: `${import.meta.env.BASE_URL}icon-512.png`, sizes: '512x512', type: 'image/png' }] });
  }, [soundOn, info?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const len = cycle ? (info?.phase === 'focus' ? cycle.focus : info?.phase === 'break' ? cycle.brk : 8) : 1;
  const value = useMemo<PomoState>(() => ({
    run,
    phase: info?.phase ?? null,
    remaining: info?.remaining ?? 0,
    progress: info ? Math.min(1, Math.max(0, 1 - info.remaining / len)) : 0,
    paused: !!run?.pausedAt,
    needsTap: !!run && !run.pausedAt && prefs.sound && !soundOn && info?.phase !== 'done',
    todayCount: today.length,
    today,
    goal, focusMin, breakMin, prefs, setPrefs,
    start, pause, resume, stop, skip, enableSound,
  }), [run, info?.phase, Math.ceil(info?.remaining ?? 0), len, prefs, soundOn, today, goal, focusMin, breakMin, start, pause, resume, stop, skip, enableSound]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePomodoro(): PomoState {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePomodoro fora do PomodoroProvider');
  return v;
}
