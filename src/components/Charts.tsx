import { useState } from 'react';
import { addDays, dayRange, fmtDayLong, fmtDayShort, weekday } from '../lib/dates';
import { heatLevel } from '../lib/stats';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface HeatProps {
  today: string;
  weeks: number;
  fraction: (day: string) => number;
  describe: (day: string) => string;
}

/** Mapa de assiduidade: um quadradinho por dia, cor pela % da meta. */
export function Heatmap({ today, weeks, fraction, describe }: HeatProps) {
  const [hover, setHover] = useState<{ day: string; x: number; y: number } | null>(null);
  // começa no domingo de (weeks-1) semanas atrás
  const start = addDays(today, -(weeks - 1) * 7 - weekday(today));
  const cols: string[][] = [];
  for (let w = 0; w < weeks; w++) cols.push(Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
  const CELL = 13, GAP = 3, LEFT = 26, TOP = 18;
  const width = LEFT + weeks * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-scroll">
        <svg width={width} height={height} role="img" aria-label="Mapa de assiduidade" onMouseLeave={() => setHover(null)}>
          {cols.map((col, w) => {
            const first = col[0];
            const prev = w > 0 ? cols[w - 1][0] : null;
            const showMonth = !prev || first.slice(5, 7) !== prev.slice(5, 7);
            return showMonth ? (
              <text key={`m${w}`} x={LEFT + w * (CELL + GAP)} y={11} className="axis-text">{MONTHS[Number(first.slice(5, 7)) - 1]}</text>
            ) : null;
          })}
          {['', 'seg', '', 'qua', '', 'sex', ''].map((l, i) => l && (
            <text key={l} x={0} y={TOP + i * (CELL + GAP) + 10} className="axis-text">{l}</text>
          ))}
          {cols.map((col, w) => col.map((day, d) => {
            if (day > today) return null;
            const lvl = heatLevel(fraction(day));
            const x = LEFT + w * (CELL + GAP), y = TOP + d * (CELL + GAP);
            return (
              <rect key={day} x={x} y={y} width={CELL} height={CELL} rx={3} className={`heat-${lvl}${day === today ? ' heat-today' : ''}`}
                onMouseEnter={() => setHover({ day, x: x + CELL / 2, y })} />
            );
          }))}
        </svg>
        {hover && (
          <div className="chart-tip" style={{ left: hover.x, top: hover.y }}>
            <strong>{fmtDayLong(hover.day)}</strong>
            <span>{describe(hover.day)}</span>
          </div>
        )}
      </div>
      <div className="heat-legend">
        <span className="muted small">Meta do dia:</span>
        {[['0', 0], ['< 50%', 1], ['≥ 50%', 2], ['≥ 100%', 3], ['≥ 150%', 4]].map(([label, l]) => (
          <span key={l} className="legend-item"><svg width={12} height={12}><rect width={12} height={12} rx={3} className={`heat-${l}`} /></svg>{label}</span>
        ))}
      </div>
    </div>
  );
}

interface BarProps {
  days: string[];
  value: (day: string) => number;
  goal?: number;
  unit: string;
}

/** Barras por dia (uma série), com linha tracejada da meta. */
export function DailyBars({ days, value, goal, unit }: BarProps) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map(value);
  const max = Math.max(1, goal ?? 0, ...values) * 1.1;
  const W = 640, H = 180, PAD_L = 32, PAD_B = 22, PAD_T = 8;
  const plotW = W - PAD_L, plotH = H - PAD_B - PAD_T;
  const slot = plotW / days.length;
  const bw = Math.max(2, slot - 2);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  const labelEvery = Math.ceil(days.length / 8);

  return (
    <div className="bars-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="bars" role="img" aria-label={`${unit} por dia`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" className="axis-text">{t}</text>
          </g>
        ))}
        {goal ? <line x1={PAD_L} x2={W} y1={y(goal)} y2={y(goal)} className="goal-line" /> : null}
        {values.map((v, i) => {
          const x = PAD_L + i * slot + 1;
          const h = Math.max(0, plotH + PAD_T - y(v));
          return (
            <g key={days[i]} onMouseEnter={() => setHover(i)}>
              <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH} fill="transparent" />
              {v > 0 && <path className={`bar${hover === i ? ' hot' : ''}`} d={roundTop(x, y(v), bw, h, Math.min(4, bw / 2))} />}
              {i % labelEvery === 0 && <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="axis-text">{fmtDayShort(days[i])}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((PAD_L + hover * slot + slot / 2) / W) * 100}%`, top: 0 }}>
          <strong>{fmtDayLong(days[hover])}</strong>
          <span>{values[hover]} {unit}{goal ? ` · meta ${goal}` : ''}</span>
        </div>
      )}
      {goal ? <div className="heat-legend"><span className="legend-item"><span className="goal-swatch" /> meta diária ({goal} {unit})</span></div> : null}
    </div>
  );
}

function roundTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= r) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export { dayRange };
