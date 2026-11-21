import { getTopMoves } from './pikalytics.js';

const TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000; // remember "no data" for an hour
const inflight = new Map(); // dedupe concurrent lookups from several tabs/renders

async function getCached(format, species, gameType) {
  const key = `usage|${format}|${gameType}|${species}`;
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored && Date.now() - stored.t < (stored.data ? TTL_MS : MISS_TTL_MS)) return stored.data;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const data = await getTopMoves(format, species, gameType);
    await chrome.storage.local.set({ [key]: { t: Date.now(), data } });
    return data;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'usage') return;
  getCached(String(msg.format || ''), String(msg.species || ''), String(msg.gameType || '')).then(
    (data) => sendResponse({ ok: !!data, data }),
    (err) => sendResponse({ ok: false, error: String(err) })
  );
  return true; // async response
});
