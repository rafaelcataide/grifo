-- Clubes: livro lido em conjunto e grifos compartilhados entre os membros.
alter table public.clubs add column if not exists current_book text check (length(current_book) <= 200);

create table if not exists public.club_posts (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  text        text not null check (length(text) between 1 and 1500),
  book_title  text check (length(book_title) <= 200),
  book_author text check (length(book_author) <= 150),
  page        int check (page >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists club_posts_club_idx on public.club_posts (club_id, created_at desc);
alter table public.club_posts enable row level security;
revoke all on public.club_posts from anon;
grant select, insert, delete on public.club_posts to authenticated;

drop policy if exists "posts: membros veem" on public.club_posts;
create policy "posts: membros veem" on public.club_posts for select to authenticated using (public.is_member(club_id));
drop policy if exists "posts: membro publica" on public.club_posts;
create policy "posts: membro publica" on public.club_posts for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(club_id));
drop policy if exists "posts: autor apaga" on public.club_posts;
create policy "posts: autor apaga" on public.club_posts for delete to authenticated using (user_id = (select auth.uid()));
