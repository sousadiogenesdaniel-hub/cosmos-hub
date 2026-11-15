import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// versão "legacy": inclui substitutos para recursos novos (ex.: toHex) e roda em navegadores mais antigos
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { buildPage, type RawItem, type RPage } from './reflow';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy };

export function loadPdf(data: ArrayBuffer) {
  return pdfjs.getDocument({ data: data.slice(0) });
}

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<RPage>>>();

/** Texto da página organizado em parágrafos (com cache por documento). */
export function reflowPage(pdf: PDFDocumentProxy, num: number): Promise<RPage> {
  let m = cache.get(pdf);
  if (!m) { m = new Map(); cache.set(pdf, m); }
  let p = m.get(num);
  if (!p) {
    p = (async () => {
      const page = await pdf.getPage(num);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const raw: RawItem[] = [];
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const tx = pdfjs.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]) || it.height || 1;
        const w = it.width * vp.scale;
        raw.push({
          str: it.str,
          x: tx[4] / vp.width,
          y: (tx[5] - fh * 0.85) / vp.height,
          w: w / vp.width,
          h: (fh * 1.1) / vp.height,
          eol: it.hasEOL,
        });
      }
      return buildPage(num, raw);
    })();
    m.set(num, p);
  }
  return p;
}
