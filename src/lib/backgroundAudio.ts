/**
 * Mantém a revisão por áudio viva com a tela bloqueada.
 *
 * Navegadores de celular (sobretudo Chrome no Android) congelam páginas em segundo
 * plano, a não ser que estejam tocando mídia. Por isso, durante a sessão, tocamos em
 * loop uma faixa de ruído baixíssimo (≈ -66 dBFS, inaudível na prática): para o
 * sistema, o Cosmos Hub vira um "player", como o Spotify, e ganha controles na tela de
 * bloqueio. Precisa ser iniciado por um toque (regra de autoplay dos navegadores).
 */

/** WAV mono 16-bit com ruído muito baixo (silêncio absoluto não conta como "tocando"). */
export function quietWav(seconds = 2, rate = 8000): Blob {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    v.setInt16(44 + i * 2, (seed % 33) - 16, true); // ±16 de 32768
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export class KeepAlive {
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;

  /** Chame dentro de um clique/toque. */
  start() {
    if (!this.el) {
      this.url = URL.createObjectURL(quietWav());
      this.el = new Audio(this.url);
      this.el.loop = true;
      this.el.preload = 'auto';
      this.el.setAttribute('playsinline', '');
    }
    this.el.play().catch(() => { /* sem permissão de autoplay: segue sem */ });
  }

  pause() { this.el?.pause(); }

  get playing() { return !!this.el && !this.el.paused; }

  destroy() {
    this.el?.pause();
    if (this.el) this.el.src = '';
    if (this.url) URL.revokeObjectURL(this.url);
    this.el = null;
    this.url = null;
  }
}

/** Tempo máximo razoável para falar um texto (a voz do Android às vezes não avisa que terminou). */
export function ttsBudgetMs(text: string): number {
  return 4000 + text.length * 110;
}
