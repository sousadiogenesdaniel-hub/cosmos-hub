/**
 * Revisão por áudio com a tela bloqueada.
 *
 * O Android deixa um player de áudio comum (como uma música) tocar com a tela
 * bloqueada, mas congela o JavaScript do app e pausa o Web Audio. Então, em vez de
 * o app "esperar 15 s e mandar a resposta tocar", montamos UM arquivo de áudio com
 * a sequência inteira (pergunta → silêncio para pensar → resposta → pausa → próximo
 * card…) e tocamos esse arquivo num <audio> comum. Os silêncios fazem parte do arquivo,
 * então nada depende do app estar acordado.
 */
import { signedUrl } from './api';

/** Taxa de amostragem do arquivo montado: 16 kHz mono é ótimo para voz e leve (~1,9 MB/min). */
export const RATE = 16000;

const decoded = new Map<string, Promise<AudioBuffer | null>>();
let decoder: OfflineAudioContext | null = null;

/** Baixa e decodifica um áudio gravado (já convertido para 16 kHz). */
export function decodeClip(path: string): Promise<AudioBuffer | null> {
  let p = decoded.get(path);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(await signedUrl(path));
        const data = await res.arrayBuffer();
        decoder ??= new OfflineAudioContext(1, 1, RATE);
        return await decoder.decodeAudioData(data);
      } catch {
        return null;
      }
    })();
    decoded.set(path, p);
  }
  return p;
}

export function forgetClips(paths: (string | null | undefined)[]) {
  for (const p of paths) if (p) decoded.delete(p);
}

export interface Placement { buffer: AudioBuffer; at: number }

/** Mistura os áudios nos instantes indicados (com um ruído baixíssimo nos silêncios) e devolve um WAV. */
export async function renderWav(placements: Placement[], seconds: number): Promise<Blob> {
  const length = Math.max(1, Math.ceil(seconds * RATE));
  const ctx = new OfflineAudioContext(1, length, RATE);
  // ruído quase inaudível (≈ -60 dBFS): para o sistema, o arquivo nunca fica "mudo"
  const noise = ctx.createBuffer(1, RATE, RATE);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.001;
  const n = ctx.createBufferSource();
  n.buffer = noise;
  n.loop = true;
  n.connect(ctx.destination);
  n.start(0);
  for (const { buffer, at } of placements) {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.connect(ctx.destination);
    s.start(at);
  }
  return encodeWav(await ctx.startRendering());
}

export function encodeWav(buf: AudioBuffer): Blob {
  const data = buf.getChannelData(0);
  const n = data.length;
  const out = new ArrayBuffer(44 + n * 2);
  const v = new DataView(out);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, data[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}

/** Duração estimada da fala sintetizada de um texto (em segundos). */
export function ttsSeconds(text: string): number {
  return Math.min(60, 0.8 + text.length * 0.065);
}
