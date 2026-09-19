-- Migration: site_content — key/value store for homepage text, team, contact
-- details and prices, editable from Operations > Site > Site content.
-- Public read (it only holds public website copy); admin-only writes.
-- Apply via Supabase Dashboard > SQL Editor.

create table if not exists public.site_content (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;

drop policy if exists "Anyone can read site content" on public.site_content;
drop policy if exists "Admins can manage site content" on public.site_content;

create policy "Anyone can read site content" on public.site_content
  for select using (true);

create policy "Admins can manage site content" on public.site_content
  for all using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Seed with the current hardcoded content so the site looks identical the
-- moment this migration is applied.
insert into public.site_content (key, value) values
  ('hero', '{"title": "Inspiring, uplifting.", "titleLine2": "Transforming lives.", "lede": "Faith inspired Gospel Afrobeats for the next generation, building confidence and character in children aged 5 to 16."}'),
  ('stats', '{"childrenEmpowered": "1,000+", "schoolsReached": "1,000+", "yearsImpact": "10+"}'),
  ('about', '{"title": "More than dance.", "titleEmphasis": "It''s a movement.", "paragraph1": "King''s Ark Dance Academy, formerly Dance With Stago, is a faith inspired dance school rooted in Gospel Afrobeats. We work with children and young people aged 5 to 16, using dance to build confidence, teamwork, creativity and cultural awareness.", "paragraph2": "We''ve delivered workshops in over a thousand UK schools, with moments alongside ITV, BBC and the Commonwealth Games. The heart of what we do happens in the room: a shy child finding their voice, a group of strangers becoming a team in under an hour.", "ctaLabel": "Learn More About Us"}'),
  ('contact', '{"email": "bookings@kingsarkdance.com", "phone": "+44 7535 897732", "address": "395 College Rd, Birmingham B44 0HF", "heading": "Let''s talk.", "intro": "Whether you''re a parent, a school, or an organisation looking to partner with us, we''d love to hear from you."}'),
  ('workshops', '{"eyebrow": "For Schools", "title": "Bring your school to life through Afrobeats.", "body": "High energy, fully interactive workshops built for enrichment days, Culture Days and Black History Month. No dance experience needed, only enthusiasm.", "ctaLabel": "Get a Quote"}'),
  ('classes', '{"eyebrow": "For Families", "title": "Saturday classes, ages 5 to 15.", "body": "Confidence, creativity and skill, term by term, in a joyful and faith rooted environment.", "ctaLabel": "Book a Saturday class"}'),
  ('team', '{"eyebrow": "The People Behind KADA", "title": "Meet the team.", "members": [{"name": "Steven", "role": "Founder & Lead Instructor", "photo": "/images/team-steven.jpg"}, {"name": "Temilade", "role": "Programme Coordinator", "photo": ""}, {"name": "Annedrea", "role": "School Partnerships", "photo": "/images/team-annedrea.jpg"}]}'),
  ('videos', '{"eyebrow": "In Their Own Words", "title": "Real stories, real confidence."}'),
  ('prices', '{"membershipPence": 2500, "dayPassPence": 1000, "workshopFullDayPounds": 490, "workshopHalfDayPounds": 260, "workshopSinglePounds": 150}')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
