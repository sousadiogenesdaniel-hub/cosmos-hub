import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Highlight, HlRect } from '../lib/types';
import { reflowPage, type PDFDocumentProxy } from '../lib/pdf';
import { partCoverage, type RPage } from '../lib/reflow';

/** Páginas com menos texto que isto (figuras, páginas escaneadas) aparecem como imagem. */
const MIN_CHARS = 120;

interface Props {
  pdf: PDFDocumentProxy;
  initialPage: number;
  fontScale: number;
  goto: { page: number; nonce: number } | null;
  onPageChange: (page: number) => void;
  highlights: Highlight[];
  focusId: string | null;
  onHighlightClick: (h: Highlight, x: number, y: number) => void;
}

type PageHls = { id: string; color: string; rects: HlRect[] }[];

export default function ReflowViewer({ pdf, initialPage, fontScale, goto, onPageChange, highlights, focusId, onHighlightClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const n = pdf.numPages;

  const byPage = useMemo(() => {
    const m = new Map<number, PageHls>();
    for (const h of highlights) {
      for (const p of new Set((h.position.rects ?? []).map((r) => r.p))) {
        m.set(p, [...(m.get(p) ?? []), { id: h.id, color: h.color, rects: h.position.rects! }]);
      }
    }
    return m;
  }, [highlights]);

  const scrollToPage = (p: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${p}"]`);
    if (el && scrollRef.current) scrollRef.current.scrollTop = el.offsetTop - 8;
  };

  useEffect(() => { requestAnimationFrame(() => scrollToPage(Math.min(initialPage, n))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (goto) scrollToPage(goto.page); }, [goto]);

  // rola até o grifo em foco (a página dele pode ainda estar carregando)
  useEffect(() => {
    if (!focusId) return;
    let tries = 0;
    const t = window.setInterval(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-hl="${focusId}"]`);
      if (el || ++tries > 30) {
        window.clearInterval(t);
        if (el && scrollRef.current) {
          const top = el.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top + scrollRef.current.scrollTop;
          scrollRef.current.scrollTop = Math.max(0, top - scrollRef.current.clientHeight / 3);
        }
      }
    }, 150);
    return () => window.clearInterval(t);
  }, [focusId]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    let page = 1;
    for (const child of el.querySelectorAll<HTMLElement>('[data-page]')) {
      if (child.offsetTop <= mid) page = Number(child.dataset.page); else break;
    }
    if (page !== last.current) { last.current = page; onPageChange(page); }
  }

  function onClick(e: React.MouseEvent) {
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    const mark = (e.target as HTMLElement).closest<HTMLElement>('[data-hl]');
    const h = mark && highlights.find((x) => x.id === mark.dataset.hl);
    if (h) onHighlightClick(h, e.clientX, e.clientY);
  }

  return (
    <div ref={scrollRef} className="viewer-scroll reflow-scroll" onScroll={onScroll}>
      <div className="reflow" style={{ fontSize: `${(1.12 * fontScale).toFixed(3)}rem` }} onClick={onClick}>
        {Array.from({ length: n }, (_, i) => (
          <ReflowPage key={i + 1} pdf={pdf} num={i + 1} root={scrollRef} hls={byPage.get(i + 1)} focusId={focusId} />
        ))}
      </div>
    </div>
  );
}

const ReflowPage = memo(function ReflowPage({ pdf, num, root, hls, focusId }: {
  pdf: PDFDocumentProxy; num: number; root: React.RefObject<HTMLDivElement | null>; hls: PageHls | undefined; focusId: string | null;
}) {
  const ref = useRef<HTMLElement>(null);
  const [data, setData] = useState<RPage | null>(null);
  const [near, setNear] = useState(false);
  const [showImage, setShowImage] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || data) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true); }, { root: root.current, rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root, data]);

  useEffect(() => {
    if (!near || data) return;
    let alive = true;
    reflowPage(pdf, num).then((d) => alive && setData(d)).catch(() => {});
    return () => { alive = false; };
  }, [near, data, pdf, num]);

  const imageOnly = !!data && data.chars < MIN_CHARS;

  return (
    <section ref={ref} className={`reflow-page${data ? '' : ' loading'}`} data-page={num}>
      <div className="reflow-pagebar">
        <span>p. {num}</span>
        {data && !imageOnly && (
          <button type="button" className="btn small link" onClick={() => setShowImage(!showImage)}>
            {showImage ? 'Ocultar página original' : '🖼 Ver página original'}
          </button>
        )}
      </div>
      {(showImage || imageOnly) && <PageImage pdf={pdf} num={num} />}
      {imageOnly && <p className="muted small reflow-note">Página com pouco texto (figura, tabela ou página escaneada): mostrando a página original.</p>}
      {data && !imageOnly && data.blocks.map((b, bi) => {
        if (b.kind === 'fig') {
          return <button key={bi} type="button" className="fig-hint" onClick={() => setShowImage(true)}>🖼 Figura, tabela ou fórmula neste ponto · ver página original</button>;
        }
        const covers = b.parts.map((part) => (hls ? partCoverage(num, data.items[part.i], part.text, hls) : null));
        const content = b.parts.map((part, pi) => {
          // o espaço entre dois pedaços do mesmo grifo também fica pintado
          const prev = covers[pi - 1];
          const cur = covers[pi];
          const join = prev && cur && prev[prev.length - 1] && prev[prev.length - 1] === cur[0] ? cur[0] : null;
          return <Part key={pi} part={part} item={data.items[part.i]} cover={cur} sepHl={join} hls={hls} focusId={focusId} />;
        });
        return b.kind === 'h'
          ? <h3 key={bi} data-b={bi}>{content}</h3>
          : <p key={bi} data-b={bi} className={b.kind === 'f' ? 'reflow-formula' : undefined}>{content}</p>;
      })}
    </section>
  );
});

function Part({ part, item, cover, sepHl, hls, focusId }: {
  part: RPage['blocks'][number]['parts'][number]; item: RPage['items'][number]; cover: (string | null)[] | null;
  sepHl: string | null; hls: PageHls | undefined; focusId: string | null;
}) {
  const segs: { text: string; hl: string | null }[] = [];
  if (!cover) segs.push({ text: part.text, hl: null });
  else for (let j = 0; j < part.text.length; j++) {
    const last = segs[segs.length - 1];
    if (last && last.hl === cover[j]) last.text += part.text[j];
    else segs.push({ text: part.text[j], hl: cover[j] });
  }
  const mark = (id: string, text: string, key?: number) => {
    const color = hls!.find((h) => h.id === id)!.color;
    return <mark key={key} data-hl={id} className={`hl-mark hl-${color}${id === focusId ? ' hl-flash' : ''}`}>{text}</mark>;
  };
  return (
    <>
      {part.sep && (sepHl ? mark(sepHl, part.sep) : part.sep)}
      <span data-r={`${item.x},${item.y},${item.w},${item.h}`}>
        {segs.map((s, k) => (s.hl ? mark(s.hl, s.text, k) : s.text))}
      </span>
    </>
  );
}

/** A página original como imagem, na largura da coluna de leitura. */
export function PageImage({ pdf, num, focusY, zoomable }: { pdf: PDFDocumentProxy; num: number; focusY?: number; zoomable?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let alive = true;
    (async () => {
      const page = await pdf.getPage(num);
      const canvas = ref.current;
      if (!alive || !canvas) return;
      const cssW = canvas.parentElement?.clientWidth || 600;
      const vp1 = page.getViewport({ scale: 1 });
      const scale = (cssW / vp1.width) * Math.min(window.devicePixelRatio || 1, 2.5) * (zoomable ? 1.5 : 1);
      const vp = page.getViewport({ scale });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp });
      await task.promise.catch(() => {});
      // rola até a figura/fórmula que motivou a parada
      const box = canvas.parentElement?.parentElement;
      if (alive && focusY != null && box) box.scrollTop = Math.max(0, focusY * canvas.clientHeight - box.clientHeight / 2);
    })();
    return () => { alive = false; task?.cancel(); };
  }, [pdf, num, focusY, zoomable]);
  return (
    <div className={`reflow-image${zoom ? ' zoomed' : ''}`} onClick={zoomable ? () => setZoom(!zoom) : undefined} title={zoomable ? 'Toque para ampliar/reduzir' : undefined}>
      <canvas ref={ref} />
      {focusY != null && focusY > 0 && <span className="focus-marker" style={{ top: `${focusY * 100}%` }} aria-hidden>◀</span>}
    </div>
  );
}

/** Converte uma seleção no modo leitura em retângulos da página original. */
export function reflowRectsFromRange(range: Range, root: HTMLElement): HlRect[] {
  const out: HlRect[] = [];
  for (const span of root.querySelectorAll<HTMLElement>('.reflow-page span[data-r]')) {
    if (!range.intersectsNode(span)) continue;
    const text = span.textContent ?? '';
    const len = text.length;
    if (!len) continue;
    const off = (node: Node, offset: number) => {
      const r = document.createRange();
      r.setStart(span, 0);
      r.setEnd(node, offset);
      return r.toString().length;
    };
    const a = span.contains(range.startContainer) ? off(range.startContainer, range.startOffset) : 0;
    const b = span.contains(range.endContainer) ? off(range.endContainer, range.endOffset) : len;
    if (b <= a) continue;
    const page = Number(span.closest<HTMLElement>('[data-page]')?.dataset.page);
    const [x, y, w, h] = (span.dataset.r ?? '').split(',').map(Number);
    if (!page || [x, y, w, h].some(isNaN)) continue;
    out.push({ p: page, x: x + (w * a) / len, y, w: (w * (b - a)) / len, h });
  }
  return out;
}
