import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Grade } from 'ts-fsrs';
import { deckPath } from '../lib/api';
import { cardFaces } from '../lib/cards';
import { fmtDuration, fmtInterval } from '../lib/dates';
import { RATINGS, previewIntervals } from '../lib/srs';
import { useApp } from '../lib/context';
import { useStudySession, type SessionStats } from '../lib/useStudySession';
import { AudioButton, StoredImage, YouTubeEmbed } from '../components/Media';
import Modal from '../components/Modal';
import CardEditor from '../components/CardEditor';
import { cardsPerMinute, fmtRate, pct } from '../lib/stats';

export default function Study() {
  const { deckId = '' } = useParams();
  const { decks } = useApp();
  const { queue, current, note, rate, skip, stats, replaceNote } = useStudySession(deckId, 'normal');
  const [revealed, setRevealed] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [editing, setEditing] = useState(false);
  const shownAt = useRef(Date.now());
  const busy = useRef(false);

  useEffect(() => { setRevealed(false); setShowVideo(false); shownAt.current = Date.now(); }, [current?.id, current?.reps, current?.due]);

  async function answer(grade: Grade) {
    if (!current || busy.current) return;
    busy.current = true;
    await rate(current, grade, Date.now() - shownAt.current);
    busy.current = false;
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target as HTMLElement).closest('input,textarea,select')) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); setRevealed(true); return; }
      if (revealed) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); answer(3 as Grade); }
        const r = RATINGS.find((x) => x.key === e.key);
        if (r) answer(r.grade);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const title = deckPath(deckId, decks);

  if (queue === null) return <div className="center-pad"><div className="spinner" /></div>;
  if (!current || !note) return <Finished title={title} stats={stats} deckId={deckId} />;

  const faces = cardFaces(note, current.ord);
  const intervals = revealed ? previewIntervals(current) : null;
  const now = new Date();
  const remaining = { n: queue.filter((c) => c.state === 0).length, l: queue.filter((c) => c.state === 1 || c.state === 3).length, r: queue.filter((c) => c.state === 2).length };

  return (
    <div className="study">
      <header className="study-head">
        <Link to="/decks" className="icon-btn" title="Sair">←</Link>
        <div className="grow">
          <div className="study-title">{title}</div>
          <div className="small"><span className="count new">{remaining.n}</span> · <span className="count learn">{remaining.l}</span> · <span className="count review">{remaining.r}</span></div>
        </div>
        <button className="btn small ghost" onClick={() => setEditing(true)}>✎ Editar</button>
        <button className="btn small ghost" onClick={skip} title="Ver depois">Pular</button>
      </header>

      <div className="card-stage">
        <div className="flashcard">
          <div className="card-face" dangerouslySetInnerHTML={{ __html: faces.questionHtml }} />
          {faces.questionImage && <StoredImage src={faces.questionImage} />}
          {faces.questionAudio && <div className="center"><AudioButton key={`q-${current.id}`} src={faces.questionAudio} label="Ouvir pergunta" autoPlay /></div>}
          {revealed && (
            <>
              <hr className="answer-sep" />
              <div className="card-face" dangerouslySetInnerHTML={{ __html: faces.answerHtml }} />
              {faces.answerAudio && <div className="center"><AudioButton key={`a-${current.id}`} src={faces.answerAudio} label="Ouvir resposta" autoPlay /></div>}
            </>
          )}
          <div className="card-extras">
            {note.youtube_url && <button className="btn small ghost" onClick={() => setShowVideo(!showVideo)}>{showVideo ? 'Fechar vídeo' : '▶ Ver vídeo'}</button>}
            {note.source_document_id && <Link className="btn small ghost" to={`/ler/${note.source_document_id}?page=${note.source_page ?? 1}`}>📖 Abrir na fonte{note.source_page ? ` (p. ${note.source_page})` : ''}</Link>}
          </div>
          {showVideo && note.youtube_url && <YouTubeEmbed url={note.youtube_url} start={note.youtube_start} />}
        </div>
      </div>

      <footer className="study-actions">
        {!revealed ? (
          <button className="btn primary big" onClick={() => setRevealed(true)}>Mostrar resposta <kbd>espaço</kbd></button>
        ) : (
          <div className="ratings">
            {RATINGS.map((r) => (
              <button key={r.grade} className={`rate ${r.cls}`} onClick={() => answer(r.grade)}>
                <span className="rate-int">{intervals ? fmtInterval(now, intervals[r.grade]) : ''}</span>
                <span>{r.label}</span>
                <kbd>{r.key}</kbd>
              </button>
            ))}
          </div>
        )}
      </footer>

      {editing && (
        <Modal title="Editar card" onClose={() => setEditing(false)} wide>
          <CardEditor note={note} onSaved={replaceNote} onClose={() => setEditing(false)} />
        </Modal>
      )}
    </div>
  );
}

export function Finished({ title, stats, deckId }: { title: string; stats: SessionStats; deckId: string }) {
  const nav = useNavigate();
  return (
    <div className="center-screen">
      <div className="panel narrow center">
        <div className="big-emoji" aria-hidden>✦</div>
        <h1>Tudo em dia!</h1>
        <p className="muted">{title}</p>
        {stats.done > 0 ? (
          <div className="kpis compact">
            <div className="kpi"><span className="kpi-v">{stats.done}</span><span className="kpi-l">revisões</span></div>
            <div className="kpi"><span className="kpi-v">{fmtDuration(stats.ms)}</span><span className="kpi-l">tempo</span></div>
            <div className="kpi"><span className="kpi-v">{fmtRate(cardsPerMinute(stats.done, stats.ms))}</span><span className="kpi-l">cards/min</span></div>
            <div className="kpi"><span className="kpi-v">{pct(stats.correct, stats.done)}</span><span className="kpi-l">acertos</span></div>
          </div>
        ) : <p>Nenhum card para revisar neste deck agora.</p>}
        <div className="row center gap-s wrap">
          <button className="btn" onClick={() => nav('/decks')}>Voltar aos decks</button>
          <button className="btn ghost" onClick={() => nav(`/decks/${deckId}/cards`)}>Ver cards</button>
          <button className="btn primary" onClick={() => nav('/')}>Início</button>
        </div>
      </div>
    </div>
  );
}
