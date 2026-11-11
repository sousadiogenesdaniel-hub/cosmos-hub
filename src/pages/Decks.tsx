import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CardRow, Deck, ReviewLog } from '../lib/types';
import { createDeck, deleteDeck, listAllCards, listReviewLogs, subtreeIds, updateDeck } from '../lib/api';
import { localDay } from '../lib/dates';
import { deckCounts } from '../lib/queue';
import { useApp, useAction } from '../lib/context';
import Modal from '../components/Modal';
import CardEditor from '../components/CardEditor';

export default function Decks() {
  const { decks, refreshDecks } = useApp();
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [today, setToday] = useState<ReviewLog[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ deckId?: string } | null>(null);
  const [settings, setSettings] = useState<Deck | null>(null);
  const run = useAction();

  const load = async () => {
    const r = await run(() => Promise.all([listAllCards(), listReviewLogs(localDay())]));
    if (r) { setCards(r[0]); setToday(r[1]); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function newDeck(parentId: string | null) {
    const name = window.prompt(parentId ? 'Nome do subdeck:' : 'Nome do deck (ex.: Física, Normas de certificação):');
    if (!name?.trim()) return;
    await run(async () => { await createDeck(name.trim(), parentId); await refreshDecks(); }, 'Deck criado');
    if (parentId) setCollapsed((s) => { const n = new Set(s); n.delete(parentId); return n; });
  }

  const roots = decks.filter((d) => !d.parent_id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const totalCards = cards?.length ?? 0;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Flashcards</h1>
          <p className="muted">{decks.length} decks · {totalCards} cards</p>
        </div>
        <div className="row gap-s wrap">
          <button className="btn" onClick={() => newDeck(null)}>＋ Novo deck</button>
          <button className="btn primary" onClick={() => setAdding({})} disabled={!decks.length}>＋ Novo card</button>
        </div>
      </header>

      {decks.length === 0 ? (
        <div className="empty">
          <p>Nenhum deck ainda.</p>
          <p className="muted">Crie um deck por matéria (ex.: Física) e subdecks por assunto (ex.: Física › Óptica). As métricas por matéria usam o deck principal.</p>
          <button className="btn primary" onClick={() => newDeck(null)}>＋ Criar primeiro deck</button>
        </div>
      ) : (
        <div className="deck-table">
          <div className="deck-row deck-header">
            <span>Deck</span>
            <span className="count new" title="Novos">Novos</span>
            <span className="count learn" title="Aprendendo">Aprend.</span>
            <span className="count review" title="A revisar">Revisar</span>
            <span />
          </div>
          {roots.map((d) => (
            <DeckNode key={d.id} deck={d} depth={0} decks={decks} cards={cards} today={today} collapsed={collapsed}
              toggle={(id) => setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              onAddCard={(id) => setAdding({ deckId: id })} onSubdeck={newDeck} onSettings={setSettings} />
          ))}
        </div>
      )}

      {adding && (
        <Modal title="Novo flashcard" onClose={() => setAdding(null)} wide>
          <CardEditor defaultDeckId={adding.deckId} onSaved={load} onClose={() => setAdding(null)} />
        </Modal>
      )}
      {settings && <DeckSettings deck={settings} onClose={() => setSettings(null)} onChanged={async () => { setSettings(null); await refreshDecks(); load(); }} />}
    </div>
  );
}

interface NodeProps {
  deck: Deck; depth: number; decks: Deck[]; cards: CardRow[] | null; today: ReviewLog[]; collapsed: Set<string>;
  toggle: (id: string) => void; onAddCard: (id: string) => void; onSubdeck: (id: string) => void; onSettings: (d: Deck) => void;
}

function DeckNode(p: NodeProps) {
  const { deck, depth, decks, cards } = p;
  const nav = useNavigate();
  const children = decks.filter((d) => d.parent_id === deck.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const counts = cards ? deckCounts(deck.id, decks, cards, p.today) : null;
  const total = counts ? counts.newCount + counts.learn + counts.review : 0;
  const open = !p.collapsed.has(deck.id);
  return (
    <>
      <div className="deck-row">
        <span className="deck-name" style={{ paddingLeft: depth * 20 }}>
          {children.length > 0
            ? <button className="caret" onClick={() => p.toggle(deck.id)} aria-label={open ? 'Recolher' : 'Expandir'}>{open ? '▾' : '▸'}</button>
            : <span className="caret-space" />}
          <Link to={`/estudar/${deck.id}`}>{deck.name}</Link>
        </span>
        <span className={`count new${counts?.newCount ? '' : ' zero'}`}>{counts?.newCount ?? '·'}</span>
        <span className={`count learn${counts?.learn ? '' : ' zero'}`}>{counts?.learn ?? '·'}</span>
        <span className={`count review${counts?.review ? '' : ' zero'}`}>{counts?.review ?? '·'}</span>
        <span className="deck-actions">
          <button className="btn small primary" disabled={!total} onClick={() => nav(`/estudar/${deck.id}`)}>Estudar</button>
          <button className="btn small ghost" disabled={!total} onClick={() => nav(`/audio/${deck.id}`)} title="Revisão por áudio (para estudar caminhando)">🎧</button>
          <DeckMenu items={[
            ['＋ Adicionar card', () => p.onAddCard(deck.id)],
            ['☰ Ver / editar cards', () => nav(`/decks/${deck.id}/cards`)],
            ['↳ Novo subdeck', () => p.onSubdeck(deck.id)],
            ['⚙ Opções do deck', () => p.onSettings(deck)],
          ]} />
        </span>
      </div>
      {open && children.map((c) => <DeckNode key={c.id} {...p} deck={c} depth={depth + 1} />)}
    </>
  );
}

function DeckMenu({ items }: { items: [string, () => void][] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <span className="menu-wrap">
      <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} aria-label="Mais opções">⋯</button>
      {open && (
        <div className="menu">
          {items.map(([label, fn]) => <button key={label} onClick={fn}>{label}</button>)}
        </div>
      )}
    </span>
  );
}

function DeckSettings({ deck, onClose, onChanged }: { deck: Deck; onClose: () => void; onChanged: () => void }) {
  const { decks } = useApp();
  const [name, setName] = useState(deck.name);
  const [perDay, setPerDay] = useState(String(deck.new_per_day));
  const [parent, setParent] = useState(deck.parent_id ?? '');
  const run = useAction();
  const forbidden = new Set(subtreeIds(deck.id, decks));

  async function save() {
    const n = Math.max(0, Math.min(9999, Number(perDay) || 0));
    const ok = await run(() => updateDeck(deck.id, { name: name.trim() || deck.name, new_per_day: n, parent_id: parent || null }).then(() => true), 'Deck salvo');
    if (ok) onChanged();
  }

  async function remove() {
    if (!window.confirm(`Apagar o deck "${deck.name}", seus subdecks e TODOS os cards dentro deles? Isso não pode ser desfeito.`)) return;
    const ok = await run(() => deleteDeck(deck.id, decks).then(() => true), 'Deck apagado');
    if (ok) onChanged();
  }

  return (
    <Modal title="Opções do deck" onClose={onClose}>
      <div className="stack">
        <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Dentro de
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— (deck principal / matéria)</option>
            {decks.filter((d) => !forbidden.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>Cards novos por dia<input type="number" min={0} value={perDay} onChange={(e) => setPerDay(e.target.value)} /></label>
        <p className="muted small">O agendamento usa o algoritmo FSRS (repetição espaçada), mirando 90% de retenção.</p>
        <div className="row between">
          <button className="btn danger ghost" onClick={remove}>Apagar deck</button>
          <div className="row gap-s">
            <button className="btn ghost" onClick={onClose}>Cancelar</button>
            <button className="btn primary" onClick={save}>Salvar</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
