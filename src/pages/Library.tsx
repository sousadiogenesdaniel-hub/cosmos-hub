import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DOC_KINDS, kindLabel, type DocumentRow } from '../lib/types';
import { createDocument, deleteDocument, listDocuments, updateDocument } from '../lib/api';
import { useAction } from '../lib/context';
import Modal from '../components/Modal';

const MAX_MB = 50;

export default function Library() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [kind, setKind] = useState('');
  const [subject, setSubject] = useState('');
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const run = useAction();

  const load = () => run(listDocuments).then((d) => d && setDocs(d));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const subjects = useMemo(() => [...new Set((docs ?? []).map((d) => d.subject).filter(Boolean) as string[])].sort(), [docs]);

  const filtered = useMemo(() => (docs ?? []).filter((d) => {
    if (kind && d.kind !== kind) return false;
    if (subject && d.subject !== subject) return false;
    if (q) {
      const hay = `${d.title} ${d.subject ?? ''} ${d.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [docs, kind, subject, q]);

  const grouped = useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const d of filtered) {
      const k = d.subject || 'Sem matéria';
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Sem matéria' ? 1 : b === 'Sem matéria' ? -1 : a.localeCompare(b, 'pt-BR')));
  }, [filtered]);

  const totalMb = (docs ?? []).reduce((s, d) => s + (d.size_bytes ?? 0), 0) / 1048576;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Biblioteca</h1>
          <p className="muted">{docs?.length ?? 0} arquivos · {totalMb.toFixed(0)} MB de 1 GB usados</p>
        </div>
        <button className="btn primary" onClick={() => setUploading(true)}>＋ Adicionar arquivo</button>
      </header>

      <div className="filters">
        <input type="search" placeholder="Buscar por título, matéria ou tag…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          <button className={`chip${kind === '' ? ' on' : ''}`} onClick={() => setKind('')}>Todos</button>
          {DOC_KINDS.map((k) => (
            <button key={k.value} className={`chip${kind === k.value ? ' on' : ''}`} onClick={() => setKind(kind === k.value ? '' : k.value)}>{k.label}</button>
          ))}
        </div>
        {subjects.length > 0 && (
          <select value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">Todas as matérias</option>
            {subjects.map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
      </div>

      {docs === null ? <div className="center-pad"><div className="spinner" /></div> : docs.length === 0 ? (
        <div className="empty">
          <p>Sua biblioteca está vazia.</p>
          <p className="muted">Adicione um PDF ou Word (.docx): livros, artigos, relatórios, normas…</p>
          <button className="btn primary" onClick={() => setUploading(true)}>＋ Adicionar o primeiro arquivo</button>
        </div>
      ) : filtered.length === 0 ? <p className="muted">Nada encontrado com esses filtros.</p> : grouped.map(([group, items]) => (
        <section key={group} className="doc-group">
          <h2 className="group-title">{group} <span className="muted">· {items.length}</span></h2>
          <div className="doc-grid">
            {items.map((d) => <DocCard key={d.id} d={d} onEdit={() => setEditing(d)} />)}
          </div>
        </section>
      ))}

      {uploading && <UploadModal subjects={subjects} onClose={() => setUploading(false)} onDone={() => { setUploading(false); load(); }} />}
      {editing && <EditModal doc={editing} subjects={subjects} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function DocCard({ d, onEdit }: { d: DocumentRow; onEdit: () => void }) {
  const progress = d.page_count ? Math.min(1, d.last_page / d.page_count) : 0;
  return (
    <div className="doc-card">
      <Link to={`/ler/${d.id}`} className="doc-main">
        <div className={`doc-icon ${d.file_type}`}>{d.file_type === 'pdf' ? 'PDF' : 'DOC'}</div>
        <div className="doc-info">
          <div className="doc-title">{d.title}</div>
          <div className="muted small">{kindLabel(d.kind)}{d.page_count ? ` · p. ${d.last_page} de ${d.page_count}` : ''}</div>
          {d.tags.length > 0 && <div className="tags">{d.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
        </div>
      </Link>
      {d.page_count ? <div className="progress thin"><div style={{ width: `${progress * 100}%` }} /></div> : null}
      <button className="icon-btn doc-edit" onClick={onEdit} title="Editar informações">⋯</button>
    </div>
  );
}

function titleFromFile(name: string) {
  return name.replace(/\.(pdf|docx)$/i, '').replace(/[_-]+/g, ' ').trim();
}

function MetaFields({ kind, setKind, subject, setSubject, tags, setTags, subjects }: {
  kind: string; setKind: (v: string) => void; subject: string; setSubject: (v: string) => void;
  tags: string; setTags: (v: string) => void; subjects: string[];
}) {
  return (
    <>
      <div className="editor-grid">
        <label>Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label>Matéria / conteúdo
          <input list="subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: Física, Normas ISO…" />
          <datalist id="subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
      </div>
      <label>Tags (separadas por vírgula)<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: cap. 3, prova, certificação" /></label>
    </>
  );
}

const parseTags = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);

function UploadModal({ subjects, onClose, onDone }: { subjects: string[]; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('livro');
  const [subject, setSubject] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = useAction();

  function pick(f: File | undefined) {
    setErr(null);
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) { setErr('Use um arquivo .pdf ou .docx (Word). Arquivos .doc antigos: salve como .docx no Word.'); return; }
    if (f.size > MAX_MB * 1048576) { setErr(`Arquivo maior que ${MAX_MB} MB (limite do plano gratuito).`); return; }
    setFile(f);
    if (!title) setTitle(titleFromFile(f.name));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) { setErr('Escolha um arquivo.'); return; }
    setBusy(true);
    const ok = await run(() => createDocument(file, { title: title.trim() || titleFromFile(file.name), kind, subject: subject.trim() || null, tags: parseTags(tags) }), 'Arquivo adicionado ✓');
    setBusy(false);
    if (ok) onDone();
  }

  return (
    <Modal title="Adicionar arquivo" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className={`dropzone${file ? ' has-file' : ''}`}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
          <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => pick(e.target.files?.[0])} hidden />
          {file ? <><strong>{file.name}</strong><span className="muted small">{(file.size / 1048576).toFixed(1)} MB · clique para trocar</span></>
            : <><strong>Arraste o PDF ou Word aqui</strong><span className="muted small">ou clique para escolher (até {MAX_MB} MB)</span></>}
        </label>
        <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <MetaFields {...{ kind, setKind, subject, setSubject, tags, setTags, subjects }} />
        {err && <p className="error-text">{err}</p>}
        <div className="row end gap-s">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !file}>{busy ? 'Enviando…' : 'Adicionar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function EditModal({ doc, subjects, onClose, onDone }: { doc: DocumentRow; subjects: string[]; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [kind, setKind] = useState(doc.kind);
  const [subject, setSubject] = useState(doc.subject ?? '');
  const [tags, setTags] = useState(doc.tags.join(', '));
  const run = useAction();

  async function save(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => updateDocument(doc.id, { title: title.trim() || doc.title, kind, subject: subject.trim() || null, tags: parseTags(tags) }).then(() => true), 'Salvo');
    if (ok) onDone();
  }

  async function remove() {
    if (!window.confirm(`Apagar "${doc.title}"? O arquivo sai da biblioteca. Os flashcards criados a partir dele continuam existindo.`)) return;
    const ok = await run(() => deleteDocument(doc).then(() => true), 'Arquivo apagado');
    if (ok) onDone();
  }

  return (
    <Modal title="Editar arquivo" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label>Título<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <MetaFields {...{ kind, setKind, subject, setSubject, tags, setTags, subjects }} />
        <div className="row between">
          <button type="button" className="btn danger ghost" onClick={remove}>Apagar arquivo</button>
          <div className="row gap-s">
            <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
            <button className="btn primary">Salvar</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
