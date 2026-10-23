-- Crescimento: convites com recompensa, eventos de uso e painel de métricas (só para admins).
-- Rode no SQL Editor do Supabase (ou: npx supabase db query --linked -f este-arquivo).

-- ============ convites ============
-- Quem convida e quem entra pelo convite ganham 30 dias de Plus cada.
-- Só contas novas (até 3 dias) podem usar um convite, uma vez; quem convida ganha no máximo 12 vezes.
alter table public.profiles add column if not exists plus_until timestamptz;
alter table public.profiles add column if not exists invite_code text unique;

create table if not exists public.referrals (
  invitee    uuid primary key references auth.users on delete cascade,
  inviter    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists referrals_inviter_idx on public.referrals (inviter);
alter table public.referrals enable row level security; -- sem políticas: só as funções abaixo acessam

-- Plano efetivo: pago (plan) ou ganho por convite (plus_until)
create or replace function public.my_plan() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when plan = 'plus' or plus_until > now() then 'plus' else 'free' end
                   from profiles where user_id = auth.uid()), 'free');
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- Meu código de convite (criado na primeira vez), quantas pessoas entraram por ele e até quando tenho Plus
create or replace function public.my_invite() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c text;
begin
  if uid is null then raise exception 'faça login'; end if;
  insert into profiles (user_id) values (uid) on conflict (user_id) do nothing;
  select invite_code into c from profiles where user_id = uid;
  while c is null loop
    begin
      c := substr(md5(random()::text || clock_timestamp()::text || uid::text), 1, 7);
      update profiles set invite_code = c where user_id = uid;
    exception when unique_violation then c := null;
    end;
  end loop;
  return json_build_object(
    'code', c,
    'invited', (select count(*) from referrals where inviter = uid),
    'plus_until', (select plus_until from profiles where user_id = uid)
  );
end $$;
revoke all on function public.my_invite() from public, anon;
grant execute on function public.my_invite() to authenticated;

-- Usa um convite: ok | invalid | self | already | old
create or replace function public.redeem_invite(code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  who uuid;
begin
  if uid is null then raise exception 'faça login'; end if;
  if exists (select 1 from referrals where invitee = uid) then return 'already'; end if;
  if (select created_at from auth.users where id = uid) < now() - interval '3 days' then return 'old'; end if;
  select user_id into who from profiles where invite_code = lower(trim(code));
  if who is null then return 'invalid'; end if;
  if who = uid then return 'self'; end if;
  insert into referrals (invitee, inviter) values (uid, who);
  insert into profiles (user_id) values (uid) on conflict (user_id) do nothing;
  update profiles set plus_until = greatest(coalesce(plus_until, now()), now()) + interval '30 days' where user_id = uid;
  if (select count(*) from referrals where inviter = who) <= 12 then
    update profiles set plus_until = greatest(coalesce(plus_until, now()), now()) + interval '30 days' where user_id = who;
  end if;
  return 'ok';
end $$;
revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- ============ eventos de uso ============
-- Poucos eventos, sem conteúdo pessoal (ex.: "share" com o tipo de arte). Cada pessoa só grava os seus; ninguém lê pela API.
create table if not exists public.events (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (name ~ '^[a-z_]{2,40}$'),
  props      jsonb not null default '{}' check (pg_column_size(props) < 1000),
  created_at timestamptz not null default now()
);
create index if not exists events_name_idx on public.events (name, created_at);
alter table public.events enable row level security;
drop policy if exists "events: grava os próprios" on public.events;
create policy "events: grava os próprios" on public.events for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.events from anon, authenticated;
grant insert (name, props) on public.events to authenticated;
grant usage on sequence public.events_id_seq to authenticated;

-- ============ métricas (só admins) ============
create table if not exists public.admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.admins enable row level security; -- sem políticas: ninguém lê pela API
insert into public.admins (user_id) select id from auth.users where email = 'rataide70@gmail.com' on conflict do nothing;

create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

-- Números do painel. Atividade = algum dado do app mudou (livro, nota, card, leitura…) naquele dia.
create or replace function public.admin_metrics() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  r json;
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then raise exception 'acesso negado'; end if;
  with u as (select id, created_at from auth.users),
  act as (select user_id, synced_at from records),
  first_note as (
    select user_id, min(to_timestamp(client_ts / 1000.0)) as at from records where store = 'notes' and not deleted group by user_id
  ),
  cohort30 as (select * from u where created_at between now() - interval '30 days' and now() - interval '1 day'),
  cohort7 as (select * from u where created_at between now() - interval '37 days' and now() - interval '7 days'),
  active30 as (select distinct user_id from act where synced_at > now() - interval '30 days')
  select json_build_object(
    'users', (select count(*) from u),
    'new_7d', (select count(*) from u where created_at > now() - interval '7 days'),
    'dau', (select count(distinct user_id) from act where synced_at > now() - interval '1 day'),
    'wau', (select count(distinct user_id) from act where synced_at > now() - interval '7 days'),
    'mau', (select count(*) from active30),
    'activation', json_build_object(
      'base', (select count(*) from cohort30),
      'ok', (select count(*) from cohort30 c join first_note f on f.user_id = c.id where f.at <= c.created_at + interval '24 hours')),
    'retention7', json_build_object(
      'base', (select count(*) from cohort7),
      'ok', (select count(*) from cohort7 c where exists (select 1 from act a where a.user_id = c.id and a.synced_at >= c.created_at + interval '7 days'))),
    'sharers30', (select count(distinct user_id) from events where name = 'share' and created_at > now() - interval '30 days'),
    'plus_paid', (select count(*) from profiles where plan = 'plus'),
    'plus_invite', (select count(*) from profiles where plan <> 'plus' and plus_until > now()),
    'referrals', (select count(*) from referrals),
    'signups_by_week', (select coalesce(json_agg(w order by w.week), '[]') from (
      select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, count(*) as n
      from u where created_at > now() - interval '8 weeks' group by 1) w),
    'events30', (select coalesce(json_object_agg(name, n), '{}') from (
      select name, count(*) as n from events where created_at > now() - interval '30 days' group by name) e)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_metrics() from public, anon;
grant execute on function public.admin_metrics() to authenticated;
