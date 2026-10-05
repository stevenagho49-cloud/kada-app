/* Event flyers are shown at most ~520px wide (about 1050 device pixels on a  */
/* 3x phone) and in 504px emails, so every upload is resized and re-encoded  */
/* as JPEG in the browser before it reaches storage. JPEG rather than WebP   */
/* because the same file is embedded in campaign emails (Outlook).           */
export const FLYER_MAX_WIDTH = 1600
export const FLYER_MAX_HEIGHT = 2400
export const FLYER_QUALITY = 0.88

export function flyerTargetSize(width, height, { maxWidth = FLYER_MAX_WIDTH, maxHeight = FLYER_MAX_HEIGHT } = {}) {
  if (!(width > 0 && height > 0)) throw new Error('That image has no size.')
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function flyerFileName(name) {
  const base = String(name || 'flyer').replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'flyer'
  return `${base}.jpg`
}

async function decodeImage(file) {
  try {
    // from-image applies EXIF rotation, so phone photos stay upright.
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('That image could not be read. Please upload a JPEG, PNG or WebP file.')
  }
}

export async function compressFlyer(file) {
  const bitmap = await decodeImage(file)
  const originalWidth = bitmap.width
  const originalHeight = bitmap.height
  const { width, height } = flyerTargetSize(originalWidth, originalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  // JPEG has no transparency: flatten onto white instead of black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', FLYER_QUALITY))
  if (!blob) throw new Error('The flyer could not be compressed. Please try another image.')
  return { blob, width, height, originalWidth, originalHeight }
}
