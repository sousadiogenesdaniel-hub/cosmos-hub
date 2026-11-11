import { describe, expect, it } from 'vitest';
import { cleanSelection } from '../src/pages/Reader';

describe('limpeza da seleção do PDF', () => {
  it('junta linhas e hifenização', () => {
    expect(cleanSelection('A termodinâ-\nmica estuda\na energia.')).toBe('A termodinâmica estuda a energia.');
    expect(cleanSelection('Parágrafo um\ncontinua.\n\nParágrafo dois.')).toBe('Parágrafo um continua.\n\nParágrafo dois.');
  });
});
