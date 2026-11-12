export type GoalType = 'cards' | 'minutes' | 'pages';

export interface Profile {
  id: string;
  name: string | null;
  occupation: string | null;
  bio: string | null;
  objectives: string | null;
  daily_goal_type: GoalType;
  daily_goal_value: number;
  audio_think_seconds: number;
}

export interface DocumentRow {
  id: string;
  title: string;
  kind: string;
  subject: string | null;
  tags: string[];
  file_path: string;
  file_type: 'pdf' | 'docx';
  size_bytes: number | null;
  page_count: number | null;
  last_page: number;
  last_opened_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface Deck {
  id: string;
  name: string;
  parent_id: string | null;
  new_per_day: number;
  created_at: string;
}

export type NoteType = 'basic' | 'reverse' | 'cloze';

export interface Note {
  id: string;
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
  created_at: string;
  updated_at: string;
}

export interface CardRow {
  id: string;
  note_id: string;
  deck_id: string;
  ord: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number; // 0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo
  last_review: string | null;
  suspended: boolean;
}

export interface ReviewLog {
  id: string;
  card_id: string | null;
  deck_id: string | null;
  rating: number;
  state_before: number;
  duration_ms: number;
  mode: string;
  day: string;
  reviewed_at: string;
}

export interface ReadingLog {
  document_id: string;
  page: number;
  day: string;
  seconds: number;
}

export type MustKind = 'deck_clear' | 'deck_cards' | 'doc_pages';

export interface DailyMust {
  id: string;
  kind: MustKind;
  ref_id: string;
  target: number;
}

export const DOC_KINDS: { value: string; label: string }[] = [
  { value: 'livro', label: 'Livro' },
  { value: 'artigo', label: 'Artigo' },
  { value: 'relatorio', label: 'Relatório' },
  { value: 'apostila', label: 'Apostila' },
  { value: 'norma', label: 'Norma' },
  { value: 'anotacao', label: 'Anotação' },
  { value: 'outro', label: 'Outro' },
];

export const kindLabel = (k: string) => DOC_KINDS.find((d) => d.value === k)?.label ?? k;

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export const HIGHLIGHT_COLORS: { value: HighlightColor; label: string }[] = [
  { value: 'yellow', label: 'Amarelo' },
  { value: 'green', label: 'Verde' },
  { value: 'blue', label: 'Azul' },
  { value: 'pink', label: 'Rosa' },
];

export interface HlRect { p: number; x: number; y: number; w: number; h: number }

export interface Highlight {
  id: string;
  document_id: string;
  page: number;
  text: string;
  color: HighlightColor;
  comment: string | null;
  position: { rects?: HlRect[]; offset?: number; length?: number };
  created_at: string;
  updated_at: string;
}
