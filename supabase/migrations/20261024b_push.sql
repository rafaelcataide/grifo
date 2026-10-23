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
