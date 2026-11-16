import { describe, expect, it } from 'vitest';
import { buildPage, type RawItem } from '../src/lib/reflow';
import { pageSequence, pivotIndex, sentenceBounds, wordDelay, wordsRects, wordsText, type Word } from '../src/lib/rsvp';

const L = (str: string, y: number, w = 0.76, x = 0.12): RawItem => ({ str, x, y, w, h: 0.016, eol: true });
const page = buildPage(7, [
  L('A força normal é o componente da força aerodinâmica. Ela passa pelo cp do veí-', 0.12),
  L('culo, e depende do ângulo de ataque; veja a figura seguinte para entender melhor.', 0.142),
  // figura de 0,16 a 0,45
  L('Figura 2.1 Veículo estável', 0.46, 0.3),
  L('N = ½ ρ V² S', 0.5, 0.2, 0.4),
  L('Depois da fórmula o texto continua normalmente nesta linha inteira da coluna.', 0.54),
]);
const seq = pageSequence(page);
const words = seq.filter((s): s is Word => s.kind === 'word').map((w) => w.text);

describe('leitura rápida', () => {
  it('vira uma palavra por vez, emendando a hifenização', () => {
    expect(words.slice(0, 5)).toEqual(['A', 'força', 'normal', 'é', 'o']);
    expect(words).toContain('veículo,');
    expect(words.join(' ')).not.toMatch(/veí-|½/);
  });
  it('para em figura (buraco + legenda, uma parada só) e em fórmula, sem ler a fórmula', () => {
    const kinds = seq.map((s) => (s.kind === 'stop' ? `[${s.reason}]` : s.text));
    const at = kinds.indexOf('[fig]');
    expect(kinds.slice(at, at + 5)).toEqual(['[fig]', 'Figura', '2.1', 'Veículo', 'estável']);
    expect(kinds.filter((k) => k === '[fig]')).toHaveLength(1);
    expect(kinds[kinds.indexOf('estável') + 1]).toBe('[formula]');
    expect(kinds[kinds.indexOf('[formula]') + 1]).toBe('Depois');
  });
  it('ponto de foco fica um pouco à esquerda do meio', () => {
    expect(pivotIndex('a')).toBe(0);
    expect(pivotIndex('força')).toBe(1);
    expect(pivotIndex('componente')).toBe(3);
    expect(pivotIndex('(foguete)')).toBe(3); // ignora o parêntese
  });
  it('ritmo: fim de frase e palavra longa demoram mais', () => {
    const w = (text: string, o: Partial<Word> = {}): Word => ({ kind: 'word', text, block: 0, segs: [], endSentence: false, endPara: false, heading: false, ...o });
    expect(wordDelay(w('casa'), 300)).toBeCloseTo(200);
    expect(wordDelay(w('aerodinamicamente'), 300)).toBeGreaterThan(260);
    expect(wordDelay(w('fim.', { endSentence: true }), 300)).toBeGreaterThan(400);
    expect(wordDelay(w('casa'), 600)).toBeCloseTo(100);
  });
  it('frase atual e os retângulos dela na página (para grifar)', () => {
    const idx = seq.findIndex((s) => s.kind === 'word' && s.text === 'passa');
    const [a, b] = sentenceBounds(seq, idx);
    expect(wordsText(seq, a, b)).toBe('Ela passa pelo cp do veículo, e depende do ângulo de ataque; veja a figura seguinte para entender melhor.');
    const rects = wordsRects(page, seq, a, b);
    expect(new Set(rects.map((r) => r.y)).size).toBe(2); // duas linhas da página
    expect(rects.every((r) => r.p === 7 && r.w > 0)).toBe(true);
  });
});
