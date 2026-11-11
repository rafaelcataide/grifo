-- Segurança e LGPD (nov/2026). Pode rodar mais de uma vez sem efeito colateral.

-- 1) Sincronização com limites: uma conta não consegue encher o banco.
--    Por lote: até 1000 registros. Por registro: até 2 MB, numa das coleções do app, com id curto.
--    Por conta: até 100 mil registros. (Hoje o maior registro tem 55 KB e a maior conta, 71 registros.)
create or replace function public.push_records(rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n int;
  bad int;
  big int;
  total int;
begin
  if me is null then return; end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then raise exception 'lote inválido'; end if;
  n := jsonb_array_length(rows);
  if n = 0 then return; end if;
  if n > 1000 then raise exception 'lote grande demais (% registros)', n; end if;

  select count(*) filter (where r->>'id' is null or length(r->>'id') > 200
                             or r->>'store' is null
                             or r->>'store' not in ('books', 'sessions', 'notes', 'cards', 'reviews', 'words', 'boards', 'kv')),
         count(*) filter (where octet_length((r->'data')::text) > 2000000)
    into bad, big
    from jsonb_array_elements(rows) r;
  if bad > 0 then raise exception 'registro inválido'; end if;
  if big > 0 then raise exception 'registro grande demais (limite de 2 MB)'; end if;

  select count(*) into total from records where user_id = me;
  if total > 100000 then raise exception 'limite de registros da conta atingido'; end if;

  insert into records (user_id, store, id, data, deleted, client_ts)
  select me, r->>'store', r->>'id', r->'data', coalesce((r->>'deleted')::boolean, false), (r->>'client_ts')::bigint
  from jsonb_array_elements(rows) r
  on conflict (user_id, store, id) do update
    set data = excluded.data, deleted = excluded.deleted, client_ts = excluded.client_ts
    where records.client_ts <= excluded.client_ts;
end $$;
revoke all on function public.push_records(jsonb) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;

-- 2) Perfil: a foto só pode vir do Google (um endereço qualquer serviria para descobrir o IP de quem
--    abre o perfil ou o clube); nome e estatísticas com tamanho limitado.
update public.profiles set avatar_url = null
  where avatar_url is not null and avatar_url !~ '^https://[a-z0-9-]+\.googleusercontent\.com/';
alter table public.profiles drop constraint if exists profiles_avatar_google;
alter table public.profiles add constraint profiles_avatar_google
  check (avatar_url is null or (avatar_url ~ '^https://[a-z0-9-]+\.googleusercontent\.com/' and length(avatar_url) <= 500));
alter table public.profiles drop constraint if exists profiles_tamanhos;
alter table public.profiles add constraint profiles_tamanhos
  check ((display_name is null or length(display_name) <= 80) and octet_length(stats::text) <= 200000) not valid;
alter table public.profiles validate constraint profiles_tamanhos;

-- 3) Permissões: tabelas que só as funções do servidor usam não precisam de nenhuma permissão para quem
--    usa o app (as regras de acesso já bloqueavam; isto é uma segunda trava).
revoke all on public.ai_usage, public.ai_usage_total, public.ai_usage_month, public.article_usage, public.referrals, public.admins from anon, authenticated;
revoke all on public.records, public.clubs, public.club_members from anon;

-- 4) Prazo de guarda (LGPD): limpeza automática, todo dia.
--    Erros do app: 90 dias. Eventos de uso: 12 meses. Contadores diários de IA e de artigos: 90 dias.
create or replace function public.limpar_dados_antigos() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from client_errors where created_at < now() - interval '90 days';
  delete from events where created_at < now() - interval '12 months';
  delete from ai_usage where day < current_date - 90;
  delete from ai_usage_total where day < current_date - 90;
  delete from article_usage where day < current_date - 90;
end $$;
revoke all on function public.limpar_dados_antigos() from public, anon, authenticated;

select cron.unschedule('grifo-limpeza') where exists (select 1 from cron.job where jobname = 'grifo-limpeza');
select cron.schedule('grifo-limpeza', '40 7 * * *', $$select public.limpar_dados_antigos()$$);
