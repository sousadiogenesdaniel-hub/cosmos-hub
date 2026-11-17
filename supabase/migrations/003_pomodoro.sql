-- =====================================================================
-- Cosmos Hub — atualização 003: pomodoro
-- Cole no SQL Editor do Supabase e clique em "Run". Pode rodar de novo.
-- =====================================================================

alter table public.profiles add column if not exists pomodoro_focus int not null default 25 check (pomodoro_focus between 1 and 180);
alter table public.profiles add column if not exists pomodoro_break int not null default 5 check (pomodoro_break between 1 and 60);
alter table public.profiles add column if not exists pomodoro_goal int not null default 4 check (pomodoro_goal between 1 and 30);

create table if not exists public.pomodoros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  started_at timestamptz not null,
  minutes int not null,
  created_at timestamptz not null default now()
);

create index if not exists pomodoros_user_day on public.pomodoros (user_id, day);

alter table public.pomodoros enable row level security;
drop policy if exists "own rows" on public.pomodoros;
create policy "own rows" on public.pomodoros for all using (user_id = auth.uid()) with check (user_id = auth.uid());
