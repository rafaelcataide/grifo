-- Três planos: grátis, Plus e Pro. A IA tem cota por mês, separada em "leve" (Haiku) e "pesada" (Sonnet);
-- no grátis, a IA pesada é só para experimentar (3 usos no total). Os números ficam em
-- supabase/functions/_shared/planos.js (mesma tabela no app e na função "ai").

-- plano pago pode ser 'pro'
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'plus', 'pro'));

-- Plano efetivo: pago (plus/pro) ou Plus ganho por convite (plus_until)
create or replace function public.my_plan() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when plan = 'pro' then 'pro' when plan = 'plus' or plus_until > now() then 'plus' else 'free' end
    from profiles where user_id = auth.uid()), 'free');
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- mesmo cálculo para a função "ai" (chave de serviço), que recebe o id da pessoa
create or replace function public.plan_of(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when plan = 'pro' then 'pro' when plan = 'plus' or plus_until > now() then 'plus' else 'free' end
    from profiles where user_id = uid), 'free');
$$;
revoke all on function public.plan_of(uuid) from public, anon, authenticated;
grant execute on function public.plan_of(uuid) to service_role;

-- Uso de IA por mês ('2026-10') e o total de sempre ('total', para o teste de IA pesada do grátis)
create table if not exists public.ai_usage_month (
  user_id uuid not null references auth.users on delete cascade,
  period  text not null,
  light   int not null default 0,
  heavy   int not null default 0,
  primary key (user_id, period)
);
alter table public.ai_usage_month enable row level security; -- sem políticas: só as funções abaixo mexem

-- Conta um uso se ainda couber no limite; devolve o novo total ou -1 se a cota acabou (tudo numa operação só)
create or replace function public.ai_month_hit(uid uuid, kind text, per text, lim int) returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if kind not in ('light', 'heavy') then raise exception 'tipo inválido'; end if;
  insert into ai_usage_month (user_id, period) values (uid, per) on conflict do nothing;
  if kind = 'light' then
    update ai_usage_month set light = light + 1 where user_id = uid and period = per and light < lim returning light into c;
  else
    update ai_usage_month set heavy = heavy + 1 where user_id = uid and period = per and heavy < lim returning heavy into c;
  end if;
  return coalesce(c, -1);
end $$;
revoke all on function public.ai_month_hit(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.ai_month_hit(uuid, text, text, int) to service_role;

-- Devolve o uso quando a IA falhou (a pessoa não perde a cota por erro do serviço)
create or replace function public.ai_month_refund(uid uuid, kind text, per text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if kind = 'light' then update ai_usage_month set light = greatest(0, light - 1) where user_id = uid and period = per;
  elsif kind = 'heavy' then update ai_usage_month set heavy = greatest(0, heavy - 1) where user_id = uid and period = per; end if;
end $$;
revoke all on function public.ai_month_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ai_month_refund(uuid, text, text) to service_role;

-- O que a própria pessoa já usou (para o contador no app)
create or replace function public.my_ai_usage() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'month', to_char(now(), 'YYYY-MM'),
    'light', coalesce((select light from ai_usage_month where user_id = auth.uid() and period = to_char(now(), 'YYYY-MM')), 0),
    'heavy', coalesce((select heavy from ai_usage_month where user_id = auth.uid() and period = to_char(now(), 'YYYY-MM')), 0),
    'heavy_total', coalesce((select heavy from ai_usage_month where user_id = auth.uid() and period = 'total'), 0),
    'pdf_bytes', coalesce((select sum((metadata->>'size')::bigint) from storage.objects where bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text), 0)
  );
$$;
revoke all on function public.my_ai_usage() from public, anon;
grant execute on function public.my_ai_usage() to authenticated;

-- PDFs na conta: Plus até 2 GB, Pro até 10 GB (conta o que já está guardado; um arquivo tem no máximo 50 MB)
create or replace function public.pdf_space_ok() returns boolean
language sql stable security definer set search_path = public, storage as $$
  select coalesce((select sum((metadata->>'size')::bigint) from storage.objects
      where bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text), 0)
    < case public.my_plan() when 'pro' then 10737418240 when 'plus' then 2147483648 else 0 end;
$$;
revoke all on function public.pdf_space_ok() from public, anon;
grant execute on function public.pdf_space_ok() to authenticated;

drop policy if exists "pdfs: Plus grava" on storage.objects;
create policy "pdfs: Plus grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text and public.pdf_space_ok());
