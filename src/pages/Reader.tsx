import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DocumentRow, Highlight, HighlightColor } from '../lib/types';
import { createHighlight, downloadFile, getDocument, listHighlights, updateDocument } from '../lib/api';
import { caretAt, docxPositionFromRange, mergeRects, pdfRectsFromRange, rangeText, showPending, spanRange, wordRangeAt } from '../lib/highlights';
import { loadPdf, reflowPage, type PDFDocumentProxy } from '../lib/pdf';
import { contentBox } from '../lib/reflow';
import HighlightPopover, { ColorDots } from '../components/HighlightPopover';
import { useApp, useAction } from '../lib/context';
import { useReadingTracker } from '../lib/useReadingTracker';
import PdfViewer from '../components/PdfViewer';
import ReflowViewer, { reflowRectsFromRange } from '../components/ReflowViewer';
import DocxViewer from '../components/DocxViewer';
import CardEditor, { type Injection, type Prefill } from '../components/CardEditor';

interface Sel { text: string; page: number; x: number; y: number }
type Mode = 'original' | 'reflow';

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

// preferências deste aparelho
function pref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}
function savePref(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}
const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 760;

export default function Reader() {
  const { docId } = useParams();
  const [params] = useSearchParams();
  const { toast } = useApp();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [data, setData] = useState<ArrayBuffer | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fontScale, setFontScale] = useState(() => Number(pref('cosmos:reflowFont', '1')) || 1);
  const [mode, setMode] = useState<Mode>(() => pref<Mode>('cosmos:pdfMode', isNarrow() ? 'reflow' : 'original'));
  const [trim, setTrim] = useState(() => pref<string>('cosmos:pdfTrim', 'off') === 'on');
  const [cropBox, setCropBox] = useState<{ x0: number; x1: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [goto, setGoto] = useState<{ page: number; nonce: number } | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill | undefined>(undefined);
  const [injection, setInjection] = useState<Injection | null>(null);
  const [gotoInput, setGotoInput] = useState('');
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [hlPop, setHlPop] = useState<{ hl: Highlight; x: number; y: number } | null>(null);
  const [endDismissed, setEndDismissed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [marker, setMarker] = useState(false);
  const [markerColor, setMarkerColor] = useState<HighlightColor>(() => pref<HighlightColor>('cosmos:markerColor', 'yellow'));
  const [pending, setPending] = useState<{ range: Range; word: string } | null>(null);
  const run = useAction();
  const focusId = params.get('hl');
  const viewerRef = useRef<HTMLDivElement>(null);
  const startPage = Number(params.get('page')) || 0;

  useEffect(() => {
    if (!docId) return;
    (async () => {
      try {
        const d = await getDocument(docId);
        setDoc(d);
        setPage(startPage || d.last_page || 1);
        listHighlights(d.id).then(setHighlights).catch(() => {});
        setData(await downloadFile(d.file_path));
        updateDocument(d.id, { last_opened_at: new Date().toISOString() }).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [docId, startPage]);

  // o PDF é aberto uma vez e compartilhado pelos dois modos
  useEffect(() => {
    if (!data || doc?.file_type !== 'pdf') return;
    const task = loadPdf(data);
    task.promise.then((p) => { setPdf(p); onPageCount(p.numPages); })
      .catch((e) => setError(`Não consegui abrir o PDF: ${e.message ?? e}`));
    return () => { task.destroy(); };
  }, [data, doc?.file_type]); // eslint-disable-line react-hooks/exhaustive-deps

  // corte de margens: mede a coluna de texto em algumas páginas
  useEffect(() => {
    if (!pdf || !trim || cropBox) return;
    const n = pdf.numPages;
    const sample = [3, 4, 5, 6, 7, 8].filter((p) => p <= n);
    Promise.all((sample.length ? sample : [1]).map((p) => reflowPage(pdf, p))).then((pages) => {
      const box = contentBox(pages);
      if (box) setCropBox(box);
      else { toast('Não encontrei margens para cortar neste arquivo.'); setTrim(false); }
    });
  }, [pdf, trim, cropBox, toast]);

  useReadingTracker(doc?.id, page);

  useEffect(() => {
    if (!doc) return;
    const t = window.setTimeout(() => updateDocument(doc.id, { last_page: page }).catch(() => {}), 1500);
    return () => window.clearTimeout(t);
  }, [doc, page]);

  const onPageCount = useCallback((n: number) => {
    setPageCount(n);
    setDoc((d) => {
      if (d && d.page_count !== n) updateDocument(d.id, { page_count: n }).catch(() => {});
      return d;
    });
  }, []);

  // seleção de texto dentro do leitor
  useEffect(() => {
    let t = 0;
    const check = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const s = window.getSelection();
        if (marker || !s || s.isCollapsed || !s.rangeCount) { setSel(null); return; }
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
          x: Math.min(Math.max(rect.left + rect.width / 2, host.left + 130), host.right - 130),
          y: rect.top < host.top + 60 ? Math.min(rect.bottom + 8, host.bottom - 60) : rect.top - 52,
        });
      }, 120);
    };
    document.addEventListener('selectionchange', check);
    return () => { document.removeEventListener('selectionchange', check); window.clearTimeout(t); };
  }, [doc, page, marker]);

  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    setSel(null);
  }

  function newCardFrom(text?: string, image?: Blob, p?: number) {
    setPrefill({ front: text, image, sourceDocumentId: doc?.id, sourcePage: p ?? page });
    setEditorOpen(true);
    clearSelection();
  }

  /** Grava um grifo a partir de um trecho do documento (vale para os 3 visualizadores). */
  async function highlightRange(range: Range, text: string, color: HighlightColor, fallbackPage: number) {
    const root = viewerRef.current;
    if (!doc || !root) return;
    let position: Highlight['position'] | null = null;
    if (doc.file_type === 'pdf') {
      const rects = mode === 'reflow' ? mergeRects(reflowRectsFromRange(range, root)) : pdfRectsFromRange(range, root);
      if (rects.length) position = { rects };
    } else {
      const article = root.querySelector<HTMLElement>('.docx-page');
      if (article) position = docxPositionFromRange(range, article);
    }
    if (!position || !text) { toast('Não consegui marcar esse trecho. Tente de novo.', 'error'); return; }
    const p = position.rects ? Math.min(...position.rects.map((r) => r.p)) : fallbackPage;
    const h = await run(() => createHighlight({ document_id: doc.id, page: p, text, color, position: position! }));
    if (h) setHighlights((list) => [...list, h]);
  }

  async function addHighlight(color: HighlightColor) {
    const s = window.getSelection();
    if (!sel || !s || !s.rangeCount) return;
    const range = s.getRangeAt(0).cloneRange();
    const { text, page: p } = sel;
    clearSelection();
    await highlightRange(range, text, color, p);
  }

  // ---------- marca-texto por toque: 1º toque = início, 2º toque = fim
  function cancelPending() { setPending(null); showPending(null); }

  function onViewerClickCapture(e: React.MouseEvent) {
    if (!marker) return;
    e.preventDefault();
    e.stopPropagation();
    const c = caretAt(e.clientX, e.clientY);
    const root = viewerRef.current;
    if (!c || !root?.contains(c.node)) return;
    const word = wordRangeAt(c.node, c.offset);
    if (!word) return;
    if (!pending) {
      setPending({ range: word, word: word.toString() });
      showPending(word);
      return;
    }
    const range = spanRange(pending.range, word);
    cancelPending();
    const text = cleanSelection(rangeText(range));
    const anchor = (range.startContainer.parentElement)?.closest('[data-page]') as HTMLElement | null;
    highlightRange(range, text, markerColor, Number(anchor?.dataset.page ?? page));
  }

  function toggleMarker() {
    cancelPending();
    clearSelection();
    setCropMode(false);
    setMarker((m) => !m);
  }

  useEffect(() => () => showPending(null), []);

  const onHighlightClick = useCallback((hl: Highlight, x: number, y: number) => setHlPop({ hl, x, y }), []);

  async function setFinished(done: boolean) {
    if (!doc) return;
    const finished_at = done ? new Date().toISOString() : null;
    const ok = await run(() => updateDocument(doc.id, { finished_at }).then(() => true), done ? 'Marcado como LIDO! 🎉' : 'Desmarcado');
    if (ok) setDoc({ ...doc, finished_at });
  }

  function switchMode(m: Mode) {
    clearSelection();
    cancelPending();
    setCropMode(false);
    setMode(m);
    savePref('cosmos:pdfMode', m);
  }

  function toggleTrim() {
    const v = !trim;
    setTrim(v);
    savePref('cosmos:pdfTrim', v ? 'on' : 'off');
    setMenuOpen(false);
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

  function changeZoom(delta: number | null) {
    if (reflow) {
      const v = delta === null ? 1 : Math.min(2.2, Math.max(0.7, +(fontScale + delta).toFixed(2)));
      setFontScale(v);
      savePref('cosmos:reflowFont', String(v));
    } else setZoom((z) => (delta === null ? 1 : Math.min(3, Math.max(0.5, +(z + delta).toFixed(2)))));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setCropMode(false); cancelPending(); setMenuOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  if (error) return <div className="center-screen"><div className="panel narrow"><p className="error-text">{error}</p><Link className="btn" to="/biblioteca">← Voltar à biblioteca</Link></div></div>;

  const isPdf = doc?.file_type === 'pdf';
  const reflow = isPdf && mode === 'reflow';
  const pageLabel = isPdf ? 'Página' : 'Página aprox.';
  const atEnd = !!pageCount && page >= pageCount;
  const hlProps = { highlights, focusId, onHighlightClick };
  const zoomValue = reflow ? fontScale : zoom;

  return (
    <div className={`reader${editorOpen ? ' with-editor' : ''}${marker ? ' marking' : ''}`}>
      <header className="reader-bar">
        <Link to="/biblioteca" className="icon-btn" title="Voltar à biblioteca">←</Link>
        <div className="reader-title" title={doc?.title}>
          {doc?.title ?? 'Carregando…'}
          {doc?.finished_at && <button className="lido-badge" title="Clique para desmarcar" onClick={() => setFinished(false)}>LIDO!</button>}
        </div>
        <div className="reader-tools">
          <form className="page-jump" onSubmit={(e) => { e.preventDefault(); jump(); }}>
            <span className="muted small hide-sm">{pageLabel}</span>
            <input value={gotoInput} onChange={(e) => setGotoInput(e.target.value.replace(/\D/g, ''))} placeholder={String(page)} aria-label="Ir para página" inputMode="numeric" />
            <span className="muted small">/ {pageCount ?? '…'}</span>
          </form>
          {isPdf && (
            <div className="btn-group" role="group" aria-label="Modo de leitura">
              <button className={`btn small ${mode === 'original' ? 'primary' : 'ghost'}`} onClick={() => switchMode('original')} title="Página original do PDF">📄<span className="hide-sm"> Original</span></button>
              <button className={`btn small ${mode === 'reflow' ? 'primary' : 'ghost'}`} onClick={() => switchMode('reflow')} title="Texto corrido, com letra ajustável (ideal no celular)">📖<span className="hide-sm"> Leitura</span></button>
            </div>
          )}
          <div className="btn-group">
            <button className="btn small ghost" onClick={() => changeZoom(-0.1)} title={reflow ? 'Diminuir letra' : 'Diminuir zoom'}>{reflow ? 'A−' : '−'}</button>
            <button className="btn small ghost hide-sm" onClick={() => changeZoom(null)} title="Tamanho padrão">{Math.round(zoomValue * 100)}%</button>
            <button className="btn small ghost" onClick={() => changeZoom(0.1)} title={reflow ? 'Aumentar letra' : 'Aumentar zoom'}>{reflow ? 'A+' : '+'}</button>
          </div>
          <button className={`btn small ${marker ? 'primary' : 'ghost'}`} onClick={toggleMarker} title="Marca-texto: toque na primeira e na última palavra">
            🖍<span className="hide-sm"> Marca-texto</span>
          </button>
          <span className="menu-wrap">
            <button className="btn small ghost" onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }} aria-label="Mais opções">⋯{highlights.length > 0 && <span className="pill">{highlights.length}</span>}</button>
            {menuOpen && (
              <div className="menu" onClick={(e) => e.stopPropagation()}>
                {doc && <Link className="menu-item" to={`/biblioteca?tab=grifos&doc=${doc.id}`}>🗂 Ver grifos deste arquivo ({highlights.length})</Link>}
                {isPdf && !reflow && (
                  <button onClick={() => { setMenuOpen(false); setMarker(false); setCropMode(true); }}>✂ Recortar área para um card</button>
                )}
                {isPdf && !reflow && <button onClick={toggleTrim}>{trim ? '↔ Mostrar margens' : '↔ Cortar margens brancas'}</button>}
                {doc && !doc.finished_at && <button onClick={() => { setMenuOpen(false); setFinished(true); }}>✓ Marcar como LIDO!</button>}
              </div>
            )}
          </span>
          <button className="btn small primary" onClick={() => newCardFrom()}>＋<span className="hide-sm"> Novo card</span></button>
        </div>
        {marker && (
          <div className="marker-bar">
            <ColorDots value={markerColor} title="Cor do marca-texto" onPick={(c) => { setMarkerColor(c); savePref('cosmos:markerColor', c); }} />
            <span className="small">{pending ? <>Início: <strong>“{pending.word}”</strong>. Agora toque na <strong>última</strong> palavra.</> : <>Toque na <strong>primeira</strong> palavra do trecho.</>}</span>
            {pending && <button className="btn small link" onClick={cancelPending}>Recomeçar</button>}
            <button className="btn small ghost" onClick={toggleMarker}>Concluir</button>
          </div>
        )}
        {cropMode && (
          <div className="marker-bar">
            <span className="small">✂ Arraste um retângulo sobre a página para usar como imagem no card.</span>
            <button className="btn small ghost" onClick={() => setCropMode(false)}>Cancelar</button>
          </div>
        )}
      </header>

      <div className="reader-body">
        <div className="viewer" ref={viewerRef} onClickCapture={onViewerClickCapture}>
          {doc && isPdf && pdf && (reflow ? (
            <ReflowViewer key="reflow" pdf={pdf} initialPage={page} fontScale={fontScale} goto={goto} onPageChange={setPage} {...hlProps} />
          ) : (
            <PdfViewer key={`orig-${trim && cropBox ? 'crop' : 'full'}`} pdf={pdf} crop={trim ? cropBox : null} initialPage={page} zoom={zoom}
              cropMode={cropMode} goto={goto} onPageChange={setPage} onCrop={onCrop} {...hlProps} />
          ))}
          {doc && !isPdf && data && (
            <DocxViewer data={data} initialPage={page} zoom={zoom} goto={goto}
              onPageChange={setPage} onPageCount={onPageCount} onError={setError} {...hlProps} />
          )}
          {(!data || (isPdf && !pdf)) && !error && <div className="center-pad"><div className="spinner" /><p className="muted">Baixando arquivo…</p></div>}
          {atEnd && doc && !doc.finished_at && !endDismissed && (
            <div className="end-banner">
              <span>🎉 Você chegou ao fim do arquivo.</span>
              <button className="btn small primary" onClick={() => setFinished(true)}>Marcar como LIDO!</button>
              <button className="icon-btn" onClick={() => setEndDismissed(true)} aria-label="Agora não">✕</button>
            </div>
          )}
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

      {sel && !marker && (
        <div className="sel-pop" style={{ left: sel.x, top: sel.y }} onMouseDown={(e) => e.preventDefault()}>
          <ColorDots onPick={addHighlight} />
          <span className="sel-sep" />
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
      {hlPop && (
        <HighlightPopover hl={hlPop.hl} x={hlPop.x} y={hlPop.y}
          onChange={(h) => { setHighlights((l) => l.map((x) => (x.id === h.id ? h : x))); setHlPop((p) => (p ? { ...p, hl: h } : p)); }}
          onDeleted={(id) => setHighlights((l) => l.filter((x) => x.id !== id))}
          onCard={(h) => newCardFrom(h.text, undefined, h.page)}
          onClose={() => setHlPop(null)} />
      )}
    </div>
  );
}
