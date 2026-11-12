import { useEffect, useMemo, useState } from 'react';
import type { DocumentRow, ReadingLog, ReviewLog } from '../lib/types';
import { listDocuments, listReadingLogs, listReviewLogs, rootDeckId } from '../lib/api';
import { addDays, dayRange, fmtDuration, localDay } from '../lib/dates';
import { PAGE_MIN_SECONDS, cardsPerMinute, emptyDay, fmtRate, goalFraction, goalValue, groupReviews, pct, statsByDay, streak } from '../lib/stats';
import { useApp, useAction } from '../lib/context';
import { DailyBars, Heatmap } from '../components/Charts';

const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 30, label: '30 dias' },
  { days: 90, label: '3 meses' },
  { days: 365, label: '12 meses' },
];

type Metric = 'cards' | 'minutes' | 'pages';
const METRIC_LABEL: Record<Metric, string> = { cards: 'cards', minutes: 'min', pages: 'páginas' };

export default function Progress() {
  const { decks, profile } = useApp();
  const [reviews, setReviews] = useState<ReviewLog[] | null>(null);
  const [reading, setReading] = useState<ReadingLog[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [period, setPeriod] = useState(30);
  const [metric, setMetric] = useState<Metric>('cards');
  const run = useAction();
  const today = localDay();

  useEffect(() => {
    const since = addDays(today, -371);
    run(() => Promise.all([listReviewLogs(since), listReadingLogs(since), listDocuments()])).then((r) => {
      if (r) { setReviews(r[0]); setReading(r[1]); setDocs(r[2]); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const goalType = profile?.daily_goal_type ?? 'cards';
  const goal = profile?.daily_goal_value ?? 50;
  const byDay = useMemo(() => statsByDay(reviews ?? [], reading), [reviews, reading]);
  const sinceDay = addDays(today, -(period - 1));
  const periodReviews = useMemo(() => (reviews ?? []).filter((r) => r.day >= sinceDay), [reviews, sinceDay]);
  const periodReading = useMemo(() => reading.filter((r) => r.day >= sinceDay), [reading, sinceDay]);

  if (!reviews) return <div className="center-pad"><div className="spinner" /></div>;

  const count = (from: string) => reviews.filter((r) => r.day >= from).length;
  const reviewMs = periodReviews.reduce((s, r) => s + r.duration_ms, 0);
  const readingMs = periodReading.reduce((s, r) => s + r.seconds * 1000, 0);
  const pages = periodReading.filter((r) => r.seconds >= PAGE_MIN_SECONDS).length;
  const correct = periodReviews.filter((r) => r.rating > 1).length;
  const allDays = dayRange(today, 372);
  const currentStreak = streak(allDays, byDay, goalType, goal);
  const activeDays = dayRange(today, period).filter((d) => (byDay.get(d)?.cards ?? 0) + (byDay.get(d)?.pages ?? 0) > 0).length;

  const bySubject = groupReviews(periodReviews, (r) => rootDeckId(r.deck_id, decks) ?? '?');
  const subjectName = (id: string) => decks.find((d) => d.id === id)?.name ?? 'Deck apagado';

  const docStats = new Map<string, { pages: number; secs: number; last: string }>();
  for (const r of periodReading) {
    const s = docStats.get(r.document_id) ?? { pages: 0, secs: 0, last: r.day };
    if (r.seconds >= PAGE_MIN_SECONDS) s.pages++;
    s.secs += r.seconds;
    if (r.day > s.last) s.last = r.day;
    docStats.set(r.document_id, s);
  }
  const docRows = [...docStats.entries()].sort((a, b) => b[1].pages - a[1].pages);
  const todayReading = reading.filter((r) => r.day === today && r.seconds >= PAGE_MIN_SECONDS);
  const pages7 = reading.filter((r) => r.day >= addDays(today, -6) && r.seconds >= PAGE_MIN_SECONDS).length;
  const finishedInPeriod = docs.filter((d) => d.finished_at && d.finished_at.slice(0, 10) >= sinceDay).length;

  const chartDays = dayRange(today, Math.min(period, 90));
  const describe = (day: string) => {
    const s = byDay.get(day) ?? emptyDay();
    const f = goalFraction(s, goalType, goal);
    return `${s.cards} cards · ${s.pages} págs · ${fmtDuration(s.reviewMs + s.readingMs)} · ${Math.round(f * 100)}% da meta`;
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Evolução</h1>
          <p className="muted">Meta diária: {goal} {goalType === 'cards' ? 'cards' : goalType === 'pages' ? 'páginas' : 'minutos de estudo'} · sequência atual: <strong>{currentStreak} dia{currentStreak === 1 ? '' : 's'}</strong></p>
        </div>
      </header>

      <section className="kpis">
        <div className="kpi"><span className="kpi-l">Cards hoje</span><span className="kpi-v">{count(today)}</span></div>
        <div className="kpi"><span className="kpi-l">Últimos 7 dias</span><span className="kpi-v">{count(addDays(today, -6))}</span></div>
        <div className="kpi"><span className="kpi-l">Últimos 30 dias</span><span className="kpi-v">{count(addDays(today, -29))}</span></div>
        <div className="kpi"><span className="kpi-l">Páginas hoje</span><span className="kpi-v">{todayReading.length}</span></div>
        <div className="kpi"><span className="kpi-l">Páginas em 7 dias</span><span className="kpi-v">{pages7}</span></div>
      </section>

      <section className="panel">
        <h2>Assiduidade</h2>
        <Heatmap today={today} weeks={53} fraction={(d) => goalFraction(byDay.get(d), goalType, goal)} describe={describe} />
      </section>

      <div className="period-bar">
        {PERIODS.map((p) => <button key={p.days} className={`chip${period === p.days ? ' on' : ''}`} onClick={() => setPeriod(p.days)}>{p.label}</button>)}
      </div>

      <section className="kpis">
        <div className="kpi"><span className="kpi-l">Revisões</span><span className="kpi-v">{periodReviews.length}</span></div>
        <div className="kpi"><span className="kpi-l">Cards por minuto</span><span className="kpi-v">{fmtRate(cardsPerMinute(periodReviews.length, reviewMs))}</span></div>
        <div className="kpi"><span className="kpi-l">Acertos</span><span className="kpi-v">{pct(correct, periodReviews.length)}</span></div>
        <div className="kpi"><span className="kpi-l">Tempo nos cards</span><span className="kpi-v">{fmtDuration(reviewMs)}</span></div>
        <div className="kpi"><span className="kpi-l">Tempo lendo</span><span className="kpi-v">{fmtDuration(readingMs)}</span></div>
        <div className="kpi"><span className="kpi-l">Páginas lidas</span><span className="kpi-v">{pages}</span></div>
        <div className="kpi"><span className="kpi-l">Arquivos concluídos</span><span className="kpi-v">{finishedInPeriod}</span></div>
        <div className="kpi"><span className="kpi-l">Dias com estudo</span><span className="kpi-v">{activeDays}<small>/{period}</small></span></div>
      </section>

      <section className="panel">
        <div className="row between wrap gap-s">
          <h2>Por dia {period > 90 && <span className="muted small">(últimos 90 dias)</span>}</h2>
          <div className="chips">
            {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
              <button key={m} className={`chip${metric === m ? ' on' : ''}`} onClick={() => setMetric(m)}>{m === 'cards' ? 'Cards' : m === 'minutes' ? 'Minutos' : 'Páginas'}</button>
            ))}
          </div>
        </div>
        <DailyBars days={chartDays} unit={METRIC_LABEL[metric]} goal={metric === goalType ? goal : undefined}
          value={(d) => goalValue(byDay.get(d) ?? emptyDay(), metric)} />
      </section>

      <section className="panel">
        <h2>Por matéria</h2>
        <p className="muted small">Matéria = deck principal. Cards/min mostra o ritmo: matérias que exigem mais raciocínio naturalmente ficam mais lentas.</p>
        {bySubject.length === 0 ? <p className="muted">Sem revisões neste período.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Matéria</th><th className="num">Revisões</th><th className="num">Tempo</th><th className="num">Cards/min</th><th className="num">Acertos</th></tr></thead>
              <tbody>
                {bySubject.map((g) => (
                  <tr key={g.key}>
                    <td>{subjectName(g.key)}</td>
                    <td className="num">{g.reviews}</td>
                    <td className="num">{fmtDuration(g.ms)}</td>
                    <td className="num">{fmtRate(cardsPerMinute(g.reviews, g.ms))}</td>
                    <td className="num">{pct(g.correct, g.reviews)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Leitura por arquivo</h2>
        <p className="muted small">Uma página conta como lida quando fica pelo menos {PAGE_MIN_SECONDS} segundos na tela. Para ver o gráfico de páginas por dia, use o botão "Páginas" no gráfico acima.</p>
        {docRows.length === 0 ? <p className="muted">Nenhuma leitura registrada neste período.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Arquivo</th><th className="num">Páginas</th><th className="num">Tempo</th><th className="num">Hoje</th></tr></thead>
              <tbody>
                {docRows.map(([id, s]) => (
                  <tr key={id}>
                    <td>{docs.find((d) => d.id === id)?.title ?? 'Arquivo apagado'}{docs.find((d) => d.id === id)?.finished_at && <span className="lido-badge static">LIDO!</span>}</td>
                    <td className="num">{s.pages}</td>
                    <td className="num">{fmtDuration(s.secs * 1000)}</td>
                    <td className="num">{todayReading.filter((r) => r.document_id === id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
