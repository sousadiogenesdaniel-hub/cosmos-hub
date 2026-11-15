/**
 * Linha do tempo de áudio para a revisão por áudio.
 *
 * Com a tela bloqueada, o celular deixa o áudio que já está tocando continuar, mas
 * congela (ou atrasa muito) os relógios do JavaScript. Se o app esperasse "15 s" com
 * um relógio para só então mandar a resposta tocar, a resposta nunca sairia.
 *
 * Por isso os áudios são AGENDADOS com antecedência no relógio do próprio sistema de
 * áudio (Web Audio): pergunta → silêncio para pensar → resposta → pausa → próximo card.
 * O agendamento toca sozinho, como uma playlist, mesmo com o JavaScript parado.
 */
import { signedUrl } from './api';

export class AudioTimeline {
  readonly ctx: AudioContext;
  private noise: AudioBufferSourceNode | null = null;
  private live = new Set<AudioBufferSourceNode>();
  private cache = new Map<string, Promise<AudioBuffer | null>>();

  /** Crie dentro de um toque/clique (regra de autoplay dos navegadores). */
  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.ctx.resume().catch(() => {});
    this.startNoise();
  }

  /** Ruído baixíssimo contínuo: mantém o áudio "ativo" para o sistema não suspender a página. */
  private startNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.0012; // ≈ -58 dBFS
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.ctx.destination);
    src.start();
    this.noise = src;
  }

  get now() { return this.ctx.currentTime; }

  /** Baixa e decodifica um áudio do armazenamento (com cache). */
  load(path: string): Promise<AudioBuffer | null> {
    let p = this.cache.get(path);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(await signedUrl(path));
          const data = await res.arrayBuffer();
          return await this.ctx.decodeAudioData(data);
        } catch {
          return null;
        }
      })();
      this.cache.set(path, p);
    }
    return p;
  }

  /** Esquece áudios que não serão mais usados (libera memória). */
  forget(paths: (string | null | undefined)[]) {
    for (const p of paths) if (p) this.cache.delete(p);
  }

  /** Agenda um áudio para tocar no instante `when` (relógio do áudio). */
  schedule(buf: AudioBuffer, when: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start(Math.max(when, this.ctx.currentTime));
    this.live.add(src);
    src.onended = () => this.live.delete(src);
    return src;
  }

  /** Cancela tudo o que foi agendado (não para o ruído de fundo). */
  cancel(sources?: AudioBufferSourceNode[]) {
    for (const s of sources ?? [...this.live]) {
      try { s.stop(); } catch { /* já parou */ }
      this.live.delete(s);
    }
  }

  pause() { return this.ctx.suspend(); }
  resume() { return this.ctx.resume(); }
  get paused() { return this.ctx.state !== 'running'; }

  close() {
    this.cancel();
    try { this.noise?.stop(); } catch { /* ignore */ }
    this.ctx.close().catch(() => {});
  }
}

/** Duração estimada da fala sintetizada de um texto (em segundos). */
export function ttsSeconds(text: string): number {
  return Math.min(60, 0.8 + text.length * 0.065);
}
