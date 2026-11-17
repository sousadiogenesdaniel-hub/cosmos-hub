import { Link } from 'react-router-dom';
import { PHASE_INFO, usePomodoro } from '../lib/pomodoro';
import { fmtClock } from '../lib/pomodoroTimeline';

export function GoalDots({ done, goal }: { done: number; goal: number }) {
  const n = Math.max(goal, done);
  return (
    <span className="pomo-dots" aria-label={`${done} de ${goal} pomodoros`}>
      {Array.from({ length: n }, (_, i) => <span key={i} className={`pomo-dot${i < done ? ' on' : ''}${i >= goal ? ' extra' : ''}`}>🍅</span>)}
    </span>
  );
}

export function PomodoroRing({ size = 180 }: { size?: number }) {
  const { phase, remaining, progress, paused } = usePomodoro();
  const r = 46, c = 2 * Math.PI * r;
  const info = phase ? PHASE_INFO[phase] : null;
  return (
    <div className={`pomo-ring ${phase ?? 'idle'}${paused ? ' paused' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="pomo-track" />
        {progress > 0.003 && <circle cx="50" cy="50" r={r} className="pomo-bar" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} transform="rotate(-90 50 50)" />}
      </svg>
      <div className="pomo-ring-text">
        <span className="pomo-time">{phase === 'done' ? '✓' : fmtClock(remaining)}</span>
        <span className="pomo-label">{paused ? 'Pausado' : info?.label}</span>
      </div>
    </div>
  );
}

export function PomodoroControls() {
  const { run, phase, paused, pause, resume, skip, stop, start, focusMin } = usePomodoro();
  if (!run) return <button className="btn primary big" onClick={start}>▶ Iniciar foco ({focusMin} min)</button>;
  return (
    <div className="row center gap-s wrap">
      {phase === 'done' ? <button className="btn primary" onClick={start}>▶ Novo pomodoro</button>
        : paused ? <button className="btn primary" onClick={resume}>▶ Continuar</button>
          : <button className="btn ghost" onClick={pause}>❚❚ Pausar</button>}
      {phase !== 'done' && <button className="btn ghost" onClick={skip}>{phase === 'focus' || phase === 'toBreak' ? '⏭ Ir para a pausa' : '⏭ Pular pausa'}</button>}
      <button className="btn ghost danger" onClick={stop}>■ Parar</button>
    </div>
  );
}

/** Cartão do Início: meta do dia e o timer. */
export default function PomodoroCard() {
  const { run, todayCount, goal, focusMin, breakMin, needsTap, enableSound } = usePomodoro();
  return (
    <section className="panel pomo-card">
      <div className="row between wrap gap-s">
        <h2>🍅 Pomodoro</h2>
        <Link to="/pomodoro" className="small">ajustar</Link>
      </div>
      <div className="pomo-card-goal">
        <GoalDots done={todayCount} goal={goal} />
        <span className="small muted">{todayCount} de {goal} hoje{todayCount >= goal ? ' · meta batida! 🎉' : ''}</span>
      </div>
      {run ? (
        <div className="pomo-card-run">
          <PomodoroRing size={150} />
          <PomodoroControls />
          {needsTap && <button className="btn small" onClick={enableSound}>🔔 Ativar o alarme com a tela bloqueada</button>}
        </div>
      ) : (
        <div className="pomo-card-run">
          <PomodoroControls />
          <span className="muted small">{focusMin} min de foco · {breakMin} min de pausa · repete sozinho</span>
        </div>
      )}
    </section>
  );
}
