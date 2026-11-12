import { supabase, BUCKET } from './supabase';
import { cardOrds } from './cards';
import { localDay } from './dates';
import type { CardRow, DailyMust, Deck, DocumentRow, Highlight, Note, NoteType, Profile, ReadingLog, ReviewLog } from './types';
import type { SchedulingFields } from './srs';

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** O Supabase devolve no máximo 1000 linhas por vez; isto busca tudo em páginas. */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const rows = check(await build(from, from + page - 1));
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Sessão expirada — entre novamente.');
  return id;
}

// ---------------------------------------------------------------- Perfil
export async function getProfile(): Promise<Profile> {
  const id = await uid();
  const existing = check(await supabase.from('profiles').select('*').eq('id', id).maybeSingle());
  if (existing) return existing as Profile;
  return check(await supabase.from('profiles').insert({ id }).select('*').single()) as Profile;
}

export async function updateProfile(patch: Partial<Profile>): Promise<Profile> {
  const id = await uid();
  return check(await supabase.from('profiles').update(patch).eq('id', id).select('*').single()) as Profile;
}

// ------------------------------------------------------------- Storage
export async function uploadFile(folder: string, blob: Blob, ext: string): Promise<string> {
  const path = `${await uid()}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || undefined, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function removeFiles(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => !!p);
  if (list.length) await supabase.storage.from(BUCKET).remove(list);
}

const urlCache = new Map<string, { url: string; exp: number }>();
export async function signedUrl(path: string): Promise<string> {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? 'Falha ao abrir arquivo');
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

export async function downloadFile(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? 'Falha ao baixar arquivo');
  return data.arrayBuffer();
}

// ---------------------------------------------------------- Documentos
export async function listDocuments(): Promise<DocumentRow[]> {
  return check(await supabase.from('documents').select('*').order('created_at', { ascending: false })) as DocumentRow[];
}

export async function getDocument(id: string): Promise<DocumentRow> {
  return check(await supabase.from('documents').select('*').eq('id', id).single()) as DocumentRow;
}

export async function createDocument(file: File, meta: { title: string; kind: string; subject: string | null; tags: string[] }): Promise<DocumentRow> {
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const ext = isPdf ? 'pdf' : 'docx';
  const path = await uploadFile('docs', file, ext);
  return check(await supabase.from('documents').insert({
    ...meta, file_path: path, file_type: ext, size_bytes: file.size,
  }).select('*').single()) as DocumentRow;
}

export async function updateDocument(id: string, patch: Partial<DocumentRow>) {
  check(await supabase.from('documents').update(patch).eq('id', id));
}

export async function deleteDocument(doc: DocumentRow) {
  check(await supabase.from('documents').delete().eq('id', doc.id));
  await removeFiles([doc.file_path]);
}

export async function logReading(documentId: string, page: number, seconds: number) {
  const { error } = await supabase.rpc('log_reading', { p_document: documentId, p_page: page, p_day: localDay(), p_seconds: Math.round(seconds) });
  if (error) console.warn('log_reading', error.message);
}

// --------------------------------------------------------------- Decks
export async function listDecks(): Promise<Deck[]> {
  return check(await supabase.from('decks').select('*').order('name')) as Deck[];
}

export async function createDeck(name: string, parentId: string | null): Promise<Deck> {
  return check(await supabase.from('decks').insert({ name, parent_id: parentId }).select('*').single()) as Deck;
}

export async function updateDeck(id: string, patch: Partial<Deck>) {
  check(await supabase.from('decks').update(patch).eq('id', id));
}

export async function deleteDeck(id: string, allDecks: Deck[]) {
  // apaga arquivos de mídia das notas do deck e subdecks antes de apagar o deck
  const ids = subtreeIds(id, allDecks);
  const notes = await fetchAll<Pick<Note, 'front_audio' | 'back_audio' | 'front_image'>>((f, t) =>
    supabase.from('notes').select('front_audio,back_audio,front_image').in('deck_id', ids).range(f, t));
  await removeFiles(notes.flatMap((n) => [n.front_audio, n.back_audio, n.front_image]));
  check(await supabase.from('decks').delete().eq('id', id));
}

/** IDs do deck e de todos os subdecks. */
export function subtreeIds(rootId: string, decks: Deck[]): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const d of decks) if (d.parent_id === out[i]) out.push(d.id);
  return out;
}

export function deckPath(id: string | null, decks: Deck[]): string {
  const parts: string[] = [];
  let cur = decks.find((d) => d.id === id);
  while (cur) { parts.unshift(cur.name); cur = decks.find((d) => d.id === cur!.parent_id); }
  return parts.join(' › ');
}

export function rootDeckId(id: string | null, decks: Deck[]): string | null {
  let cur = decks.find((d) => d.id === id);
  while (cur?.parent_id) cur = decks.find((d) => d.id === cur!.parent_id);
  return cur?.id ?? null;
}

// --------------------------------------------------------- Notas/cards
export interface NoteInput {
  deck_id: string;
  type: NoteType;
  front: string;
  back: string;
  front_audio: string | null;
  back_audio: string | null;
  front_image: string | null;
  youtube_url: string | null;
  youtube_start: number | null;
  source_document_id: string | null;
  source_page: number | null;
}

export async function createNote(input: NoteInput): Promise<Note> {
  const note = check(await supabase.from('notes').insert(input).select('*').single()) as Note;
  const ords = cardOrds(input.type, input.front);
  if (ords.length) {
    check(await supabase.from('cards').insert(ords.map((ord) => ({ note_id: note.id, deck_id: input.deck_id, ord }))));
  }
  return note;
}

/** Atualiza a nota e sincroniza os cards (cria/remove lacunas ou o card invertido). */
export async function updateNote(id: string, input: NoteInput, previous: Note): Promise<Note> {
  const note = check(await supabase.from('notes').update({ ...input, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()) as Note;
  const existing = check(await supabase.from('cards').select('id,ord').eq('note_id', id)) as { id: string; ord: number }[];
  const wanted = new Set(cardOrds(input.type, input.front));
  const have = new Set(existing.map((c) => c.ord));
  const toAdd = [...wanted].filter((o) => !have.has(o));
  const toRemove = existing.filter((c) => !wanted.has(c.ord)).map((c) => c.id);
  if (toAdd.length) check(await supabase.from('cards').insert(toAdd.map((ord) => ({ note_id: id, deck_id: input.deck_id, ord }))));
  if (toRemove.length) check(await supabase.from('cards').delete().in('id', toRemove));
  if (input.deck_id !== previous.deck_id) check(await supabase.from('cards').update({ deck_id: input.deck_id }).eq('note_id', id));
  const replaced = (['front_audio', 'back_audio', 'front_image'] as const)
    .filter((k) => previous[k] && previous[k] !== input[k]).map((k) => previous[k]);
  await removeFiles(replaced);
  return note;
}

export async function deleteNote(note: Note) {
  check(await supabase.from('notes').delete().eq('id', note.id));
  await removeFiles([note.front_audio, note.back_audio, note.front_image]);
}

export async function listNotes(deckIds: string[]): Promise<Note[]> {
  return fetchAll<Note>((f, t) => supabase.from('notes').select('*').in('deck_id', deckIds).order('created_at', { ascending: false }).range(f, t));
}

export async function getNotes(ids: string[]): Promise<Note[]> {
  const out: Note[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    out.push(...(check(await supabase.from('notes').select('*').in('id', ids.slice(i, i + 200))) as Note[]));
  }
  return out;
}

export async function listAllCards(): Promise<CardRow[]> {
  return fetchAll<CardRow>((f, t) => supabase.from('cards').select('*').order('created_at').order('ord').range(f, t));
}

export async function listCards(deckIds: string[]): Promise<CardRow[]> {
  return fetchAll<CardRow>((f, t) => supabase.from('cards').select('*').in('deck_id', deckIds).order('created_at').order('ord').range(f, t));
}

export async function setNoteSuspended(noteId: string, suspended: boolean) {
  check(await supabase.from('cards').update({ suspended }).eq('note_id', noteId));
}

export async function saveReview(card: CardRow, next: SchedulingFields, rating: number, durationMs: number, mode: 'normal' | 'audio') {
  check(await supabase.from('cards').update(next).eq('id', card.id));
  check(await supabase.from('review_logs').insert({
    card_id: card.id, deck_id: card.deck_id, rating, state_before: card.state,
    duration_ms: Math.round(durationMs), mode, day: localDay(),
  }));
}

// ------------------------------------------------------------- Métricas
export async function listReviewLogs(sinceDay: string): Promise<ReviewLog[]> {
  return fetchAll<ReviewLog>((f, t) => supabase.from('review_logs').select('*').gte('day', sinceDay).order('reviewed_at').range(f, t));
}

export async function listReadingLogs(sinceDay: string): Promise<ReadingLog[]> {
  return fetchAll<ReadingLog>((f, t) => supabase.from('reading_logs').select('document_id,page,day,seconds').gte('day', sinceDay).range(f, t));
}

// --------------------------------------------------------------- Metas
export async function listMusts(): Promise<DailyMust[]> {
  return check(await supabase.from('daily_musts').select('*').order('created_at')) as DailyMust[];
}

export async function createMust(m: Omit<DailyMust, 'id'>) {
  check(await supabase.from('daily_musts').insert(m));
}

export async function deleteMust(id: string) {
  check(await supabase.from('daily_musts').delete().eq('id', id));
}

// -------------------------------------------------------------- Grifos
export async function listHighlights(documentId?: string): Promise<Highlight[]> {
  return fetchAll<Highlight>((f, t) => {
    let q = supabase.from('highlights').select('*');
    if (documentId) q = q.eq('document_id', documentId);
    return q.order('page').order('created_at').range(f, t);
  });
}

export async function createHighlight(h: Pick<Highlight, 'document_id' | 'page' | 'text' | 'color' | 'position'>): Promise<Highlight> {
  return check(await supabase.from('highlights').insert(h).select('*').single()) as Highlight;
}

export async function updateHighlight(id: string, patch: Partial<Pick<Highlight, 'color' | 'comment'>>): Promise<Highlight> {
  return check(await supabase.from('highlights').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()) as Highlight;
}

export async function deleteHighlight(id: string) {
  check(await supabase.from('highlights').delete().eq('id', id));
}
