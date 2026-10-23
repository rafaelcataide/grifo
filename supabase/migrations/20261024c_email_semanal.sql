-- Resumo semanal por e-mail: a pessoa escolhe receber (desligado por padrão).
-- A preferência não fica visível para outras pessoas: só se lê e altera pelas funções abaixo.
alter table public.profiles add column if not exists weekly_email boolean not null default false;

create or replace function public.my_weekly_email() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select weekly_email from profiles where user_id = auth.uid()), false);
$$;
create or replace function public.set_weekly_email(on_off boolean) returns void
language sql security definer set search_path = public as $$
  update profiles set weekly_email = on_off, updated_at = now() where user_id = auth.uid();
$$;
revoke all on function public.my_weekly_email() from public, anon;
revoke all on function public.set_weekly_email(boolean) from public, anon;
grant execute on function public.my_weekly_email() to authenticated;
grant execute on function public.set_weekly_email(boolean) to authenticated;
