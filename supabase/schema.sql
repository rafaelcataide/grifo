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
