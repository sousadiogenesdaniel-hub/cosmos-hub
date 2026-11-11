import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';

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
}

export default function DocxViewer({ data, initialPage, zoom, goto, onPageChange, onPageCount, onError }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = useRef(0);

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
      <article className="docx-page" style={{ fontSize: `${zoom}rem` }} data-page="1" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
