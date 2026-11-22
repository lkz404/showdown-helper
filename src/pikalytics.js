// Pikalytics "AI" markdown endpoint: https://www.pikalytics.com/ai/pokedex/{format}/{Species}
// (verified 2026-11: gen9vgc2026regf, gen9vgc2025regi and gen9ou all respond; unknown
// species return 404 "Pokemon not found").

// Fallbacks used when Pikalytics has no data for the battle's own format.
export const FALLBACK_DOUBLES = 'gen9vgc2026regf';
export const FALLBACK_SINGLES = 'gen9ou';
// Pokémon Champions is a different game (its own movepools and Megas): its formats fall back
// to Champions data, never to Scarlet/Violet's (verified 2026-11 on /ai/pokedex).
export const FALLBACK_CHAMPIONS_DOUBLES = 'gen9championsvgc2026regmc';
export const FALLBACK_CHAMPIONS_SINGLES = 'gen9championsou';

// Showdown format id -> Pikalytics slug, or '' when the format has no meaningful
// usage data of its own (randoms, customs) and only the fallback should be used.
export function toPikalyticsFormat(showdownFormat) {
  let f = String(showdownFormat || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  f = f.replace(/bo3$/, ''); // "gen9vgc2026regfbo3" -> "gen9vgc2026regf"
  if (!/^gen\d/.test(f)) return '';
  if (/random|custom|challengecup|hackmons/.test(f)) return '';
  return f;
}

export function formatCandidates(showdownFormat, gameType) {
  const primary = toPikalyticsFormat(showdownFormat);
  const doubles = /doubles|triples|multi/i.test(gameType || '') || /vgc|doubles/.test(primary);
  const champions = /^gen9champions/.test(String(showdownFormat || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const fallback = champions
    ? (doubles ? FALLBACK_CHAMPIONS_DOUBLES : FALLBACK_CHAMPIONS_SINGLES)
    : (doubles ? FALLBACK_DOUBLES : FALLBACK_SINGLES);
  return [...new Set([primary, fallback].filter(Boolean))];
}

// Pikalytics species URL names keep spaces ("Flutter Mane", "Tapu Koko") and real
// forme hyphens ("Urshifu-Rapid-Strike", "Chi-Yu"); the URL builder percent-encodes them.
export function toPikalyticsSpecies(name) {
  return String(name || '')
    .trim()
    .replace(/[’']/g, '')
    .replace(/[.:]/g, '')
    .replace(/\s+/g, ' ');
}

// Exact name first, then progressively drop trailing "-Forme" parts so battle-only
// formes ("Ogerpon-Wellspring-Tera", "Palafin-Hero", "Terapagos-Stellar") still find
// usage data for the form that was actually brought.
export function speciesCandidates(name) {
  const out = [toPikalyticsSpecies(name)];
  let s = out[0];
  while (s.lastIndexOf('-') > 0) {
    s = s.slice(0, s.lastIndexOf('-'));
    // "Chi-Yu" -> "Chi" etc. would be a different/nonexistent mon; harmless (404)
    out.push(s);
  }
  return out.filter(Boolean);
}

export function parseTopMoves(markdown, limit = 5) {
  const text = String(markdown || '').replace(/\r\n?/g, '\n');
  const section = text.match(/## Common Moves[^\n]*\n([\s\S]*?)(?=\n## |$)/);
  if (!section) return [];
  const moves = [];
  for (const line of section[1].split('\n')) {
    const m = line.match(/^\s*[-*] \*\*(.+?)\*\*:\s*([\d.]+)%/);
    if (!m) continue;
    if (m[1].toLowerCase() === 'other' || m[1].toLowerCase() === 'nothing') continue;
    moves.push({ move: m[1].trim(), pct: parseFloat(m[2]) });
  }
  return moves.sort((a, b) => b.pct - a.pct).slice(0, limit);
}

async function fetchMoves(format, species, fetchImpl = fetch) {
  const url = `https://www.pikalytics.com/ai/pokedex/${format}/${encodeURIComponent(species)}`;
  const res = await fetchImpl(url);
  if (!res.ok) return null;
  const moves = parseTopMoves(await res.text());
  return moves.length ? moves : null;
}

// Returns { format, species, moves } or null.
// Order: battle format (exact species, then stripped formes), then the fallback format.
// Throws if nothing was found and at least one request failed at the network level,
// so callers don't cache a transient outage as "no data".
export async function getTopMoves(showdownFormat, speciesName, gameType, fetchImpl = fetch) {
  let error = null;
  for (const format of formatCandidates(showdownFormat, gameType)) {
    for (const species of speciesCandidates(speciesName)) {
      try {
        const moves = await fetchMoves(format, species, fetchImpl);
        if (moves) return { format, species, moves };
      } catch (e) {
        error = e; // try next candidate
      }
    }
  }
  if (error) throw error;
  return null;
}
