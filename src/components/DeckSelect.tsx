import { useMemo } from 'react';
import { useApp, useAction } from '../lib/context';
import { createDeck, deckPath } from '../lib/api';

export function useDeckOptions() {
  const { decks } = useApp();
  return useMemo(() => decks.map((d) => ({ id: d.id, path: deckPath(d.id, decks) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR')), [decks]);
}

export default function DeckSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const options = useDeckOptions();
  const { refreshDecks } = useApp();
  const run = useAction();

  async function newDeck() {
    const name = window.prompt('Nome do novo deck (use "Matéria::Assunto" para criar um subdeck):');
    if (!name?.trim()) return;
    const created = await run(async () => {
      const parts = name.split('::').map((p) => p.trim()).filter(Boolean);
      let decks = await refreshDecks();
      let parent: string | null = null;
      let last = null;
      for (const p of parts) {
        const found = decks.find((d) => d.parent_id === parent && d.name.toLowerCase() === p.toLowerCase());
        last = found ?? (await createDeck(p, parent));
        if (!found) decks = [...decks, last];
        parent = last.id;
      }
      await refreshDecks();
      return last;
    });
    if (created) onChange(created.id);
  }

  return (
    <div className="row gap-s">
      <select value={value} onChange={(e) => e.target.value === '__new' ? newDeck() : onChange(e.target.value)} className="grow">
        {!value && <option value="">Escolha um deck…</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.path}</option>)}
        <option value="__new">＋ Novo deck…</option>
      </select>
    </div>
  );
}
