-- Ajustes de segurança (out/2026). Já incluídos no schema.sql para instalações novas.

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
