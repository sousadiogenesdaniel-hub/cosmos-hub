import { describe, expect, it } from 'vitest';
import { AUDIO_RATE, audioPosition, cycleLength, cycleWav, fmtClock, focusesDone, phaseAt, skipSeconds } from '../src/lib/pomodoroTimeline';

const c = { focus: 25 * 60, brk: 5 * 60 };
const len = cycleLength(c); // 1500 + 8 + 300 + 3 = 1811

describe('pomodoro: linha do tempo', () => {
  it('fases do ciclo', () => {
    expect(len).toBe(1811);
    expect(phaseAt(0, c, true)).toMatchObject({ phase: 'focus', remaining: 1500 });
    expect(phaseAt(1499, c, true).phase).toBe('focus');
    expect(phaseAt(1502, c, true).phase).toBe('toBreak');      // alarme + 5 s
    expect(phaseAt(1508, c, true)).toMatchObject({ phase: 'break', remaining: 300 });
    expect(phaseAt(1809, c, true).phase).toBe('toFocus');       // alarme do fim da pausa
    expect(phaseAt(1811, c, true)).toMatchObject({ phase: 'focus', remaining: 1500, cycle: 1 }); // começa sozinho
    expect(phaseAt(1811, c, false).phase).toBe('done');         // modo manual para
  });
  it('conta os focos concluídos', () => {
    expect(focusesDone(1499, c, true)).toBe(0);
    expect(focusesDone(1500, c, true)).toBe(1);
    expect(focusesDone(1811 + 1500, c, true)).toBe(2);
    expect(focusesDone(99999, c, false)).toBe(1);
  });
  it('posição do áudio e pular fase', () => {
    expect(audioPosition(1811 + 10, c, true)).toBe(10);
    expect(phaseAt(100 + skipSeconds(100, c, true), c, true)).toMatchObject({ phase: 'break', remaining: 300 });
    expect(phaseAt(1600 + skipSeconds(1600, c, true), c, true)).toMatchObject({ phase: 'focus', remaining: 1500, cycle: 1 });
  });
  it('relógio', () => {
    expect(fmtClock(1500)).toBe('25:00');
    expect(fmtClock(61.2)).toBe('1:02');
    expect(fmtClock(3700)).toBe('1:01:40');
  });
  it('faixa de áudio: silêncio no foco, alarme na hora certa, tamanho leve', async () => {
    const blob = cycleWav(c);
    const data = new Uint8Array(await blob.arrayBuffer()).subarray(44);
    expect(blob.size).toBeLessThan(8 * 1024 * 1024); // ~7 MB para 25+5 min
    const loud = (t0: number, t1: number) => { let m = 0; for (let i = t0 * AUDIO_RATE; i < t1 * AUDIO_RATE; i++) m = Math.max(m, Math.abs(data[i] - 128)); return m; };
    expect(loud(0, 1499)).toBe(0);         // foco: silêncio total
    expect(loud(1500, 1503)).toBeGreaterThan(60); // alarme de fim de foco
    expect(loud(1504, 1807)).toBe(0);      // pausa: silêncio
    expect(loud(1808, 1811)).toBeGreaterThan(60); // alarme de fim de pausa
  });
});
