import { describe, expect, it } from 'vitest';
import { buildPage, partCoverage, type RawItem } from '../src/lib/reflow';

// página sintética em coordenadas 0–1 (linhas de 1,6% de altura, coluna de 0,12 a 0,88)
const H = 0.016;
let y = 0.04;
const items: RawItem[] = [];
const line = (str: string, x = 0.12, w = 0.76, gap = 0.006, h = H) => { items.push({ str, x, y, w, h, eol: true }); y += h + gap; };
line('Introdução à Tecnologia de Foguetes', 0.12, 0.3);               // cabeçalho (faixa do topo)
y = 0.1;
line('mosfera podem provocar ângulos de ataque bastante elevados, e a estrutura');
line('e o sistema de controle são igualmente solicitados;', 0.12, 0.4);
line('■ ventos de superfície e de altitude. A velocidade do vento compõe-se', 0.15, 0.73);
line('com a do lançador, criando uma velocidade relativa desali-');
line('nhada em relação ao eixo do foguete.', 0.12, 0.3, 0.02);
line('Força normal', 0.15, 0.13);                                     // título curto
line('A força normal é o componente da força aerodinâmica, na direção', 0.15, 0.73);
line('perpendicular ao eixo do veículo.', 0.12, 0.28);
y = 0.95;
line('46', 0.12, 0.02);                                                 // rodapé
line('REPRODUÇÃO PROIBIDA', 0.6, 0.2);

describe('modo leitura: montagem de parágrafos', () => {
  const page = buildPage(46, items);
  const blocks = page.blocks.map((b) => ({ kind: b.kind, text: b.parts.map((p) => p.sep + p.text).join('') }));

  it('remove cabeçalho, rodapé e número de página', () => {
    const all = blocks.map((b) => b.text).join(' ');
    expect(all).not.toContain('Introdução à Tecnologia');
    expect(all).not.toContain('REPRODUÇÃO');
    expect(all).not.toMatch(/\b46\b/);
  });
  it('junta linhas, desfaz hifenização e separa parágrafos, lista e título', () => {
    expect(blocks).toEqual([
      { kind: 'p', text: 'mosfera podem provocar ângulos de ataque bastante elevados, e a estrutura e o sistema de controle são igualmente solicitados;' },
      { kind: 'p', text: '■ ventos de superfície e de altitude. A velocidade do vento compõe-se com a do lançador, criando uma velocidade relativa desalinhada em relação ao eixo do foguete.' },
      { kind: 'h', text: 'Força normal' },
      { kind: 'p', text: 'A força normal é o componente da força aerodinâmica, na direção perpendicular ao eixo do veículo.' },
    ]);
  });
  it('grifo feito no PDF original aparece no trecho certo do modo leitura', () => {
    // grifo cobrindo a 2ª metade da linha "A força normal é o componente..."
    const it = items[7];
    const rect = { p: 46, x: it.x + it.w / 2, y: it.y, w: it.w / 2, h: it.h };
    const cov = partCoverage(46, it, it.str, [{ id: 'g', rects: [rect] }]);
    const marked = it.str.split('').filter((_, j) => cov[j] === 'g').join('');
    expect(marked.length).toBeGreaterThan(it.str.length * 0.4);
    expect(it.str.endsWith(marked)).toBe(true);
  });
});

describe('modo leitura: fórmulas', () => {
  it('linha de fórmula curta não vira título', () => {
    const raw: RawItem[] = [
      { str: 'Texto do parágrafo anterior que termina aqui com ponto final e ocupa a linha.', x: 0.12, y: 0.2, w: 0.76, h: 0.016, eol: true },
      { str: 'N = ½ ρ V² S CNα', x: 0.4, y: 0.25, w: 0.2, h: 0.016, eol: true },
      { str: 'Mais texto do parágrafo seguinte, que continua normalmente nesta linha aqui.', x: 0.12, y: 0.3, w: 0.76, h: 0.016, eol: true },
    ];
    expect(buildPage(1, raw).blocks.map((b) => b.kind)).toEqual(['p', 'p', 'p']);
  });
});
