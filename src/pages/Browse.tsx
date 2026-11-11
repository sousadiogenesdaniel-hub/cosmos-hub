import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CardRow, Note } from '../lib/types';
import { deckPath, deleteNote, listCards, listNotes, setNoteSuspended, subtreeIds } from '../lib/api';
import { plain, stripCloze } from '../lib/cards';
import { useApp, useAction } from '../lib/context';
import Modal from '../components/Modal';
import CardEditor from '../components/CardEditor';

const STATE = ['Novo', 'Aprendendo', 'Revisão', 'Reaprendendo'];
const TYPE = { basic: 'Básico', reverse: 'Invertido', cloze: 'Lacuna' };

export default function Browse() {
  const { deckId = '' } = useParams();
  const { decks } = useApp();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [adding, setAdding] = useState(false);
  const run = useAction();

  const load = async () => {
    if (!decks.length) return;
    const ids = subtreeIds(deckId, decks);
    const r = await run(() => Promise.all([listNotes(ids), listCards(ids)]));
    if (r) { setNotes(r[0]); setCards(r[1]); }
  };
  useEffect(() => { load(); }, [deckId, decks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const cardsByNote = useMemo(() => {
    const m = new Map<string, CardRow[]>();
    for (const c of cards) m.set(c.note_id, [...(m.get(c.note_id) ?? []), c]);
    return m;
  }, [cards]);

  const filtered = (notes ?? []).filter((n) => !q || `${n.front} ${n.back}`.toLowerCase().includes(q.toLowerCase()));

  async function remove(n: Note) {
    if (!window.confirm('Apagar este card (e seus áudios/imagens)?')) return;
    await run(() => deleteNote(n), 'Card apagado');
    load();
  }

  async function toggleSuspend(n: Note, suspended: boolean) {
    await run(() => setNoteSuspended(n.id, suspended), suspended ? 'Card suspenso (não aparece nas revisões)' : 'Card reativado');
    load();
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <Link to="/decks" className="muted small">← Flashcards</Link>
          <h1>{deckPath(deckId, decks) || 'Deck'}</h1>
          <p className="muted">{notes?.length ?? 0} notas · {cards.length} cards</p>
        </div>
        <div className="row gap-s">
          <button className="btn primary" onClick={() => setAdding(true)}>＋ Novo card</button>
        </div>
      </header>
      <input type="search" placeholder="Buscar nos cards…" value={q} onChange={(e) => setQ(e.target.value)} className="search-wide" />
      {notes === null ? <div className="center-pad"><div className="spinner" /></div> : filtered.length === 0 ? <p className="muted">Nenhum card aqui ainda.</p> : (
        <ul className="note-list">
          {filtered.map((n) => {
            const cs = cardsByNote.get(n.id) ?? [];
            const suspended = cs.length > 0 && cs.every((c) => c.suspended);
            const next = cs.filter((c) => c.state !== 0).map((c) => c.due).sort()[0];
            return (
              <li key={n.id} className={`note-item${suspended ? ' suspended' : ''}`}>
                <button className="note-main" onClick={() => setEditing(n)}>
                  <span className="note-front">{plain(stripCloze(n.front)) || (n.front_image ? '🖼 imagem' : n.front_audio ? '🔊 áudio' : '—')}</span>
                  <span className="note-back muted">{plain(n.back)}</span>
                </button>
                <span className="note-meta muted small">
                  {TYPE[n.type]} · {cs.map((c) => STATE[c.state]).filter((v, i, a) => a.indexOf(v) === i).join('/')}
                  {next && ` · próx. ${new Date(next).toLocaleDateString('pt-BR')}`}
                  {n.front_audio || n.back_audio ? ' · 🔊' : ''}{n.youtube_url ? ' · ▶' : ''}
                  {suspended ? ' · suspenso' : ''}
                </span>
                <span className="row gap-s">
                  <button className="btn small ghost" onClick={() => toggleSuspend(n, !suspended)}>{suspended ? 'Reativar' : 'Suspender'}</button>
                  <button className="btn small ghost danger" onClick={() => remove(n)}>Apagar</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {(editing || adding) && (
        <Modal title={editing ? 'Editar card' : 'Novo flashcard'} onClose={() => { setEditing(null); setAdding(false); }} wide>
          <CardEditor note={editing ?? undefined} defaultDeckId={deckId} onSaved={load} onClose={() => { setEditing(null); setAdding(false); }} />
        </Modal>
      )}
    </div>
  );
}
