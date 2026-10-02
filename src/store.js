import { getPacks } from './packs/index.js';

export const STORE_KEY = 'sableTrackers';

export function enabledPacks(data, settings = {}) {
  const ids = Array.isArray(data?.packs) ? data.packs : settings.packDefaults ?? [];
  return getPacks(settings).filter(pack => ids.includes(pack.id)).map(pack => pack.id);
}

export function loadStore(ctx) {
  const data = ctx.chatMetadata[STORE_KEY] ??= {};
  data.v = 1;
  if (!Array.isArray(data.ring)) data.ring = [];
  data.modeOverride ??= {};
  data.turnsSince ??= {};
  data.lastRun ??= null;
  return data;
}

// Coalesce synchronous mutations without leaving a timer attached to an old chat.
const pending = new WeakMap();
export function saveStore(ctx) {
  if (!pending.has(ctx.chatMetadata)) {
    const metadata = ctx.chatMetadata;
    const promise = Promise.resolve().then(() => ctx.saveMetadata()).catch(error => {
      console.warn('Sable Trackers: metadata save failed', error);
    }).finally(() => pending.delete(metadata));
    pending.set(metadata, promise);
  }
  return pending.get(ctx.chatMetadata);
}

export function findEntry(data, mesId, swipeId = 0) {
  return data.ring.findLast(entry => entry.mesId === mesId && entry.swipeId === swipeId);
}

export function currentEntry(data, chat, before = Infinity, { skipStale = false } = {}) {
  return data.ring.filter(entry => entry.mesId < before && (!skipStale || entry.stale !== true) && chat[entry.mesId]
    && entry.swipeId === (chat[entry.mesId].swipe_id ?? 0))
    .sort((a, b) => a.mesId - b.mesId).at(-1);
}

export function restoreCounters(data, entry) {
  data.turnsSince = structuredClone(entry?.turnsSince ?? {});
}

// Swipes kept per message; the oldest by ring position go first.
export const SWIPES_PER_MESSAGE = 6;

/** Stores an entry. A rewrite of an earlier message invalidates later states; the ring then keeps the newest
 *  `keep` distinct message ids with all their swipes (at most SWIPES_PER_MESSAGE each), not `keep` entries in total,
 *  so swiping one reply never evicts the state before it. */
export function putEntry(data, entry, keep) {
  const ring = data.ring.filter(old => old.mesId <= entry.mesId
    && !(old.mesId === entry.mesId && old.swipeId === entry.swipeId));
  ring.push(structuredClone(entry));
  const kept = new Set([...new Set(ring.map(old => old.mesId))].sort((a, b) => a - b).slice(-keep));
  const remaining = new Map();
  for (const old of ring) remaining.set(old.mesId, (remaining.get(old.mesId) ?? 0) + 1);
  data.ring = ring.filter(old => {
    // Entries of the same message after this one; the newest SWIPES_PER_MESSAGE survive.
    const later = remaining.get(old.mesId) - 1;
    remaining.set(old.mesId, later);
    return kept.has(old.mesId) && later < SWIPES_PER_MESSAGE;
  });
  restoreCounters(data, entry);
}

export function pruneEntries(data, length) {
  data.ring = data.ring.filter(entry => entry.mesId < length);
}
