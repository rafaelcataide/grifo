-- Artigos salvos por link: contador diário de páginas buscadas por pessoa (evita abuso da função "article").
create table if not exists public.article_usage (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null default current_date,
  count   int not null default 0,
  primary key (user_id, day)
);
alter table public.article_usage enable row level security; -- sem políticas: só a função do servidor usa

create or replace function public.article_quota_hit(uid uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  insert into article_usage (user_id, day, count) values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = article_usage.count + 1
  returning count into c;
  return c;
end $$;
revoke all on function public.article_quota_hit(uuid) from public, anon, authenticated;
grant execute on function public.article_quota_hit(uuid) to service_role;
