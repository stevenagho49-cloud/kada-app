import { supabase } from '../lib/supabase'

/* Shared by Operations > Homework and the parent dashboard. */

const emerald = '#0b3d2e'
const muted = '#767066'

// youtube.com/watch?v=, youtu.be/, /shorts/, /embed/, /live/ → the video id (same rules as the server).
export function youtubeId(url) {
  try {
    const parsed = new URL(String(url).trim())
    const host = parsed.hostname.replace(/^(www|m|music)\./, '')
    let id = ''
    if (host === 'youtu.be') id = parsed.pathname.slice(1).split('/')[0]
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = parsed.searchParams.get('v') || (parsed.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/) || [])[2] || ''
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : ''
  } catch {
    return ''
  }
}

export const homeworkImageUrl = (path) => (path ? supabase.storage.from('homework-images').getPublicUrl(path).data.publicUrl : '')
export const formatHomeworkDate = (value) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/* Instructions, reference image and practice video for one task. */
export function HomeworkContent({ task }) {
  const imageUrl = homeworkImageUrl(task.image_path)
  return (
    <div>
      {task.description && <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.6, color: '#2c2a24', overflowWrap: 'anywhere' }}>{task.description}</div>}
      {imageUrl && (
        <a href={imageUrl} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 12 }}>
          <img src={imageUrl} alt={`Reference for ${task.title}`} loading="lazy" style={{ display: 'block', width: '100%', maxWidth: 560, maxHeight: 420, objectFit: 'contain', borderRadius: 10, background: '#f1ece0' }} />
        </a>
      )}
      {task.youtube_id && (
        <div style={{ marginTop: 12, maxWidth: 560 }}>
          <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${task.youtube_id}`}
              title={`Practice video: ${task.title}`}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          </div>
          <a href={`https://www.youtube.com/watch?v=${task.youtube_id}`} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, color: emerald, fontWeight: 700, fontSize: 14 }}>▶ Watch on YouTube</a>
        </div>
      )}
      {!task.description && !imageUrl && !task.youtube_id && <p style={{ color: muted, margin: 0 }}>No extra instructions.</p>}
    </div>
  )
}
