import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import type { Highlight } from '../lib/types';
import { clearDocxHighlights, paintDocxHighlights, rangeHit } from '../lib/highlights';

/** Altura de uma "página" virtual do Word, para medir leitura e retomar posição. */
export const DOCX_PAGE_PX = 1100;

interface Props {
  data: ArrayBuffer;
  initialPage: number;
  zoom: number;
  goto: { page: number; nonce: number } | null;
  onPageChange: (page: number) => void;
  onPageCount: (n: number) => void;
  onError: (msg: string) => void;
  highlights: Highlight[];
  focusId: string | null;
  onHighlightClick: (h: Highlight, x: number, y: number) => void;
}

export default function DocxViewer({ data, initialPage, zoom, goto, onPageChange, onPageCount, onError, highlights, focusId, onHighlightClick }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const articleRef = useRef<HTMLElement>(null);
  const ranges = useRef(new Map<string, Range>());

  useEffect(() => {
    if (!html || !articleRef.current) return;
    ranges.current = paintDocxHighlights(articleRef.current, highlights, focusId);
  }, [html, highlights, focusId]);
  useEffect(() => clearDocxHighlights, []);

  // rola até o grifo em foco
  useEffect(() => {
    if (!html || !focusId) return;
    const t = window.setTimeout(() => {
      const r = ranges.current.get(focusId);
      const el = scrollRef.current;
      if (!r || !el) return;
      const top = r.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }, 150);
    return () => window.clearTimeout(t);
  }, [html, focusId]);

  function onClick(e: React.MouseEvent) {
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    for (const h of [...highlights].reverse()) {
      const r = ranges.current.get(h.id);
      if (r && rangeHit(r, e.clientX, e.clientY)) { onHighlightClick(h, e.clientX, e.clientY); return; }
    }
  }

  useEffect(() => {
    let alive = true;
    import('mammoth').then((m) => m.convertToHtml({ arrayBuffer: data.slice(0) }))
      .then((r) => alive && setHtml(DOMPurify.sanitize(r.value)))
      .catch((e) => onError(`Não consegui abrir o Word: ${e.message ?? e}`));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!html || !el) return;
    requestAnimationFrame(() => {
      onPageCount(Math.max(1, Math.ceil(el.scrollHeight / DOCX_PAGE_PX)));
      el.scrollTop = (initialPage - 1) * DOCX_PAGE_PX;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  useEffect(() => {
    if (goto && scrollRef.current) scrollRef.current.scrollTop = (goto.page - 1) * DOCX_PAGE_PX;
  }, [goto]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const page = Math.floor((el.scrollTop + el.clientHeight / 3) / DOCX_PAGE_PX) + 1;
    if (page !== last.current) { last.current = page; onPageChange(page); }
  }

  if (html === null) return <div className="viewer-scroll"><div className="center-pad"><div className="spinner" /></div></div>;
  return (
    <div ref={scrollRef} className="viewer-scroll" onScroll={onScroll}>
      <article ref={articleRef} onClick={onClick} className="docx-page" style={{ fontSize: `${zoom}rem` }} data-page="1" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
