/**
 * Linha do tempo do pomodoro (tudo em segundos):
 *
 *   [ foco F ][ alarme 3 s + 5 s ][ pausa B ][ alarme 3 s ] → repete (modo automático)
 *
 * O mesmo desenho vira uma faixa de áudio (silêncio + alarmes) que toca em loop como
 * música: assim o alarme toca na hora certa com a tela bloqueada, sem o app acordado.
 */
export const ALARM_S = 3;
export const GAP_S = 5;
export const TO_BREAK_S = ALARM_S + GAP_S;

export type PomoPhase = 'focus' | 'toBreak' | 'break' | 'toFocus' | 'done';

export interface Cycle { focus: number; brk: number } // segundos

export const cycleLength = (c: Cycle) => c.focus + TO_BREAK_S + c.brk + ALARM_S;

/** Fase e segundos restantes num instante `elapsed` (segundos desde o início). */
export function phaseAt(elapsed: number, c: Cycle, auto: boolean): { phase: PomoPhase; remaining: number; cycle: number } {
  const len = cycleLength(c);
  if (!auto && elapsed >= len) return { phase: 'done', remaining: 0, cycle: 0 };
  const cycle = auto ? Math.floor(Math.max(0, elapsed) / len) : 0;
  const p = Math.max(0, elapsed) - cycle * len;
  if (p < c.focus) return { phase: 'focus', remaining: c.focus - p, cycle };
  if (p < c.focus + TO_BREAK_S) return { phase: 'toBreak', remaining: c.focus + TO_BREAK_S - p, cycle };
  if (p < c.focus + TO_BREAK_S + c.brk) return { phase: 'break', remaining: c.focus + TO_BREAK_S + c.brk - p, cycle };
  return { phase: 'toFocus', remaining: len - p, cycle };
}

/** Quantos focos já terminaram até `elapsed`. */
export function focusesDone(elapsed: number, c: Cycle, auto: boolean): number {
  if (elapsed < c.focus) return 0;
  if (!auto) return 1;
  return Math.floor((elapsed - c.focus) / cycleLength(c)) + 1;
}

/** Posição na faixa de áudio correspondente a `elapsed`. */
export function audioPosition(elapsed: number, c: Cycle, auto: boolean): number {
  const len = cycleLength(c);
  return auto ? Math.max(0, elapsed) % len : Math.min(Math.max(0, elapsed), len);
}

/** Quanto avançar para pular a fase atual (foco → pausa; pausa → próximo foco). */
export function skipSeconds(elapsed: number, c: Cycle, auto: boolean): number {
  const { phase, remaining } = phaseAt(elapsed, c, auto);
  if (phase === 'focus') return remaining + TO_BREAK_S;                // vai direto para a pausa
  if (phase === 'toBreak') return remaining;
  if (phase === 'break') return remaining + ALARM_S;                   // vai direto para o próximo foco
  if (phase === 'toFocus') return remaining;
  return 0;
}

export const fmtClock = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- áudio

/**
 * 3 kHz, 16 bits (~360 KB por minuto). A faixa NUNCA é silêncio absoluto: leva um
 * ruído baixíssimo (≈ -60 dBFS, inaudível na prática). O Chrome do Android congela
 * em segundo plano páginas "mudas" (silêncio digital) depois de alguns minutos, e aí o
 * alarme não tocaria; com o ruído, a página continua contando como "tocando som".
 */
export const AUDIO_RATE = 3000;
export const NOISE = 50 / 32768; // amplitude do ruído de fundo (≈ -60 dBFS RMS)

function tone(data: Int16Array, at: number, dur: number, hz: number, amp = 0.7) {
  const a = Math.floor(at * AUDIO_RATE), n = Math.floor(dur * AUDIO_RATE), fade = Math.floor(0.012 * AUDIO_RATE);
  for (let i = 0; i < n && a + i < data.length; i++) {
    const env = Math.min(1, i / fade, (n - i) / fade);
    data[a + i] = Math.round(32767 * amp * env * Math.sin((2 * Math.PI * hz * i) / AUDIO_RATE));
  }
}

/** Alarme de fim de foco: três notas subindo, duas vezes. */
function alarmFocusEnd(data: Int16Array, at: number) {
  for (const r of [0, 1.45]) [784, 988, 1175].forEach((hz, k) => tone(data, at + r + k * 0.4, 0.3, hz));
}
/** Alarme de fim de pausa: duas notas descendo, três vezes. */
function alarmBreakEnd(data: Int16Array, at: number) {
  for (let r = 0; r < 3; r++) [1175, 880].forEach((hz, k) => tone(data, at + r * 0.95 + k * 0.32, 0.26, hz));
}

function noiseFloor(n: number): Int16Array {
  const data = new Int16Array(n);
  const amp = Math.round(NOISE * 32768);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed % (2 * amp + 1)) - amp;
  }
  return data;
}

function wav(data: Int16Array): Blob {
  const h = new DataView(new ArrayBuffer(44));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  const bytes = data.length * 2;
  str(0, 'RIFF'); h.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, AUDIO_RATE, true); h.setUint32(28, AUDIO_RATE * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, 'data'); h.setUint32(40, bytes, true);
  // Int16Array já é little-endian em todos os celulares/computadores atuais
  return new Blob([h.buffer, data.buffer as ArrayBuffer], { type: 'audio/wav' });
}

/** Faixa de um ciclo completo: ruído inaudível no foco e na pausa, alarmes nas viradas. */
export function cycleWav(c: Cycle): Blob {
  const data = noiseFloor(Math.ceil(cycleLength(c) * AUDIO_RATE));
  alarmFocusEnd(data, c.focus);
  alarmBreakEnd(data, c.focus + TO_BREAK_S + c.brk);
  return wav(data);
}

/** Só o alarme (para tocar com o app aberto quando a faixa estiver desligada). */
export function alarmWav(kind: 'focusEnd' | 'breakEnd'): Blob {
  const data = new Int16Array(AUDIO_RATE * ALARM_S);
  if (kind === 'focusEnd') alarmFocusEnd(data, 0); else alarmBreakEnd(data, 0);
  return wav(data);
}
