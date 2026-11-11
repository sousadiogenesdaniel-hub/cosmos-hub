import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Note, NoteType } from '../lib/types';
import { createNote, updateNote, uploadFile, type NoteInput } from '../lib/api';
import { cardFaces, clozeNumbers, fmtTime, nextClozeNumber, parseTime, youtubeId, youtubeStartFromUrl } from '../lib/cards';
import { useApp, useAction } from '../lib/context';
import DeckSelect from './DeckSelect';
import { AudioRecorder, StoredImage, YouTubeEmbed, audioExt } from './Media';

export interface Prefill {
  front?: string;
  back?: string;
  image?: Blob;
  sourceDocumentId?: string;
  sourcePage?: number;
}

/** Texto injetado de fora (ex.: seleção no leitor enviada para frente/verso). */
export interface Injection { target: 'front' | 'back'; text?: string; image?: Blob; nonce: number }

interface Props {
  note?: Note;
  prefill?: Prefill;
  defaultDeckId?: string;
  injection?: Injection | null;
  sourceLabel?: string;
  onSaved?: (note: Note) => void;
  onClose: () => void;
}

const LAST_DECK = 'cosmos:lastDeck';
const LAST_TYPE = 'cosmos:lastType';

function readLS(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLS(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

type Media = string | Blob | null;

export default function CardEditor({ note, prefill, defaultDeckId, injection, sourceLabel, onSaved, onClose }: Props) {
  const { decks, toast } = useApp();
  const run = useAction();
  const initialDeck = note?.deck_id ?? defaultDeckId ?? readLS(LAST_DECK) ?? '';
  const [deckId, setDeckId] = useState(decks.some((d) => d.id === initialDeck) ? initialDeck : decks[0]?.id ?? '');
  const [type, setType] = useState<NoteType>(note?.type ?? ((readLS(LAST_TYPE) as NoteType) || 'basic'));
  const [front, setFront] = useState(note?.front ?? prefill?.front ?? '');
  const [back, setBack] = useState(note?.back ?? prefill?.back ?? '');
  const [frontAudio, setFrontAudio] = useState<Media>(note?.front_audio ?? null);
  const [backAudio, setBackAudio] = useState<Media>(note?.back_audio ?? null);
  const [image, setImage] = useState<Media>(note?.front_image ?? prefill?.image ?? null);
  const [ytUrl, setYtUrl] = useState(note?.youtube_url ?? '');
  const [ytStart, setYtStart] = useState(fmtTime(note?.youtube_start ?? null));
  const [showYt, setShowYt] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!deckId && decks[0]) setDeckId(decks[0].id); }, [decks, deckId]);

  // reinicia quando o leitor manda um novo trecho para criar card
  useEffect(() => {
    if (note || !prefill) return;
    setFront(prefill.front ?? '');
    setBack(prefill.back ?? '');
    setImage(prefill.image ?? null);
    setFrontAudio(null); setBackAudio(null);
    setTimeout(() => (prefill.front ? backRef : frontRef).current?.focus(), 30);
  }, [prefill, note]);

  useEffect(() => {
    if (!injection) return;
    if (injection.image) setImage(injection.image);
    const text = injection.text;
    if (!text) return;
    const add = (prev: string) => (prev.trim() ? `${prev.trimEnd()}\n${text}` : text);
    if (injection.target === 'front') setFront(add); else setBack(add);
  }, [injection]);

  function wrap(ref: React.RefObject<HTMLTextAreaElement | null>, set: (v: string) => void, before: string, after: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const sel = value.slice(s, e) || 'texto';
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    set(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length); });
  }

  function cloze() {
    const n = nextClozeNumber(front);
    if (type !== 'cloze') setType('cloze');
    wrap(frontRef, setFront, `{{c${n}::`, '}}');
  }

  async function save(keepOpen: boolean) {
    if (!deckId) { toast('Escolha ou crie um deck primeiro.', 'error'); return; }
    if (!front.trim() && !image && !frontAudio) { toast('A frente do card está vazia.', 'error'); return; }
    if (type === 'cloze' && clozeNumbers(front).length === 0) { toast('Card de lacuna precisa de pelo menos uma lacuna {{c1::…}} na frente.', 'error'); return; }
    if (ytUrl.trim() && !youtubeId(ytUrl)) { toast('Link do YouTube inválido.', 'error'); return; }
    setSaving(true);
    const saved = await run(async () => {
      const up = async (m: Media, folder: string, ext: (b: Blob) => string) => (m instanceof Blob ? uploadFile(folder, m, ext(m)) : m);
      const input: NoteInput = {
        deck_id: deckId,
        type,
        front,
        back,
        front_audio: await up(frontAudio, 'audio', audioExt),
        back_audio: await up(backAudio, 'audio', audioExt),
        front_image: await up(image, 'images', () => 'png'),
        youtube_url: ytUrl.trim() || null,
        youtube_start: ytUrl.trim() ? parseTime(ytStart) ?? youtubeStartFromUrl(ytUrl) : null,
        source_document_id: note?.source_document_id ?? prefill?.sourceDocumentId ?? null,
        source_page: note?.source_page ?? prefill?.sourcePage ?? null,
      };
      return note ? updateNote(note.id, input, note) : createNote(input);
    }, note ? 'Card atualizado' : 'Card criado ✓');
    setSaving(false);
    if (!saved) return;
    writeLS(LAST_DECK, deckId);
    writeLS(LAST_TYPE, type);
    onSaved?.(saved);
    if (keepOpen && !note) {
      setFront(''); setBack(''); setFrontAudio(null); setBackAudio(null); setImage(null); setYtUrl(''); setYtStart('');
      frontRef.current?.focus();
    } else onClose();
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(!note); }
  }

  const faces = cardFaces({ type, front, back, front_audio: null, back_audio: null, front_image: null }, type === 'cloze' ? clozeNumbers(front)[0] ?? 1 : 0);
  const cardCount = type === 'basic' ? 1 : type === 'reverse' ? 2 : clozeNumbers(front).length;

  return (
    <div className="editor" onKeyDown={onKey}>
      <div className="editor-grid">
        <label>Deck<DeckSelect value={deckId} onChange={setDeckId} /></label>
        <label>Tipo
          <select value={type} onChange={(e) => setType(e.target.value as NoteType)}>
            <option value="basic">Básico</option>
            <option value="reverse">Básico + invertido</option>
            <option value="cloze">Lacuna (cloze)</option>
          </select>
        </label>
      </div>

      <div className="field">
        <div className="field-head">
          <span>{type === 'cloze' ? 'Texto com lacunas' : 'Frente'}</span>
          <div className="toolbar">
            <button type="button" className="tool" title="Negrito" onClick={() => wrap(frontRef, setFront, '**', '**')}><b>B</b></button>
            <button type="button" className="tool" title="Itálico" onClick={() => wrap(frontRef, setFront, '*', '*')}><i>I</i></button>
            <button type="button" className="tool" title="Criar lacuna com o texto selecionado" onClick={cloze}>[…] Lacuna</button>
          </div>
        </div>
        <textarea ref={frontRef} rows={4} value={front} onChange={(e) => setFront(e.target.value)}
          placeholder={type === 'cloze' ? 'Ex.: A {{c1::mitocôndria}} produz {{c2::ATP}}.' : 'Pergunta ou conceito…'} autoFocus={!prefill?.front} />
        {image && (
          <div className="image-slot">
            <StoredImage src={image} alt="Imagem da frente" />
            <button type="button" className="btn small link" onClick={() => setImage(null)}>Remover imagem</button>
          </div>
        )}
        <AudioRecorder label="Áudio da frente" value={frontAudio} onChange={setFrontAudio} />
      </div>

      <div className="field">
        <div className="field-head">
          <span>{type === 'cloze' ? 'Extra (opcional, aparece na resposta)' : 'Verso'}</span>
          <div className="toolbar">
            <button type="button" className="tool" title="Negrito" onClick={() => wrap(backRef, setBack, '**', '**')}><b>B</b></button>
            <button type="button" className="tool" title="Itálico" onClick={() => wrap(backRef, setBack, '*', '*')}><i>I</i></button>
          </div>
        </div>
        <textarea ref={backRef} rows={4} value={back} onChange={(e) => setBack(e.target.value)} placeholder="Resposta…" autoFocus={!!prefill?.front} />
        <AudioRecorder label="Áudio do verso" value={backAudio} onChange={setBackAudio} />
      </div>

      <div className="field">
        <div className="field-head">
          <span>Vídeo do YouTube (opcional)</span>
          {ytUrl && youtubeId(ytUrl) && <button type="button" className="btn small link" onClick={() => setShowYt(!showYt)}>{showYt ? 'Ocultar' : 'Pré-visualizar'}</button>}
        </div>
        <div className="row gap-s">
          <input className="grow" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
          <input className="time-input" value={ytStart} onChange={(e) => setYtStart(e.target.value)} placeholder="início 1:30" title="Começar o vídeo neste tempo (mm:ss)" />
        </div>
        {showYt && ytUrl && <YouTubeEmbed url={ytUrl} start={parseTime(ytStart) ?? youtubeStartFromUrl(ytUrl)} />}
      </div>

      {sourceLabel && <p className="muted small">📖 Fonte: {sourceLabel}</p>}

      <div className="field">
        <button type="button" className="btn small link" onClick={() => setPreview(!preview)}>{preview ? 'Ocultar prévia' : 'Ver prévia do card'}</button>
        {preview && (
          <div className="preview">
            <div className="card-face" dangerouslySetInnerHTML={{ __html: faces.questionHtml }} />
            <hr />
            <div className="card-face" dangerouslySetInnerHTML={{ __html: faces.answerHtml }} />
          </div>
        )}
      </div>

      <footer className="editor-actions">
        <span className="muted small">{cardCount} card{cardCount === 1 ? '' : 's'} · Ctrl+Enter salva</span>
        <div className="row gap-s">
          <button type="button" className="btn ghost" onClick={onClose}>Fechar</button>
          {!note && <button type="button" className="btn" disabled={saving} onClick={() => save(true)}>Salvar e novo</button>}
          <button type="button" className="btn primary" disabled={saving} onClick={() => save(false)}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </footer>
    </div>
  );
}
