import { useEffect, useState } from 'react';
import { usePomodoro } from '../lib/pomodoro';
import { listPomodoros, updateProfile } from '../lib/api';
import { addDays, dayRange, fmtDayShort, localDay } from '../lib/dates';
import type { PomodoroRow } from '../lib/types';
import { useApp, useAction } from '../lib/context';
import { GoalDots, PomodoroControls, PomodoroRing } from '../components/PomodoroCard';

const FOCUS = [15, 25, 30, 45, 50, 60];
const BREAKS = [5, 10, 15];

export default function PomodoroPage() {
  const p = usePomodoro();
  const { setProfile } = useApp();
  const run = useAction();
  const [week, setWeek] = useState<PomodoroRow[]>([]);
  const [goal, setGoal] = useState(String(p.goal));
  const today = localDay();

  useEffect(() => { listPomodoros(addDays(today, -6)).then(setWeek).catch(() => {}); }, [p.todayCount, today]);
  useEffect(() => { setGoal(String(p.goal)); }, [p.goal]);

  async function save(patch: { pomodoro_focus?: number; pomodoro_break?: number; pomodoro_goal?: number }) {
    const prof = await run(() => updateProfile(patch), 'Salvo');
    if (prof) setProfile(prof);
  }

  const days = dayRange(today, 7);
  const perDay = (d: string) => (d === today ? p.todayCount : week.filter((x) => x.day === d).length);
  const max = Math.max(p.goal, ...days.map(perDay), 1);
  const minutesToday = p.today.reduce((s, x) => s + x.minutes, 0);

  return (
    <div className="page narrow-page">
      <header className="page-head">
        <div>
          <h1>🍅 Pomodoro</h1>
          <p className="muted">{p.todayCount} de {p.goal} hoje · {minutesToday} min de foco</p>
        </div>
      </header>

      <section className="panel pomo-main">
        <GoalDots done={p.todayCount} goal={p.goal} />
        <PomodoroRing size={240} />
        <PomodoroControls />
        {p.needsTap && <button className="btn" onClick={p.enableSound}>🔔 Ativar o alarme com a tela bloqueada</button>}
        {p.run && p.run.focusMin !== p.focusMin && <p className="muted small">Os novos tempos valem a partir do próximo pomodoro.</p>}
      </section>

      <section className="panel stack">
        <h2>Ajustes</h2>
        <div className="field">
          <span className="small muted">Foco (minutos)</span>
          <div className="chips">
            {FOCUS.map((m) => <button key={m} className={`chip${p.focusMin === m ? ' on' : ''}`} onClick={() => save({ pomodoro_focus: m })}>{m}</button>)}
            <input className="num-input" type="number" min={1} max={180} defaultValue={FOCUS.includes(p.focusMin) ? '' : p.focusMin} placeholder="outro"
              onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 180 && v !== p.focusMin) save({ pomodoro_focus: v }); }} aria-label="Outro tempo de foco" />
          </div>
        </div>
        <div className="field">
          <span className="small muted">Pausa (minutos)</span>
          <div className="chips">
            {BREAKS.map((m) => <button key={m} className={`chip${p.breakMin === m ? ' on' : ''}`} onClick={() => save({ pomodoro_break: m })}>{m}</button>)}
            <input className="num-input" type="number" min={1} max={60} defaultValue={BREAKS.includes(p.breakMin) ? '' : p.breakMin} placeholder="outro"
              onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 60 && v !== p.breakMin) save({ pomodoro_break: v }); }} aria-label="Outro tempo de pausa" />
          </div>
        </div>
        <label>Meta de pomodoros por dia
          <input type="number" min={1} max={30} value={goal} onChange={(e) => setGoal(e.target.value)}
            onBlur={() => { const v = Number(goal); if (v >= 1 && v <= 30 && v !== p.goal) save({ pomodoro_goal: v }); }} />
        </label>
        <label className="check"><input type="checkbox" checked={p.prefs.auto} onChange={(e) => p.setPrefs({ ...p.prefs, auto: e.target.checked })} /> Começar o próximo pomodoro sozinho depois da pausa</label>
        <label className="check"><input type="checkbox" checked={p.prefs.sound} onChange={(e) => p.setPrefs({ ...p.prefs, sound: e.target.checked })} /> Alarme com a tela bloqueada</label>
        <p className="muted small">
          {p.prefs.sound
            ? 'O alarme toca como uma música silenciosa, então funciona com o celular bloqueado e com a aba do computador em segundo plano. Use o volume de mídia do celular. Se você ouvir Spotify/YouTube no celular, o Android pausa um dos dois: nesse caso desligue esta opção.'
            : 'Sem esta opção, o alarme só toca com o app aberto na tela (ou numa aba do computador). O tempo continua contando mesmo com o app fechado.'}
        </p>
        <p className="muted small">Ao terminar o foco, o alarme toca, e depois de 5 s começa a contar a pausa. Pausas e pomodoros pulados não contam na meta.</p>
      </section>

      <section className="panel">
        <h2>Últimos 7 dias</h2>
        <div className="pomo-week">
          {days.map((d) => {
            const n = perDay(d);
            return (
              <div key={d} className={`pomo-day${n >= p.goal ? ' hit' : ''}`} title={`${n} pomodoros`}>
                <div className="pomo-bar-v"><div style={{ height: `${(n / max) * 100}%` }} /></div>
                <strong>{n}</strong>
                <span className="muted small">{d === today ? 'hoje' : fmtDayShort(d)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
