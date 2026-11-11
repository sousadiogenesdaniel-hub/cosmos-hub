import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DocumentRow } from '../lib/types';
import { downloadFile, getDocument, updateDocument } from '../lib/api';
import { useApp } from '../lib/context';
import { useReadingTracker } from '../lib/useReadingTracker';
import PdfViewer from '../components/PdfViewer';
import DocxViewer from '../components/DocxViewer';
import CardEditor, { type Injection, type Prefill } from '../components/CardEditor';

interface Sel { text: string; page: number; x: number; y: number }

/** Junta as quebras de linha do PDF num texto corrido. */
export function cleanSelection(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/(\p{L})-\n(\p{L})/gu, '$1$2')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

export default function Reader() {
  const { docId } = useParams();
  const [params] = useSearchParams();
  const { toast } = useApp();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cropMode, setCropMode] = useState(false);
  const [goto, setGoto] = useState<{ page: number; nonce: number } | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [injection, setInjection] = useState<Injection | null>(null);
  const [gotoInput, setGotoInput] = useState('');
  const viewerRef = useRef<HTMLDivElement>(null);
  const startPage = Number(params.get('page')) || 0;

  useEffect(() => {
    if (!docId) return;
    (async () => {
      try {
        const d = await getDocument(docId);
        setDoc(d);
        setPage(startPage || d.last_page || 1);
        setData(await downloadFile(d.file_path));
        updateDocument(d.id, { last_opened_at: new Date().toISOString() }).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [docId, startPage]);

  useReadingTracker(doc?.id, page);

  // salva a última página (com atraso, para não gravar a cada rolagem)
  useEffect(() => {
    if (!doc) return;
    const t = window.setTimeout(() => updateDocument(doc.id, { last_page: page }).catch(() => {}), 1500);
    return () => window.clearTimeout(t);
  }, [doc, page]);

  const onPageCount = useCallback((n: number) => {
    setPageCount(n);
    if (doc && doc.page_count !== n) updateDocument(doc.id, { page_count: n }).catch(() => {});
  }, [doc]);

  // detecta seleção de texto dentro do leitor
  useEffect(() => {
    let t = 0;
    const check = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const s = window.getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) { setSel(null); return; }
        const range = s.getRangeAt(0);
        const container = viewerRef.current;
        if (!container || !container.contains(range.commonAncestorContainer)) { setSel(null); return; }
        const text = cleanSelection(s.toString());
        if (!text) { setSel(null); return; }
        const rect = range.getBoundingClientRect();
        const anchor = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest('[data-page]') as HTMLElement | null;
        const host = container.getBoundingClientRect();
        setSel({
          text,
          page: doc?.file_type === 'pdf' ? Number(anchor?.dataset.page ?? page) : page,
          x: Math.min(Math.max(rect.left + rect.width / 2, host.left + 120), host.right - 120),
          y: rect.top < host.top + 60 ? Math.min(rect.bottom + 8, host.bottom - 60) : rect.top - 52,
        });
      }, 120);
    };
    document.addEventListener('selectionchange', check);
    return () => { document.removeEventListener('selectionchange', check); window.clearTimeout(t); };
  }, [doc, page]);

  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  }

  function newCardFrom(text?: string, image?: Blob, p?: number) {
    setPrefill({ front: text, image, sourceDocumentId: doc?.id, sourcePage: p ?? page });
    setEditorOpen(true);
    clearSelection();
  }

  function inject(target: 'front' | 'back') {
    if (!sel) return;
    setInjection({ target, text: sel.text, nonce: Date.now() });
    clearSelection();
  }

  function onCrop(blob: Blob, p: number) {
    setCropMode(false);
    if (editorOpen) setInjection({ target: 'front', image: blob, nonce: Date.now() });
    else newCardFrom(undefined, blob, p);
    toast('Recorte adicionado na frente do card');
  }

  function jump() {
    const n = Number(gotoInput);
    if (n >= 1 && (!pageCount || n <= pageCount)) setGoto({ page: n, nonce: Date.now() });
    setGotoInput('');
  }

  // atalhos: Esc fecha recorte
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCropMode(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) return <div className="center-screen"><div className="panel narrow"><p className="error-text">{error}</p><Link className="btn" to="/biblioteca">← Voltar à biblioteca</Link></div></div>;

  const isPdf = doc?.file_type === 'pdf';
  const pageLabel = isPdf ? 'Página' : 'Página aprox.';

  return (
    <div className={`reader${editorOpen ? ' with-editor' : ''}`}>
      <header className="reader-bar">
        <Link to="/biblioteca" className="icon-btn" title="Voltar à biblioteca">←</Link>
        <div className="reader-title" title={doc?.title}>{doc?.title ?? 'Carregando…'}</div>
        <div className="reader-tools">
          <form className="page-jump" onSubmit={(e) => { e.preventDefault(); jump(); }}>
            <span className="muted small hide-sm">{pageLabel}</span>
            <input value={gotoInput} onChange={(e) => setGotoInput(e.target.value.replace(/\D/g, ''))} placeholder={String(page)} aria-label="Ir para página" />
            <span className="muted small">/ {pageCount ?? '…'}</span>
          </form>
          <div className="btn-group">
            <button className="btn small ghost" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} title="Diminuir zoom">−</button>
            <button className="btn small ghost" onClick={() => setZoom(1)} title="Ajustar à largura">{Math.round(zoom * 100)}%</button>
            <button className="btn small ghost" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))} title="Aumentar zoom">+</button>
          </div>
          {isPdf && (
            <button className={`btn small ${cropMode ? 'primary' : 'ghost'}`} onClick={() => setCropMode(!cropMode)}
              title="Arraste um retângulo sobre a página para usar como imagem no card (bom para PDFs escaneados, fórmulas e figuras)">
              ✂ <span className="hide-sm">{cropMode ? 'Arraste na página…' : 'Recortar área'}</span>
            </button>
          )}
          <button className="btn small primary" onClick={() => newCardFrom()}>＋ <span className="hide-sm">Novo card</span></button>
        </div>
      </header>

      <div className="reader-body">
        <div className="viewer" ref={viewerRef}>
          {data && doc && (isPdf ? (
            <PdfViewer data={data} initialPage={page} zoom={zoom} cropMode={cropMode} goto={goto}
              onPageChange={setPage} onPageCount={onPageCount} onCrop={onCrop} onError={setError} />
          ) : (
            <DocxViewer data={data} initialPage={page} zoom={zoom} goto={goto}
              onPageChange={setPage} onPageCount={onPageCount} onError={setError} />
          ))}
          {!data && !error && <div className="center-pad"><div className="spinner" /><p className="muted">Baixando arquivo…</p></div>}
        </div>

        {editorOpen && (
          <aside className="editor-drawer">
            <div className="drawer-head">
              <h2>Novo flashcard</h2>
              <button className="icon-btn" onClick={() => setEditorOpen(false)} aria-label="Fechar editor">✕</button>
            </div>
            <p className="muted small drawer-tip">Dica: selecione mais trechos no livro e envie para a frente ou o verso.</p>
            <CardEditor prefill={prefill} injection={injection}
              sourceLabel={doc ? `${doc.title}, p. ${prefill?.sourcePage ?? page}` : undefined}
              onClose={() => setEditorOpen(false)} />
          </aside>
        )}
      </div>

      {sel && (
        <div className="sel-pop" style={{ left: sel.x, top: sel.y }} onMouseDown={(e) => e.preventDefault()}>
          {editorOpen ? (
            <>
              <button className="btn small" onClick={() => inject('front')}>→ Frente</button>
              <button className="btn small" onClick={() => inject('back')}>→ Verso</button>
              <button className="btn small primary" onClick={() => newCardFrom(sel.text, undefined, sel.page)}>⚡ Novo card</button>
            </>
          ) : (
            <button className="btn small primary" onClick={() => newCardFrom(sel.text, undefined, sel.page)}>⚡ Gerar flashcard</button>
          )}
        </div>
      )}
    </div>
  );
}
