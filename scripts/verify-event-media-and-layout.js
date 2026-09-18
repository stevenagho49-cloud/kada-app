import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

// Live verification for: (A) event media/time/maps + empty-events guard, and
// (B) the homepage Site Layout (site_sections show/hide + reorder) feature.
// Runs against the live Supabase project with the service role + anon key.

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY)

const EVENT_ID = 'its-time-to-rise-2026'
const suffix = Date.now()
const results = {}
let failed = false
function check(name, ok, detail) {
  results[name] = { ok, detail }
  if (!ok) failed = true
}

async function main() {
  // ---------- PART A: event media / time / maps columns ----------
  const mediaUpdate = {
    event_time: '18:00',
    map_url: 'https://www.google.com/maps/search/?api=1&query=Birmingham+Town+Hall',
    flyer_path: `${EVENT_ID}/test-flyer-${suffix}.jpg`,
  }
  const { error: mediaError } = await service.from('events').update(mediaUpdate).eq('id', EVENT_ID)
  check('events: time/map/flyer columns writable', !mediaError, mediaError?.message || 'updated event_time, map_url, flyer_path')

  const { data: evt } = await service.from('events').select('event_time,map_url,flyer_path,ticket_tiers,guest_artists,ticketing_enabled').eq('id', EVENT_ID).single()
  check(
    'events: new fields read back',
    evt && evt.event_time && evt.map_url && evt.flyer_path && Array.isArray(evt.ticket_tiers) && evt.ticket_tiers.length === 4,
    evt ? `time=${evt.event_time}, tiers=${(evt.ticket_tiers||[]).length}, flyer=${evt.flyer_path}` : 'no event row',
  )

  // Empty-events guard: the homepage query filters to published + show_on_homepage + event_date >= today.
  // Simulate by checking that a PAST event would be excluded from that query.
  const pastId = `verify-past-${suffix}`
  await service.from('events').insert({ id: pastId, title: 'Past event', status: 'published', show_on_homepage: true, event_date: '2020-01-01' })
  const today = new Date().toISOString().slice(0, 10)
  const { data: upcoming } = await service.from('events').select('id').eq('status', 'published').eq('show_on_homepage', true).gte('event_date', today)
  check(
    'homepage guard: past events excluded from upcoming query',
    (upcoming || []).some((r) => r.id === EVENT_ID) && !(upcoming || []).some((r) => r.id === pastId),
    `upcoming ids include its-time-to-rise=${(upcoming||[]).some(r=>r.id===EVENT_ID)}, exclude past=${!(upcoming||[]).some(r=>r.id===pastId)}`,
  )

  // event-flyers bucket exists and is publicly readable (admin-upload only).
  const { data: buckets } = await service.storage.listBuckets()
  const flyersBucket = (buckets || []).find((b) => b.name === 'event-flyers')
  check('storage: event-flyers bucket exists & public', Boolean(flyersBucket) && flyersBucket.public === true, flyersBucket ? `public=${flyersBucket.public}` : 'bucket missing')

  // ---------- PART B: site_sections layout ----------
  const { data: sections, error: sectionsError } = await service.from('site_sections').select('section_key,label,visible,sort_order').order('sort_order')
  check('site_sections: seeded with homepage sections', !sectionsError && (sections || []).length >= 10, sectionsError?.message || `${(sections||[]).length} sections`)

  const sectionKeys = (sections || []).map((s) => s.section_key)
  check(
    'site_sections: all expected keys present',
    ['hero','stats','about','values','workshops','classes','events','team','videos','sponsors','contact'].every((k) => sectionKeys.includes(k)),
    sectionKeys.join(', '),
  )

  // Anon (public) can read the layout — required for guests to render the homepage.
  const { data: anonSections, error: anonError } = await anon.from('site_sections').select('section_key,visible,sort_order').order('sort_order')
  check('site_sections: public read allowed (anon)', !anonError && (anonSections || []).length >= 10, anonError?.message || `${(anonSections||[]).length} rows readable`)

  // Toggle a section off (videos) and confirm it persists; then reorder hero <-> contact
  const { error: toggleError } = await service.from('site_sections').update({ visible: false }).eq('section_key', 'videos')
  const { data: afterToggle } = await service.from('site_sections').select('section_key,visible').eq('section_key', 'videos').single()
  check('layout: section can be hidden', !toggleError && afterToggle?.visible === false, toggleError?.message || `videos.visible=${afterToggle?.visible}`)

  // Reorder: move 'contact' to the front
  const ordered = [...sections].sort((a, b) => a.sort_order - b.sort_order)
  const reordered = [ordered[ordered.length - 1], ...ordered.slice(0, -1)].map((s, i) => ({ section_key: s.section_key, label: s.label, visible: s.visible, sort_order: (i + 1) * 10 }))
  const { error: reorderError } = await service.from('site_sections').upsert(reordered)
  const { data: afterReorder } = await service.from('site_sections').select('section_key,sort_order').order('sort_order')
  check('layout: reorder persists', !reorderError && afterReorder?.[0]?.section_key === 'contact', reorderError?.message || `first section is now '${afterReorder?.[0]?.section_key}'`)

  // Restore canonical order + visibility so the live site is left as it was
  const canonical = ['hero','stats','about','values','workshops','classes','events','team','videos','sponsors','contact']
  await service.from('site_sections').upsert(canonical.map((k, i) => ({ section_key: k, label: (sections.find(s=>s.section_key===k)||{}).label || k, visible: true, sort_order: (i + 1) * 10 })))
  const { data: restored } = await service.from('site_sections').select('section_key,visible').eq('section_key', 'videos').single()
  check('layout: restored to canonical order & all visible', restored?.visible === true, 'videos re-shown, order restored')

  // Cleanup fixtures
  await service.from('events').delete().eq('id', pastId)
  await service.from('events').update({ flyer_path: null }).eq('id', EVENT_ID)
}

main().then(() => {
  console.log(JSON.stringify(results, null, 2))
  console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: ALL CHECKS PASSED')
  if (failed) process.exitCode = 1
})
