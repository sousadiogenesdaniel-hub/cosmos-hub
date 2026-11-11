import { useEffect, useState, type FormEvent } from 'react';
import type { DailyMust, DocumentRow, GoalType, MustKind } from '../lib/types';
import { createMust, deckPath, deleteMust, listDocuments, listMusts, updateProfile } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useApp, useAction } from '../lib/context';
import { useDeckOptions } from '../components/DeckSelect';

export default function ProfilePage() {
  const { profile, setProfile, decks } = useApp();
  const run = useAction();
  const [form, setForm] = useState({ name: '', occupation: '', bio: '', objectives: '' });
  const [goalType, setGoalType] = useState<GoalType>('cards');
  const [goalValue, setGoalValue] = useState('50');
  const [think, setThink] = useState('15');
  const [musts, setMusts] = useState<DailyMust[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!profile) return;
    setForm({ name: profile.name ?? '', occupation: profile.occupation ?? '', bio: profile.bio ?? '', objectives: profile.objectives ?? '' });
    setGoalType(profile.daily_goal_type);
    setGoalValue(String(profile.daily_goal_value));
    setThink(String(profile.audio_think_seconds));
  }, [profile]);

  const loadMusts = () => run(() => Promise.all([listMusts(), listDocuments()])).then((r) => { if (r) { setMusts(r[0]); setDocs(r[1]); } });
  useEffect(() => {
    loadMusts();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    const p = await run(() => updateProfile({
      name: form.name.trim() || null, occupation: form.occupation.trim() || null, bio: form.bio.trim() || null, objectives: form.objectives.trim() || null,
    }), 'Perfil salvo');
    if (p) setProfile(p);
  }

  async function saveGoals(e: FormEvent) {
    e.preventDefault();
    const p = await run(() => updateProfile({
      daily_goal_type: goalType,
      daily_goal_value: Math.max(1, Number(goalValue) || 1),
      audio_think_seconds: Math.max(1, Math.min(120, Number(think) || 15)),
    }), 'Metas salvas');
    if (p) setProfile(p);
  }

  const initials = (form.name || email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="page">
      <header className="page-head"><h1>Perfil</h1></header>

      <section className="panel">
        <div className="profile-head">
          <div className="avatar">{initials}</div>
          <div><strong>{form.name || 'Sem nome'}</strong><div className="muted small">{email}</div></div>
        </div>
        <form className="stack" onSubmit={saveProfile}>
          <div className="editor-grid">
            <label>Nome<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Profissão / área<input value={form.occupation} onChange={(e) => setForm({ ...form, occupation: e.target.value })} placeholder="Ex.: Engenheiro de qualidade" /></label>
          </div>
          <label>Sobre mim<textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></label>
          <label>Objetivos de estudo<textarea rows={3} value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} placeholder="Ex.: Certificação X até junho; revisar física para o mestrado…" /></label>
          <div className="row end"><button className="btn primary">Salvar perfil</button></div>
        </form>
      </section>

      <section className="panel" id="metas">
        <h2>Meta diária</h2>
        <p className="muted small">Uma meta geral, valendo para qualquer deck ou arquivo. É ela que pinta o mapa de assiduidade (50% = verde claro, 100% = verde forte).</p>
        <form className="stack" onSubmit={saveGoals}>
          <div className="editor-grid">
            <label>Medir por
              <select value={goalType} onChange={(e) => setGoalType(e.target.value as GoalType)}>
                <option value="cards">Cards revisados</option>
                <option value="minutes">Minutos de estudo (cards + leitura)</option>
                <option value="pages">Páginas lidas</option>
              </select>
            </label>
            <label>Quantidade por dia<input type="number" min={1} value={goalValue} onChange={(e) => setGoalValue(e.target.value)} /></label>
          </div>
          <label>Tempo para pensar na revisão por áudio (segundos)<input type="number" min={1} max={120} value={think} onChange={(e) => setThink(e.target.value)} /></label>
          <div className="row end"><button className="btn primary">Salvar metas</button></div>
        </form>
      </section>

      <section className="panel">
        <h2>Obrigatórios do dia</h2>
        <p className="muted small">O que você precisa ver todo dia, independente do resto. Aparecem como checklist no Início.</p>
        <ul className="must-list">
          {musts.map((m) => (
            <li key={m.id}>
              <span className="grow">{describeMust(m, decks, docs)}</span>
              <button className="btn small ghost danger" onClick={async () => { await run(() => deleteMust(m.id)); loadMusts(); }}>Remover</button>
            </li>
          ))}
          {musts.length === 0 && <li className="muted">Nenhum ainda.</li>}
        </ul>
        <AddMust docs={docs} onAdded={loadMusts} />
      </section>

      <section className="panel">
        <h2>Conta</h2>
        <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Sair da conta</button>
      </section>
    </div>
  );
}

function describeMust(m: DailyMust, decks: Parameters<typeof deckPath>[1], docs: DocumentRow[]) {
  if (m.kind === 'doc_pages') return `Ler ${m.target} páginas de "${docs.find((d) => d.id === m.ref_id)?.title ?? 'arquivo apagado'}"`;
  const name = deckPath(m.ref_id, decks) || 'deck apagado';
  return m.kind === 'deck_clear' ? `Zerar as revisões de ${name}` : `Revisar ${m.target} cards de ${name}`;
}

function AddMust({ docs, onAdded }: { docs: DocumentRow[]; onAdded: () => void }) {
  const deckOptions = useDeckOptions();
  const [kind, setKind] = useState<MustKind>('deck_clear');
  const [ref, setRef] = useState('');
  const [target, setTarget] = useState('20');
  const run = useAction();
  const isDoc = kind === 'doc_pages';
  const options = isDoc ? docs.map((d) => ({ id: d.id, path: d.title })) : deckOptions;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!ref) return;
    await run(() => createMust({ kind, ref_id: ref, target: kind === 'deck_clear' ? 0 : Math.max(1, Number(target) || 1) }), 'Obrigatório adicionado');
    setRef('');
    onAdded();
  }

  return (
    <form className="add-must" onSubmit={add}>
      <select value={kind} onChange={(e) => { setKind(e.target.value as MustKind); setRef(''); }}>
        <option value="deck_clear">Zerar deck</option>
        <option value="deck_cards">Revisar N cards do deck</option>
        <option value="doc_pages">Ler N páginas do arquivo</option>
      </select>
      <select value={ref} onChange={(e) => setRef(e.target.value)} className="grow">
        <option value="">{isDoc ? 'Escolha o arquivo…' : 'Escolha o deck…'}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.path}</option>)}
      </select>
      {kind !== 'deck_clear' && <input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} className="num-input" aria-label="Quantidade" />}
      <button className="btn" disabled={!ref}>Adicionar</button>
    </form>
  );
}
