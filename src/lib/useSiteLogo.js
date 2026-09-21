import { useEffect, useState } from 'react'
import { supabase } from './supabase'

/* Shared site logo — the admin can replace every logo at once from           */
/* Operations > Administration > Settings > Branding (stored as a data URL    */
/* in site_content 'branding'.logoUrl). This hook reads it on pages that      */
/* don't otherwise load site_content (ticket page, legal pages) and caches    */
/* the result so repeat visits don't re-fetch.                                */

let cachedLogoUrl
let inflight

async function fetchLogoUrl() {
  if (cachedLogoUrl !== undefined) return cachedLogoUrl
  if (!inflight) {
    inflight = supabase
      ? supabase.from('site_content').select('value').eq('key', 'branding').maybeSingle()
        .then(({ data }) => data?.value?.logoUrl || '')
        .catch(() => '')
      : Promise.resolve('')
  }
  cachedLogoUrl = await inflight
  inflight = null
  return cachedLogoUrl
}

export function useSiteLogo(defaultLogo = '/images/logo-mark.png') {
  const [logoUrl, setLogoUrl] = useState(cachedLogoUrl || defaultLogo)
  useEffect(() => {
    let mounted = true
    fetchLogoUrl().then((url) => { if (mounted && url) setLogoUrl(url) })
    return () => { mounted = false }
  }, [])
  return logoUrl
}

/* Update the browser tab/apple-touch icons to match the custom logo. */
export function applySiteFavicon(logoUrl) {
  if (!logoUrl || typeof document === 'undefined') return
  document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((link) => link.setAttribute('href', logoUrl))
}
