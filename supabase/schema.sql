-- Grifo: banco no Supabase. Rode tudo no SQL Editor do projeto (uma vez).
-- Segurança: cada tabela tem RLS; ninguém lê ou grava dados de outra pessoa.

-- ============ sincronização ============
-- Um registro por item do app (livro, nota, card, sessão, revisão, ajustes…)
create table if not exists public.records (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  store     text not null,
  id        text not null,
  data      jsonb,
  deleted   boolean not null default false,
  client_ts bigint not null default 0,          -- quando o item mudou no aparelho (ms)
  synced_at timestamptz not null default now(), -- cursor de sincronização (relógio do servidor)
  primary key (user_id, store, id)
);
create index if not exists records_sync_idx on public.records (user_id, synced_at);
alter table public.records enable row level security;

drop policy if exists "records: dono lê" on public.records;
create policy "records: dono lê" on public.records for select using (auth.uid() = user_id);

create or replace function public.touch_synced_at() returns trigger language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
  for each row execute function public.touch_synced_at();

-- Envia mudanças em lote; uma versão mais antiga nunca sobrescreve uma mais nova
create or replace function public.push_records(rows jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.records (user_id, store, id, data, deleted, client_ts)
  select auth.uid(), r->>'store', r->>'id', r->'data', coalesce((r->>'deleted')::boolean, false), (r->>'client_ts')::bigint
  from jsonb_array_elements(rows) r
  where auth.uid() is not null
  on conflict (user_id, store, id) do update
    set data = excluded.data, deleted = excluded.deleted, client_ts = excluded.client_ts
    where public.records.client_ts <= excluded.client_ts;
$$;
revoke all on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;

-- ============ perfil, plano e lado social ============
create table if not exists public.profiles (
  user_id      uuid primary key default auth.uid() references auth.users on delete cascade,
  handle       text unique check (handle ~ '^[a-z0-9_.]{3,30}$'),
  display_name text,
  avatar_url   text,
  is_public    boolean not null default false,
  stats        jsonb not null default '{}',
  plan         text not null default 'free' check (plan in ('free', 'plus')),
  stripe_customer text,
  updated_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- O usuário só altera os próprios dados públicos; "plan" só muda pelo servidor (pagamento)
revoke insert, update on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert (user_id, handle, display_name, avatar_url, is_public, stats, updated_at) on public.profiles to authenticated;
grant update (handle, display_name, avatar_url, is_public, stats, updated_at) on public.profiles to authenticated;

create table if not exists public.clubs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 2 and 60),
  code       text unique not null default upper(substr(md5(random()::text), 1, 6)),
  goal_pages int not null default 2000 check (goal_pages > 0),
  owner      uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.club_members (
  club_id   uuid not null references public.clubs on delete cascade,
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;

create or replace function public.is_member(club uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from club_members where club_id = club and user_id = auth.uid());
$$;
create or replace function public.shares_club(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from club_members a join club_members b on a.club_id = b.club_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

drop policy if exists "profiles: visíveis" on public.profiles;
create policy "profiles: visíveis" on public.profiles for select
  using (is_public or user_id = auth.uid() or public.shares_club(user_id));
drop policy if exists "profiles: cria o próprio" on public.profiles;
create policy "profiles: cria o próprio" on public.profiles for insert with check (user_id = auth.uid());
drop policy if exists "profiles: edita o próprio" on public.profiles;
create policy "profiles: edita o próprio" on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "clubs: membros veem" on public.clubs;
create policy "clubs: membros veem" on public.clubs for select using (owner = auth.uid() or public.is_member(id));
drop policy if exists "clubs: qualquer um cria" on public.clubs;
create policy "clubs: qualquer um cria" on public.clubs for insert with check (owner = auth.uid());
drop policy if exists "clubs: dono edita" on public.clubs;
create policy "clubs: dono edita" on public.clubs for update using (owner = auth.uid());
drop policy if exists "clubs: dono apaga" on public.clubs;
create policy "clubs: dono apaga" on public.clubs for delete using (owner = auth.uid());

drop policy if exists "membros: colegas veem" on public.club_members;
create policy "membros: colegas veem" on public.club_members for select using (public.is_member(club_id));
drop policy if exists "membros: entra no clube que criou" on public.club_members;
create policy "membros: entra no clube que criou" on public.club_members for insert
  with check (user_id = auth.uid() and exists (select 1 from clubs c where c.id = club_id and c.owner = auth.uid()));
drop policy if exists "membros: sai" on public.club_members;
create policy "membros: sai" on public.club_members for delete using (user_id = auth.uid());

-- Entrar num clube pelo código de convite
create or replace function public.join_club(invite text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  select id into cid from clubs where code = upper(trim(invite));
  if cid is null then raise exception 'código inválido'; end if;
  insert into club_members (club_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  return cid;
end $$;
revoke all on function public.join_club(text) from public, anon;
grant execute on function public.join_club(text) to authenticated;

-- ============ IA: limite diário por usuário ============
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  count   int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security; -- sem políticas: só a função abaixo mexe

create or replace function public.ai_quota_hit() returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into ai_usage (user_id, day, count) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count into c;
  return c;
end $$;
revoke all on function public.ai_quota_hit() from public, anon;
grant execute on function public.ai_quota_hit() to authenticated;

-- ============ ajustes de segurança (perfis, plano e teto geral da IA) ============

-- 1) Perfis: plano e cliente do Stripe deixam de ser legíveis por outras pessoas
--    (perfil público e colegas de clube veem só nome, foto e estatísticas).
revoke select on public.profiles from anon, authenticated;
grant select (user_id, handle, display_name, avatar_url, is_public, stats, updated_at) on public.profiles to anon, authenticated;

-- Cada pessoa consulta o próprio plano por esta função
create or replace function public.my_plan() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select plan from profiles where user_id = auth.uid()), 'free');
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- 3) IA: teto diário somando todos os usuários (protege a conta da Anthropic de abuso)
create table if not exists public.ai_usage_total (
  day   date primary key,
  count int not null default 0
);
alter table public.ai_usage_total enable row level security; -- sem políticas: só a função mexe

create or replace function public.ai_global_hit() returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into ai_usage_total (day, count) values (current_date, 1)
  on conflict (day) do update set count = ai_usage_total.count + 1
  returning count into c;
  return c;
end $$;
revoke all on function public.ai_global_hit() from public, anon;
grant execute on function public.ai_global_hit() to authenticated;

-- ============ endurecimento (contadores de IA só pelo servidor, regras por papel) ============

-- Contadores de IA: só a função "ai" (com a chave de serviço) pode incrementar.
-- Antes, um usuário logado podia chamá-los direto e esgotar o teto diário de todos.
drop function if exists public.ai_quota_hit();
create or replace function public.ai_quota_hit(uid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into ai_usage (user_id, day, count) values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count into c;
  return c;
end $$;
revoke all on function public.ai_quota_hit(uuid) from public, anon, authenticated;
grant execute on function public.ai_quota_hit(uuid) to service_role;

revoke all on function public.ai_global_hit() from public, anon, authenticated;
grant execute on function public.ai_global_hit() to service_role;

-- Funções auxiliares das regras de clube: só para quem está logado
revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.shares_club(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.shares_club(uuid) to authenticated;

alter function public.touch_synced_at() set search_path = public;

-- Regras reescritas: visitante anônimo só vê perfis públicos; auth.uid() avaliado uma vez por consulta
drop policy if exists "records: dono lê" on public.records;
create policy "records: dono lê" on public.records for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "profiles: visíveis" on public.profiles;
drop policy if exists "profiles: públicos" on public.profiles;
create policy "profiles: públicos" on public.profiles for select to anon using (is_public);
create policy "profiles: visíveis" on public.profiles for select to authenticated
  using (is_public or user_id = (select auth.uid()) or public.shares_club(user_id));
drop policy if exists "profiles: cria o próprio" on public.profiles;
create policy "profiles: cria o próprio" on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "profiles: edita o próprio" on public.profiles;
create policy "profiles: edita o próprio" on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "clubs: membros veem" on public.clubs;
create policy "clubs: membros veem" on public.clubs for select to authenticated using (owner = (select auth.uid()) or public.is_member(id));
drop policy if exists "clubs: qualquer um cria" on public.clubs;
create policy "clubs: qualquer um cria" on public.clubs for insert to authenticated with check (owner = (select auth.uid()));
drop policy if exists "clubs: dono edita" on public.clubs;
create policy "clubs: dono edita" on public.clubs for update to authenticated using (owner = (select auth.uid()));
drop policy if exists "clubs: dono apaga" on public.clubs;
create policy "clubs: dono apaga" on public.clubs for delete to authenticated using (owner = (select auth.uid()));

drop policy if exists "membros: colegas veem" on public.club_members;
create policy "membros: colegas veem" on public.club_members for select to authenticated using (public.is_member(club_id));
drop policy if exists "membros: entra no clube que criou" on public.club_members;
create policy "membros: entra no clube que criou" on public.club_members for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from clubs c where c.id = club_id and c.owner = (select auth.uid())));
drop policy if exists "membros: sai" on public.club_members;
create policy "membros: sai" on public.club_members for delete to authenticated using (user_id = (select auth.uid()));

-- ============ erros do app e sugestões ============
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

-- ============ notificações pelo servidor ============
-- Notificações pelo servidor (Web Push): lembrete diário, sequência, cards e "grifo do dia".

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh      text not null,
  auth        text not null,
  tz          text not null default 'America/Sao_Paulo',
  remind_time text not null default '20:00' check (remind_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  enabled     boolean not null default true,
  last_sent   date,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "push: dono vê" on public.push_subscriptions;
create policy "push: dono vê" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "push: dono cria" on public.push_subscriptions;
create policy "push: dono cria" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "push: dono altera" on public.push_subscriptions;
create policy "push: dono altera" on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "push: dono remove" on public.push_subscriptions;
create policy "push: dono remove" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Agendamento (pg_cron + pg_net): roda a função push-daily a cada 15 minutos.
-- O comando do agendamento é criado à parte (precisa da URL do projeto e do CRON_SECRET).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
