import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// versão legacy: inclui substitutos para recursos novos (ex.: toHex) e roda em navegadores mais antigos
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Highlight } from '../lib/types';
import { hitRect } from '../lib/highlights';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  data: ArrayBuffer;
  initialPage: number;
  zoom: number; // multiplicador sobre "caber na largura"
  cropMode: boolean;
  goto: { page: number; nonce: number } | null;
  onPageChange: (page: number) => void;
  onPageCount: (n: number) => void;
  onCrop: (blob: Blob, page: number) => void;
  onError: (msg: string) => void;
  highlights: Highlight[];
  focusId: string | null;
  onHighlightClick: (h: Highlight, x: number, y: number) => void;
}

const NO_HL: Highlight[] = [];

export default function PdfViewer({ data, initialPage, zoom, cropMode, goto, onPageChange, onPageCount, onCrop, onError, highlights, focusId, onHighlightClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const scrolledInitially = useRef(false);
  const lastReported = useRef(0);

  useEffect(() => {
    let destroyed = false;
    const task = pdfjs.getDocument({ data: data.slice(0) });
    task.promise.then(async (doc) => {
      if (destroyed) return;
      const p1 = await doc.getPage(1);
      const vp = p1.getViewport({ scale: 1 });
      setBase({ w: vp.width, h: vp.height });
      setPdf(doc);
      onPageCount(doc.numPages);
    }).catch((e) => onError(`Não consegui abrir o PDF: ${e.message ?? e}`));
    return () => { destroyed = true; task.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // escala "caber na largura"
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !base) return;
    const update = () => setFitScale(Math.min(1.5, Math.max(0.3, (el.clientWidth - 32) / base.w)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [base]);

  const scale = fitScale * zoom;

  // mantém a posição relativa ao mudar o zoom
  const prevScale = useRef(scale);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && prevScale.current !== scale && prevScale.current > 0) {
      el.scrollTop = el.scrollTop * (scale / prevScale.current);
    }
    prevScale.current = scale;
  }, [scale]);

  const byPage = useMemo(() => {
    const m = new Map<number, Highlight[]>();
    for (const h of highlights) {
      for (const p of new Set((h.position.rects ?? []).map((r) => r.p))) m.set(p, [...(m.get(p) ?? []), h]);
    }
    return m;
  }, [highlights]);

  const pageH = base ? base.h * scale : 0;
  const GAP = 16;

  useEffect(() => {
    if (!pdf || !base || scrolledInitially.current || !scrollRef.current) return;
    scrolledInitially.current = true;
    scrollRef.current.scrollTop = (Math.min(initialPage, pdf.numPages) - 1) * (pageH + GAP);
  }, [pdf, base, initialPage, pageH]);

  useEffect(() => {
    if (!goto || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-page="${goto.page}"]`) as HTMLElement | null;
    if (el) scrollRef.current.scrollTop = el.offsetTop - 8;
  }, [goto]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el || !pdf) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let page = 1;
    for (const child of el.querySelectorAll<HTMLElement>('[data-page]')) {
      if (child.offsetTop <= mid) page = Number(child.dataset.page); else break;
    }
    if (page !== lastReported.current) { lastReported.current = page; onPageChange(page); }
  }

  if (!pdf || !base) return <div className="viewer-scroll"><div className="center-pad"><div className="spinner" /></div></div>;

  return (
    <div ref={scrollRef} className={`viewer-scroll${cropMode ? ' crop-mode' : ''}`} onScroll={onScroll}>
      <div className="pdf-pages">
        {Array.from({ length: pdf.numPages }, (_, i) => (
          <PdfPage key={i + 1} pdf={pdf} num={i + 1} scale={scale} baseW={base.w} baseH={base.h} root={scrollRef} cropMode={cropMode} onCrop={onCrop}
            hls={byPage.get(i + 1) ?? NO_HL} focusId={focusId} onHighlightClick={onHighlightClick} />
        ))}
      </div>
    </div>
  );
}

interface PageProps {
  pdf: PDFDocumentProxy;
  num: number;
  scale: number;
  baseW: number;
  baseH: number;
  root: React.RefObject<HTMLDivElement | null>;
  cropMode: boolean;
  onCrop: (blob: Blob, page: number) => void;
  hls: Highlight[];
  focusId: string | null;
  onHighlightClick: (h: Highlight, x: number, y: number) => void;
}

const PdfPage = memo(function PdfPage({ pdf, num, scale, baseW, baseH, root, cropMode, onCrop, hls, focusId, onHighlightClick }: PageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: baseW, h: baseH });
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: root.current, rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: { cancel: () => void } | null = null;
    (async () => {
      const page = await pdf.getPage(num);
      if (cancelled) return;
      const vp1 = page.getViewport({ scale: 1 });
      setSize({ w: vp1.width, h: vp1.height });
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      const ctx = canvas.getContext('2d')!;
      renderTask = page.render({ canvas, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try { await renderTask.promise; } catch { return; }
      if (cancelled || !textRef.current) return;
      textRef.current.replaceChildren();
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport });
      textLayer = tl;
      await tl.render().catch(() => {});
      const end = document.createElement('div');
      end.className = 'endOfContent';
      textRef.current?.append(end);
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [visible, scale, pdf, num]);

  // libera memória de páginas longe da tela
  useEffect(() => {
    if (visible) return;
    const c = canvasRef.current;
    if (c) { c.width = 0; c.height = 0; }
    textRef.current?.replaceChildren();
  }, [visible]);

  const w = size.w * scale;
  const h = size.h * scale;

  function point(e: RPointerEvent) {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(w, e.clientX - r.left)), y: Math.max(0, Math.min(h, e.clientY - r.top)) };
  }

  function finishCrop() {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const cw = Math.abs(drag.x1 - drag.x0), ch = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (cw < 12 || ch < 12) return;
    const src = canvasRef.current!;
    const k = src.width / w;
    const out = document.createElement('canvas');
    out.width = Math.round(cw * k); out.height = Math.round(ch * k);
    out.getContext('2d')!.drawImage(src, x * k, y * k, cw * k, ch * k, 0, 0, out.width, out.height);
    out.toBlob((b) => b && onCrop(b, num), 'image/png');
  }

  // clique (sem seleção) em cima de um grifo abre as opções dele
  function onClick(e: React.MouseEvent) {
    if (cropMode || !hls.length) return;
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    const r = wrapRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const hit = [...hls].reverse().find((h) => hitRect(h.position.rects, num, x, y));
    if (hit) onHighlightClick(hit, e.clientX, e.clientY);
  }

  return (
    <div ref={wrapRef} className={`pdf-page${hls.length ? ' has-hl' : ''}`} data-page={num} onClick={onClick}
      style={{ width: w, height: h, ['--scale-factor' as string]: scale, ['--total-scale-factor' as string]: scale }}>
      <canvas ref={canvasRef} style={{ width: w, height: h }} />
      {hls.length > 0 && (
        <div className="hl-layer" aria-hidden>
          {hls.flatMap((hl) => (hl.position.rects ?? []).filter((r) => r.p === num).map((r, i) => (
            <div key={`${hl.id}-${i}`} className={`hl hl-${hl.color}${hl.id === focusId ? ' hl-flash' : ''}`}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
          )))}
        </div>
      )}
      <div ref={textRef} className="textLayer" />
      {cropMode && (
        <div className="crop-overlay"
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const p = point(e); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
          onPointerMove={(e) => { if (drag) { const p = point(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
          onPointerUp={finishCrop}>
          {drag && (
            <div className="crop-rect" style={{
              left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1),
              width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0),
            }} />
          )}
        </div>
      )}
      <span className="page-num">{num}</span>
    </div>
  );
});
