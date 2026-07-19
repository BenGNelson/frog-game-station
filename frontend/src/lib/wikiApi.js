import { API_BASE } from './useApi.js'

// Client for the in-game wiki reader's endpoints (backend routers/wiki.py). URL
// builders are pure (unit-tested); the fetch wrappers are thin and degrade to a
// thrown/typed result the panel turns into a friendly state.

const enc = encodeURIComponent

export function wikiSourceUrl(id, name) {
  let u = `${API_BASE}/library/games/wiki?id=${enc(id)}`
  if (name) u += `&name=${enc(name)}` // lets the backend pick a curated default page
  return u
}

export function wikiPageUrl(id, title, host, name) {
  let u = `${API_BASE}/library/games/wiki/page?id=${enc(id)}`
  if (title) u += `&title=${enc(title)}`
  if (host) u += `&host=${enc(host)}` // a deep-link to a specific (curated) wiki, e.g. Bulbapedia
  if (name) u += `&name=${enc(name)}` // for the curated default when no explicit host
  return u
}

export function wikiSearchUrl(id, q, host, name) {
  let u = `${API_BASE}/library/games/wiki/search?id=${enc(id)}&q=${enc(q)}`
  if (host) u += `&host=${enc(host)}`
  if (name) u += `&name=${enc(name)}` // lets the backend curate a family wiki when unlinked
  return u
}

// The game's resolved wiki source: { enabled, resolved: {host, title, url, source}|null }.
export async function fetchWikiSource(id, name) {
  const r = await fetch(wikiSourceUrl(id, name))
  if (!r.ok) throw new Error(`wiki source ${r.status}`)
  return r.json()
}

// One sanitized article: { host, title, html, sections }. A 404 (no such page /
// no wiki) is surfaced via err.status so the panel can distinguish it.
export async function fetchWikiPage(id, title, host, name) {
  const r = await fetch(wikiPageUrl(id, title, host, name))
  if (!r.ok) {
    const err = new Error(`wiki page ${r.status}`)
    err.status = r.status
    throw err
  }
  return r.json()
}

// Title suggestions to pin a page: { host, results: [{title, url}] }. Best-effort —
// a failure is an empty list, not an error (the picker just shows nothing).
export async function searchWiki(id, q, host, name) {
  try {
    const r = await fetch(wikiSearchUrl(id, q, host, name))
    if (!r.ok) return { results: [] }
    return r.json()
  } catch {
    return { results: [] }
  }
}

// Pin (url set) or clear (url null) a game's wiki override. Returns the newly
// resolved source so the caller can re-render without a second fetch.
export async function setWikiOverride(id, wikiUrl) {
  const r = await fetch(`${API_BASE}/library/games/wiki`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, wiki_url: wikiUrl || null }),
  })
  if (!r.ok) throw new Error(`wiki override ${r.status}`)
  return r.json()
}
