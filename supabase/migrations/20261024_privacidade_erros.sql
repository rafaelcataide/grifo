-- Erros do app e sugestões dos usuários. Só gravação: ninguém lê pelo app;
-- você lê no painel do Supabase (Table Editor), que usa a chave de administrador.

create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  message    text not null check (length(message) <= 500),
  stack      text check (length(stack) <= 4000),
  url        text check (length(url) <= 300),
  user_agent text check (length(user_agent) <= 300),
  version    text check (length(version) <= 40)
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant insert (message, stack, url, user_agent, version) on public.client_errors to anon, authenticated;
drop policy if exists "erros: qualquer um registra" on public.client_errors;
create policy "erros: qualquer um registra" on public.client_errors for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  kind       text not null default 'sugestao' check (kind in ('sugestao', 'problema', 'elogio')),
  message    text not null check (length(message) between 3 and 4000),
  version    text check (length(version) <= 40)
);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant insert (kind, message, version) on public.feedback to authenticated;
drop policy if exists "sugestões: usuário logado envia" on public.feedback;
create policy "sugestões: usuário logado envia" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()));
