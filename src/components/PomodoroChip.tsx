import { Link, useLocation } from 'react-router-dom';
import { PHASE_INFO, usePomodoro } from '../lib/pomodoro';
import { fmtClock } from '../lib/pomodoroTimeline';

/** Relógio flutuante do pomodoro, visível em todas as telas enquanto ele corre. */
export default function PomodoroChip() {
  const { run, phase, remaining, paused, needsTap, enableSound } = usePomodoro();
  const { pathname } = useLocation();
  if (!run || !phase || pathname === '/pomodoro' || pathname === '/') return null; // nessas telas o timer já aparece grande
  const i = PHASE_INFO[phase];
  return (
    <div className={`pomo-chip ${phase}${paused ? ' paused' : ''}`}>
      <Link to="/pomodoro" className="pomo-chip-main" title="Abrir o pomodoro">
        <span aria-hidden>{paused ? '⏸' : i.icon}</span>
        <strong>{phase === 'done' ? '✓' : fmtClock(remaining)}</strong>
        <span className="hide-sm">{paused ? 'Pausado' : i.label}</span>
      </Link>
      {needsTap && <button className="pomo-chip-bell" onClick={enableSound} title="Ativar o alarme com a tela bloqueada">🔔 ativar alarme</button>}
    </div>
  );
}
