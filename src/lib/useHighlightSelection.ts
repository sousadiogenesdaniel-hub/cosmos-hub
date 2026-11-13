import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DocumentRow, Highlight } from './types';
import { listDocuments, listHighlights } from './api';
import { filterHighlights, readFilter } from './highlightFilter';
import { useAction } from './context';

/** Carrega grifos e arquivos e aplica os filtros que vieram na URL. */
export function useHighlightSelection() {
  const [params] = useSearchParams();
  const filter = useMemo(() => readFilter(params), [params]);
  const [data, setData] = useState<{ hls: Highlight[]; docs: DocumentRow[] } | null>(null);
  const run = useAction();

  useEffect(() => {
    run(() => Promise.all([listHighlights(filter.doc || undefined), listDocuments()]))
      .then((r) => setData(r ? { hls: r[0], docs: r[1] } : { hls: [], docs: [] }));
  }, [filter.doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const titleOf = (id: string) => data?.docs.find((d) => d.id === id)?.title ?? 'Arquivo';
  const list = useMemo(() => (data ? filterHighlights(data.hls, filter, titleOf) : null), [data, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  return { filter, list, docs: data?.docs ?? [], titleOf, setHls: (f: (h: Highlight[]) => Highlight[]) => setData((d) => (d ? { ...d, hls: f(d.hls) } : d)) };
}
