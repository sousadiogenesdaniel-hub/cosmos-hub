/** Data local no formato AAAA-MM-DD (o "dia de estudo" usa o fuso do navegador). */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return localDay(dt);
}

export function dayRange(endDay: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(endDay, -i));
  return out;
}

export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function fmtDayShort(day: string): string {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
}

export function fmtDayLong(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${String(min % 60).padStart(2, '0')}min`;
}

/** Intervalo legível, ex.: "10 min", "3 d", "2,5 m". */
export function fmtInterval(from: Date, to: Date): string {
  const mins = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)} h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} d`;
  if (days < 365) return `${(days / 30).toFixed(1).replace('.', ',')} m`;
  return `${(days / 365).toFixed(1).replace('.', ',')} a`;
}
