-- Migration: dedicated 'schools' staff permission area (Operations > Schools).
-- Previously Schools was admin-only in the app UI with no corresponding permission
-- key, so staff could never be granted it (e.g. a School Partnerships role that
-- needs to view and add schools). Staff could only ever read schools as a side
-- effect of the 'bookings' or 'messages' permission, and could never write.
-- Idempotent — safe to run repeatedly.
-- Apply via Supabase Dashboard > SQL Editor.

drop policy if exists "Staff can read schools" on public.schools;
create policy "Staff can read schools" on public.schools for select
  using (
    public.current_user_has_permission('schools')
    or public.current_user_has_permission('bookings')
    or public.current_user_has_permission('messages')
  );

drop policy if exists "Staff can manage schools" on public.schools;
create policy "Staff can manage schools" on public.schools for insert
  with check (public.current_user_has_permission('schools'));

drop policy if exists "Staff can update schools" on public.schools;
create policy "Staff can update schools" on public.schools for update
  using (public.current_user_has_permission('schools'))
  with check (public.current_user_has_permission('schools'));

notify pgrst, 'reload schema';
