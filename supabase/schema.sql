-- =====================================================================
-- Cosmos Hub — esquema do banco (cole tudo no SQL Editor do Supabase e
-- clique em "Run"). Pode rodar de novo sem problema: é idempotente.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Perfil ---------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  occupation text,
  bio text,
  objectives text,
  daily_goal_type text not null default 'cards' check (daily_goal_type in ('cards','minutes','pages')),
  daily_goal_value int not null default 50 check (daily_goal_value > 0),
  audio_think_seconds int not null default 15 check (audio_think_seconds between 1 and 120),
  created_at timestamptz not null default now()
);

-- ---------- Biblioteca -----------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  kind text not null default 'livro',
  subject text,
  tags text[] not null default '{}',
  file_path text not null,
  file_type text not null check (file_type in ('pdf','docx')),
  size_bytes bigint,
  page_count int,
  last_page int not null default 1,
  last_opened_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Decks / notas / cards ------------------------------------
create table if not exists public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  parent_id uuid references public.decks on delete cascade,
  new_per_day int not null default 20,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  deck_id uuid not null references public.decks on delete cascade,
  type text not null default 'basic' check (type in ('basic','reverse','cloze')),
  front text not null default '',
  back text not null default '',
  front_audio text,
  back_audio text,
  front_image text,
  youtube_url text,
  youtube_start int,
  source_document_id uuid references public.documents on delete set null,
  source_page int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  note_id uuid not null references public.notes on delete cascade,
  deck_id uuid not null references public.decks on delete cascade,
  ord int not null default 0,
  due timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  elapsed_days int not null default 0,
  scheduled_days int not null default 0,
  learning_steps int not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  state int not null default 0,
  last_review timestamptz,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  unique (note_id, ord)
);

create table if not exists public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  card_id uuid references public.cards on delete set null,
  deck_id uuid references public.decks on delete set null,
  rating int not null,
  state_before int not null,
  duration_ms int not null default 0,
  mode text not null default 'normal',
  day date not null,
  reviewed_at timestamptz not null default now()
);

-- ---------- Leitura ---------------------------------------------------
create table if not exists public.reading_logs (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  document_id uuid not null references public.documents on delete cascade,
  page int not null,
  day date not null,
  seconds int not null default 0,
  primary key (user_id, document_id, page, day)
);

-- ---------- Metas: obrigatórios do dia -------------------------------
create table if not exists public.daily_musts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('deck_clear','deck_cards','doc_pages')),
  ref_id uuid not null,
  target int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cards_user_due on public.cards (user_id, due);
create index if not exists cards_note on public.cards (note_id);
create index if not exists notes_deck on public.notes (deck_id);
create index if not exists review_logs_user_day on public.review_logs (user_id, day);
create index if not exists reading_logs_user_day on public.reading_logs (user_id, day);

-- ---------- Segurança: cada usuário só vê os próprios dados ----------
do $$
declare t text;
begin
  foreach t in array array['documents','decks','notes','cards','review_logs','reading_logs','daily_musts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

-- Soma segundos de leitura numa página (insere ou acumula).
create or replace function public.log_reading(p_document uuid, p_page int, p_day date, p_seconds int)
returns void language sql security invoker as $$
  insert into public.reading_logs (user_id, document_id, page, day, seconds)
  values (auth.uid(), p_document, p_page, p_day, p_seconds)
  on conflict (user_id, document_id, page, day)
  do update set seconds = public.reading_logs.seconds + excluded.seconds;
$$;

-- ---------- Armazenamento de arquivos (PDF, Word, áudios, imagens) ---
insert into storage.buckets (id, name, public, file_size_limit)
values ('cosmos', 'cosmos', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "cosmos own files" on storage.objects;
create policy "cosmos own files" on storage.objects for all
  using (bucket_id = 'cosmos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'cosmos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Atualização 002: grifos e status "LIDO!" -------------

alter table public.documents add column if not exists finished_at timestamptz;

create table if not exists public.highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  document_id uuid not null references public.documents on delete cascade,
  page int not null,
  text text not null,
  color text not null default 'yellow' check (color in ('yellow','green','blue','pink')),
  comment text,
  -- PDF: {"rects":[{"p":1,"x":0.1,"y":0.2,"w":0.5,"h":0.02}, ...]} (proporção da página)
  -- Word: {"offset":1234,"length":80} (posição no texto)
  position jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists highlights_doc on public.highlights (document_id, page);

alter table public.highlights enable row level security;
drop policy if exists "own rows" on public.highlights;
create policy "own rows" on public.highlights for all using (user_id = auth.uid()) with check (user_id = auth.uid());
