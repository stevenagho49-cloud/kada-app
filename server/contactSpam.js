/* Spots website contact messages that look like bot-generated random strings,  */
/* e.g. name "VcQjJpRpXbOnYzEw", message "aMhTzKnKbWfQyGwIqLxOnXcG". A flagged  */
/* message is held for review in Operations > Contacts, never thrown away, so  */
/* these checks lean towards catching gibberish rather than being perfect.     */
/* Links, email addresses and payment references (cs_live_…, pi_…) are skipped */
/* because real parents paste them.                                            */

const isSkippable = (token) => /^(https?:\/\/|www\.)/i.test(token) || /\S+@\S+\.\S+/.test(token) || /^[a-z]{2,6}_/i.test(token)

// Lower-to-upper switches inside one word: "McDonald" has 1, "fXqYlPdZkR" has 4.
const caseSwitches = (word) => (word.match(/[a-z][A-Z]/g) || []).length
const longestConsonantRun = (word) => Math.max(0, ...(word.toLowerCase().match(/[bcdfghjklmnpqrstvwxz]+/g) || []).map((run) => run.length))
const vowelShare = (word) => (word.match(/[aeiouy]/gi) || []).length / word.length

function gibberishWords(text) {
  const reasons = []
  for (const token of String(text).split(/\s+/).filter(Boolean)) {
    if (isSkippable(token)) continue
    const word = token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
    if (!/^[A-Za-z]{6,}$/.test(word)) continue
    if (caseSwitches(word) >= 3) reasons.push(`random capitals in "${word.slice(0, 40)}"`)
    else if (longestConsonantRun(word) >= 6) reasons.push(`unpronounceable word "${word.slice(0, 40)}"`)
    else if (word.length >= 8 && vowelShare(word) < 0.15) reasons.push(`almost no vowels in "${word.slice(0, 40)}"`)
  }
  return reasons
}

export function contactSpamReasons({ name = '', message = '' }) {
  const reasons = []
  const text = String(message).trim()
  if (text.length >= 15 && !/\s/.test(text)) reasons.push('message has no spaces')
  const longToken = text.split(/\s+/).find((token) => token.length >= 30 && !isSkippable(token))
  if (longToken) reasons.push(`very long text with no spaces ("${longToken.slice(0, 40)}…")`)
  reasons.push(...gibberishWords(name).map((reason) => `name: ${reason}`))
  reasons.push(...gibberishWords(text).map((reason) => `message: ${reason}`))
  return [...new Set(reasons)].slice(0, 5)
}
