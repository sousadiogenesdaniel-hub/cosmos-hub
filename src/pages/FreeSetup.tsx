import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CardRow, ReviewLog } from '../lib/types';
import { deckPath, listCards, listReviewLogs, subtreeIds } from '../lib/api';
import { addDays, localDay } from '../lib/dates';
import { ERRORS_DAYS, FREE_DEFAULTS, freeQuery, selectFree, type FreeOptions, type FreeSel } from '../lib/free';
import { useApp, useAction } from '../lib/context';

const PREF = 'cosmos:freePrefs';
function loadPrefs(): FreeOptions {
  try { return { ...FREE_DEFAULTS, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return FREE_DEFAULTS; }
}

const SELS: { value: FreeSel; title: string; desc: string }[] = [
  { value: 'all', title: 'Todos', desc: 'Qualquer card que você já estudou.' },
  { value: 'errors', title: 'Os que errei', desc: `Cards em que você marcou "Errei" nos últimos ${ERRORS_DAYS} dias.` },
  { value: 'hard', title: 'Os mais difíceis', desc: 'Os cards com maior dificuldade no seu histórico.' },
];
const AMOUNTS = [10, 20, 50, 0];

export default function FreeSetup() {
  const { deckId = '' } = useParams();
  const { decks } = useApp();
  const nav = useNavigate();
  const run = useAction();
  const [opts, setOpts] = useState<FreeOptions>(loadPrefs);
  const [data, setData] = useState<{ cards: CardRow[]; logs: ReviewLog[] } | null>(null);

  useEffect(() => {
    if (!decks.length) return;
    run(() => Promise.all([listCards(subtreeIds(deckId, decks)), listReviewLogs(addDays(localDay(), -ERRORS_DAYS))]))
      .then((r) => r && setData({ cards: r[0], logs: r[1] }));
  }, [deckId, decks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { try { localStorage.setItem(PREF, JSON.stringify(opts)); } catch { /* ignore */ } }, [opts]);

  const count = useMemo(() => (data ? selectFree(data.cards, data.logs, { ...opts, shuffle: false }).length : null), [data, opts]);
  const go = (where: 'estudar' | 'audio') => nav(`/${where}/${deckId}${freeQuery(opts)}`);

  return (
    <div className="page narrow-page">
      <header className="page-head">
        <div>
          <Link to="/decks" className="muted small">← Flashcards</Link>
          <h1>🔁 Estudo livre</h1>
          <p className="muted">{deckPath(deckId, decks)}</p>
        </div>
      </header>

      <section className="panel stack">
        <p className="muted small">Revise quando quiser, fora do agendamento: as datas de revisão dos cards <strong>não mudam</strong>. O tempo estudado entra na sua Evolução.</p>

        <div className="mode-pick" role="radiogroup" aria-label="Quais cards">
          {SELS.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={opts.sel === s.value}
              className={`mode-opt${opts.sel === s.value ? ' on' : ''}`} onClick={() => setOpts({ ...opts, sel: s.value })}>
              <strong>{s.title}</strong><span>{s.desc}</span>
            </button>
          ))}
        </div>

        <div className="field">
          <span className="small muted">Quantos cards</span>
          <div className="chips">
            {AMOUNTS.map((n) => (
              <button key={n} className={`chip${opts.n === n ? ' on' : ''}`} onClick={() => setOpts({ ...opts, n })}>{n || 'Todos'}</button>
            ))}
          </div>
        </div>

        <label className="check"><input type="checkbox" checked={opts.shuffle} onChange={(e) => setOpts({ ...opts, shuffle: e.target.checked })} /> Embaralhar</label>
        <label className="check"><input type="checkbox" checked={opts.includeNew} onChange={(e) => setOpts({ ...opts, includeNew: e.target.checked })} /> Incluir cards novos (que você nunca estudou)</label>

        <p className="free-count">{count === null ? 'Contando…' : count === 0 ? 'Nenhum card com essas opções.' : <><strong>{count}</strong> card{count === 1 ? '' : 's'} nesta sessão</>}</p>

        <div className="row gap-s wrap">
          <button className="btn primary big grow" disabled={!count} onClick={() => go('estudar')}>📖 Estudar lendo</button>
          <button className="btn big grow" disabled={!count} onClick={() => go('audio')}>🎧 Estudar ouvindo</button>
        </div>
      </section>
    </div>
  );
}
