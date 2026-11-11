import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CardRow, DailyMust, DocumentRow, ReadingLog, ReviewLog } from '../lib/types';
import { listAllCards, listDocuments, listMusts, listReadingLogs, listReviewLogs } from '../lib/api';
import { addDays, fmtDuration, localDay } from '../lib/dates';
import { deckCounts } from '../lib/queue';
import { mustStatus } from '../lib/musts';
import { emptyDay, goalFraction, goalValue, statsByDay } from '../lib/stats';
import { useApp, useAction } from '../lib/context';
import { Heatmap } from '../components/Charts';

const GOAL_UNIT = { cards: 'cards', minutes: 'min', pages: 'páginas' };

export default function Home() {
  const { profile, decks } = useApp();
  const [data, setData] = useState<{ cards: CardRow[]; logs: ReviewLog[]; reading: ReadingLog[]; docs: DocumentRow[]; musts: DailyMust[] } | null>(null);
  const run = useAction();
  const today = localDay();

  useEffect(() => {
    const since = addDays(today, -125);
    run(() => Promise.all([listAllCards(), listReviewLogs(since), listReadingLogs(since), listDocuments(), listMusts()]))
      .then((r) => r && setData({ cards: r[0], logs: r[1], reading: r[2], docs: r[3], musts: r[4] }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = useMemo(() => statsByDay(data?.logs ?? [], data?.reading ?? []), [data]);
  if (!data || !profile) return <div className="center-pad"><div className="spinner" /></div>;

  const todayStats = byDay.get(today) ?? emptyDay();
  const value = goalValue(todayStats, profile.daily_goal_type);
  const frac = goalFraction(todayStats, profile.daily_goal_type, profile.daily_goal_value);
  const todayLogs = data.logs.filter((l) => l.day === today);
  const todayReading = data.reading.filter((r) => r.day === today);
  const ctx = { decks, docs: data.docs, cards: data.cards, todayLogs, todayReading };
  const musts = data.musts.map((m) => mustStatus(m, ctx));

  const roots = decks.filter((d) => !d.parent_id).map((d) => ({ d, c: deckCounts(d.id, decks, data.cards, todayLogs) }))
    .map((x) => ({ ...x, total: x.c.newCount + x.c.learn + x.c.review })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  const recent = [...data.docs].filter((d) => d.last_opened_at).sort((a, b) => (b.last_opened_at ?? '').localeCompare(a.last_opened_at ?? '')).slice(0, 4);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const firstName = profile.name?.split(' ')[0];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{hello}{firstName ? `, ${firstName}` : ''}!</h1>
          <p className="muted">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        {!profile.name && <Link to="/perfil" className="btn">Completar perfil →</Link>}
      </header>

      <div className="home-grid">
        <section className="panel goal-panel">
          <h2>Meta de hoje</h2>
          <div className="goal-ring" style={{ ['--p' as string]: Math.min(1, frac) }}>
            <div className="goal-ring-inner">
              <span className="goal-value">{value}</span>
              <span className="muted small">de {profile.daily_goal_value} {GOAL_UNIT[profile.daily_goal_type]}</span>
            </div>
          </div>
          <p className="center">{frac >= 1 ? '🎉 Meta batida!' : frac >= 0.5 ? 'Mais da metade — continue!' : 'Bora começar?'}</p>
          <p className="muted small center">{todayStats.cards} cards · {todayStats.pages} páginas · {fmtDuration(todayStats.reviewMs + todayStats.readingMs)}</p>
        </section>

        <section className="panel">
          <div className="row between"><h2>Obrigatórios do dia</h2><Link to="/perfil#metas" className="small">editar</Link></div>
          {musts.length === 0 ? (
            <p className="muted">Nenhum. Em <Link to="/perfil#metas">Perfil › Metas</Link> você define o que precisa ver todo dia (ex.: zerar o deck de Normas).</p>
          ) : (
            <ul className="must-list">
              {musts.map((s) => (
                <li key={s.must.id} className={s.done ? 'done' : ''}>
                  <span className="must-check" aria-hidden>{s.done ? '✓' : ''}</span>
                  <Link to={s.link} className="grow">{s.label}</Link>
                  <span className="muted small">{s.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="row between"><h2>Para revisar</h2><Link to="/decks" className="small">todos os decks</Link></div>
          {roots.length === 0 ? <p className="muted">{decks.length ? 'Tudo em dia ✦' : 'Crie seu primeiro deck em Flashcards.'}</p> : (
            <ul className="due-list">
              {roots.slice(0, 6).map(({ d, c }) => (
                <li key={d.id}>
                  <Link to={`/estudar/${d.id}`} className="grow">{d.name}</Link>
                  <span className="count new">{c.newCount}</span>
                  <span className="count learn">{c.learn}</span>
                  <span className="count review">{c.review}</span>
                  <Link to={`/audio/${d.id}`} className="icon-btn" title="Revisão por áudio">🎧</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="row between"><h2>Continuar lendo</h2><Link to="/biblioteca" className="small">biblioteca</Link></div>
          {recent.length === 0 ? <p className="muted">Abra um arquivo da biblioteca para começar.</p> : (
            <ul className="due-list">
              {recent.map((d) => (
                <li key={d.id}>
                  <Link to={`/ler/${d.id}`} className="grow">{d.title}</Link>
                  <span className="muted small">p. {d.last_page}{d.page_count ? `/${d.page_count}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="row between"><h2>Assiduidade</h2><Link to="/evolucao" className="small">ver evolução</Link></div>
        <Heatmap today={today} weeks={17} fraction={(d) => goalFraction(byDay.get(d), profile.daily_goal_type, profile.daily_goal_value)}
          describe={(d) => { const s = byDay.get(d) ?? emptyDay(); return `${s.cards} cards · ${s.pages} págs · ${fmtDuration(s.reviewMs + s.readingMs)}`; }} />
      </section>
    </div>
  );
}
