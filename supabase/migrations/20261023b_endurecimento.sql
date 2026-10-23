-- Endurecimento apontado pelo verificador de segurança do Supabase (db advisors).

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
