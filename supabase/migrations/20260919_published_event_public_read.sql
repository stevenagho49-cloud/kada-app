-- Migration: let guests open ANY published event by direct link.
--
-- Bug: the public read policy required show_on_homepage = true, so a published,
-- ticketed event that was hidden from the homepage returned "This event isn't
-- available" on its #event/<id> ticket page — even though ticket sales are the
-- whole point of a shareable link. Drafts stay admin-only; only *published*
-- events become publicly readable.
--
-- Apply via Supabase Dashboard > SQL Editor.

drop policy if exists "Public can read homepage events" on public.events;
drop policy if exists "Public can read published events" on public.events;

create policy "Public can read published events" on public.events
  for select using (status = 'published');

notify pgrst, 'reload schema';
