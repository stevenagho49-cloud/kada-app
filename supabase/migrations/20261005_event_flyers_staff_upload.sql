-- Staff with the 'events' permission can already create and edit events
-- (20260921_staff_permissions.sql) but the event-flyers bucket only let admins
-- write, so their flyer uploads failed with a row-level security error.
-- current_user_has_permission() is true for admins too, so admin access is
-- unchanged. The bucket's JPEG-only / 2 MB limits (20261005_event_flyers_jpeg_only.sql)
-- apply to everyone. Public read is untouched.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.
drop policy if exists "Admins can upload event flyers" on storage.objects;
drop policy if exists "Admins can update event flyers" on storage.objects;
drop policy if exists "Admins can delete event flyers" on storage.objects;
drop policy if exists "Events staff can upload event flyers" on storage.objects;
drop policy if exists "Events staff can update event flyers" on storage.objects;
drop policy if exists "Events staff can delete event flyers" on storage.objects;
create policy "Events staff can upload event flyers" on storage.objects for insert to authenticated
  with check (bucket_id = 'event-flyers' and public.current_user_has_permission('events'));
create policy "Events staff can update event flyers" on storage.objects for update to authenticated
  using (bucket_id = 'event-flyers' and public.current_user_has_permission('events'))
  with check (bucket_id = 'event-flyers' and public.current_user_has_permission('events'));
create policy "Events staff can delete event flyers" on storage.objects for delete to authenticated
  using (bucket_id = 'event-flyers' and public.current_user_has_permission('events'));
