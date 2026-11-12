-- =====================================================================
-- Cosmos Hub — atualização 002: grifos e status "LIDO!"
-- Cole no SQL Editor do Supabase e clique em "Run". Pode rodar de novo.
-- =====================================================================

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
