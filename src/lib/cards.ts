import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Note, NoteType } from './types';

const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/** Números de lacuna usados no texto, ex.: "{{c1::a}} {{c3::b}}" → [1, 3]. */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

/** Quais "ord" de card uma nota gera. */
export function cardOrds(type: NoteType, front: string): number[] {
  if (type === 'basic') return [0];
  if (type === 'reverse') return [0, 1];
  return clozeNumbers(front);
}

/** Próximo número livre de lacuna. */
export function nextClozeNumber(text: string): number {
  const nums = clozeNumbers(text);
  return nums.length ? nums[nums.length - 1] + 1 : 1;
}

/** Substitui as lacunas: a lacuna `ord` vira [...] (ou a resposta, se revealed). */
export function renderCloze(text: string, ord: number, revealed: boolean): string {
  return text.replace(CLOZE_RE, (_all, n: string, answer: string, hint?: string) => {
    if (Number(n) !== ord) return answer;
    if (revealed) return `<span class="cloze-answer">${answer}</span>`;
    return `<span class="cloze-blank">[${hint ? hint : '…'}]</span>`;
  });
}

export function md(text: string): string {
  const html = marked.parse(text ?? '', { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(html);
}

export interface CardFaces {
  questionHtml: string;
  answerHtml: string;
  questionText: string;
  answerText: string;
  questionAudio: string | null;
  answerAudio: string | null;
  questionImage: string | null;
}

/** Monta pergunta/resposta de um card a partir da nota. */
export function cardFaces(note: Pick<Note, 'type' | 'front' | 'back' | 'front_audio' | 'back_audio' | 'front_image'>, ord: number): CardFaces {
  if (note.type === 'cloze') {
    const q = renderCloze(note.front, ord, false);
    const a = renderCloze(note.front, ord, true);
    return {
      questionHtml: md(q),
      answerHtml: md(a) + (note.back.trim() ? `<hr/>${md(note.back)}` : ''),
      questionText: plain(renderClozeSpoken(note.front, ord)),
      answerText: plain(stripCloze(note.front) + '\n' + note.back),
      questionAudio: note.front_audio,
      answerAudio: note.back_audio,
      questionImage: note.front_image,
    };
  }
  const reversed = note.type === 'reverse' && ord === 1;
  const qSrc = reversed ? note.back : note.front;
  const aSrc = reversed ? note.front : note.back;
  return {
    questionHtml: md(qSrc),
    answerHtml: md(aSrc),
    questionText: plain(qSrc),
    answerText: plain(aSrc),
    questionAudio: reversed ? note.back_audio : note.front_audio,
    answerAudio: reversed ? note.front_audio : note.back_audio,
    questionImage: reversed ? null : note.front_image,
  };
}

export function stripCloze(text: string): string {
  return text.replace(CLOZE_RE, (_a, _n, answer: string) => answer);
}

function renderClozeSpoken(text: string, ord: number): string {
  return text.replace(CLOZE_RE, (_a, n: string, answer: string) => (Number(n) === ord ? ' lacuna ' : answer));
}

/** Texto puro (sem markdown/HTML), para leitura em voz e listas. */
export function plain(text: string): string {
  return (text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extrai o ID de um link do YouTube (watch, youtu.be, shorts, embed). */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(url.trim()) ? url.trim() : null;
}

/** Lê o tempo de início do link (?t=90, ?t=1m30s, &start=90). */
export function youtubeStartFromUrl(url: string): number | null {
  const m = url.match(/[?&](?:t|start)=([\dhms]+)/);
  if (!m) return null;
  const v = m[1];
  if (/^\d+$/.test(v)) return Number(v);
  const h = Number(v.match(/(\d+)h/)?.[1] ?? 0);
  const mi = Number(v.match(/(\d+)m/)?.[1] ?? 0);
  const s = Number(v.match(/(\d+)s/)?.[1] ?? 0);
  return h * 3600 + mi * 60 + s;
}

/** "1:30" ou "90" → 90 segundos. */
export function parseTime(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function fmtTime(sec: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
