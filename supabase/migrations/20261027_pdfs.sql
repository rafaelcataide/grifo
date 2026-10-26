-- PDFs do Plus: armazenamento privado. Cada pessoa só lê, grava e apaga a própria pasta (user_id/arquivo.pdf).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

drop policy if exists "pdfs: dono lê" on storage.objects;
create policy "pdfs: dono lê" on storage.objects for select to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "pdfs: Plus grava" on storage.objects;
create policy "pdfs: Plus grava" on storage.objects for insert to authenticated
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text and public.my_plan() = 'plus');
drop policy if exists "pdfs: dono atualiza" on storage.objects;
create policy "pdfs: dono atualiza" on storage.objects for update to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "pdfs: dono apaga" on storage.objects;
create policy "pdfs: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
