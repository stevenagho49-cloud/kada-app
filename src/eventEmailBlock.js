/* ------------------------------------------------------------------ */
/* Event block for email campaigns: flyer, title, date/time, venue and */
/* a button to the event's public page (/event/<id>). Shared by the     */
/* campaign editor (preview) and the server, which re-renders every     */
/* block from the event's current row when each email is sent, so a    */
/* changed date or venue is always what goes out.                       */
/*                                                                      */
/* In the stored campaign HTML a block sits between markers:            */
/*   <!--kada-event:<id>--> …rendered block… <!--/kada-event-->          */
/* No React or Supabase imports: the Node server imports this file.     */
/* ------------------------------------------------------------------ */

const E = '#0b3d2e'
const G = '#c9a227'
const SERIF = "Georgia,'Times New Roman',serif"

export const EVENT_BLOCK_PATTERN = /<!--kada-event:([\w-]+)-->[\s\S]*?<!--\/kada-event-->/g

const esc = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function formatTime(value) {
  if (!value) return ''
  const [hours, minutes] = String(value).split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return String(value)
  const suffix = hours >= 12 ? 'pm' : 'am'
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${suffix}`
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
}

// Accepts a database row (event_date, flyer_path…) or the app's normalised event (eventDate, flyerPath…).
export function eventFields(event) {
  return {
    id: event.id,
    title: event.title || 'Event',
    date: event.event_date ?? event.eventDate ?? '',
    start: event.event_time ?? event.eventTime ?? '',
    end: event.event_end_time ?? event.eventEndTime ?? '',
    location: event.location || '',
    flyerPath: event.flyer_path ?? event.flyerPath ?? '',
    ticketing: Boolean(event.ticketing_enabled ?? event.ticketingEnabled),
  }
}

export const eventPageUrl = (siteUrl, id) => `${String(siteUrl).replace(/\/$/, '')}/event/${id}`

export function eventFlyerUrl(supabaseUrl, flyerPath) {
  return flyerPath && supabaseUrl ? `${String(supabaseUrl).replace(/\/$/, '')}/storage/v1/object/public/event-flyers/${String(flyerPath).split('/').map(encodeURIComponent).join('/')}` : ''
}

// The block's HTML, markers included.
export function renderEventBlock(event, { siteUrl, supabaseUrl }) {
  const fields = eventFields(event)
  const url = eventPageUrl(siteUrl, fields.id)
  const flyer = eventFlyerUrl(supabaseUrl, fields.flyerPath)
  const time = [formatTime(fields.start), formatTime(fields.end)].filter(Boolean).join(' to ')
  const when = [formatDate(fields.date), time].filter(Boolean).join(' · ')
  const inner = [
    flyer ? `<a href="${url}" style="display:block;text-decoration:none"><img src="${flyer}" alt="${esc(fields.title)} flyer" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:10px;margin:0 0 14px"></a>` : '',
    `<h2 style="font-family:${SERIF};font-size:22px;font-weight:500;color:${E};margin:0 0 8px;line-height:1.3">${esc(fields.title)}</h2>`,
    when ? `<p style="margin:0 0 4px;font-size:15px"><strong>When:</strong> ${esc(when)}</p>` : '',
    fields.location ? `<p style="margin:0 0 4px;font-size:15px"><strong>Where:</strong> ${esc(fields.location)}</p>` : '',
    `<p style="margin:16px 0 4px"><a href="${url}" style="background:${G};color:${E};padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:14px">${fields.ticketing ? 'Get tickets' : 'Find out more'} →</a></p>`,
  ].join('')
  return `<!--kada-event:${fields.id}--><div style="border:1px solid #e4ddc9;border-radius:12px;padding:16px;margin:18px 0;background:#fffdf8">${inner}</div><!--/kada-event-->`
}

// Event ids referenced by a campaign body.
export const eventIdsIn = (html) => [...new Set([...String(html || '').matchAll(EVENT_BLOCK_PATTERN)].map((match) => match[1]))]

// Re-renders every block from current event data. Returns the ids that could not
// be rendered (deleted, or no longer published) so the caller can refuse to send.
export function refreshEventBlocks(html, eventsById, options) {
  const missing = new Set()
  const out = String(html || '').replace(EVENT_BLOCK_PATTERN, (block, id) => {
    const event = eventsById.get(id)
    if (!event || (event.status ?? 'published') !== 'published') { missing.add(id); return block }
    return renderEventBlock(event, options)
  })
  return { html: out, missing: [...missing] }
}
