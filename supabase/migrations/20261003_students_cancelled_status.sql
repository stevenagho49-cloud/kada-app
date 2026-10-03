-- Migration: students.membership_status can be 'cancelled'.
-- The app has always written 'cancelled' to a child when their family's
-- membership is cancelled (parent cancels, admin cancels, Stripe deletes the
-- subscription, or Subscriptions > "Mark cancelled"), and the Students page,
-- student record, parent dashboard and the attendance register all treat
-- 'cancelled' (has left) differently from 'inactive' (enrolled, not paid yet).
-- But the check constraint only allowed 'active'/'inactive', so every one of
-- those writes was rejected and the child silently kept their old status.
-- parent_families.membership_status already allows 'cancelled'.
-- Idempotent. Apply via Supabase Dashboard > SQL Editor.

alter table public.students drop constraint if exists students_membership_status_check;
alter table public.students
  add constraint students_membership_status_check
  check (membership_status in ('active', 'inactive', 'cancelled'));

notify pgrst, 'reload schema';
