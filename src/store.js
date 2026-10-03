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
  data.history ??= {};
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

// Bond history (SPEC §22): `history[bondId][scale]` = the last HISTORY_POINTS `{ mesId, value }` points; stats sections
// (SPEC §26) share the map as `history[sectionId][itemKey]`.
export const HISTORY_POINTS = 12;

/** Records one point per bond and active scale with a finite value; the same `mesId` (a swipe, an edit, a refresh)
 *  replaces the last point instead of adding one. Bonds missing from `bonds` keep their history until pruned. */
export function recordHistory(data, bonds, mesId, keys) {
  if (!Array.isArray(bonds) || !Number.isInteger(mesId)) return;
  const history = data.history ??= {};
  for (const bond of bonds) {
    if (!bond?.id) continue;
    for (const key of keys) addPoint(history, bond.id, key, mesId, bond.stats?.[key]);
  }
}

function addPoint(history, id, line, mesId, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  const points = (history[id] ??= {})[line] ??= [];
  if (points.at(-1)?.mesId === mesId) points.pop();
  points.push({ mesId, value });
  if (points.length > HISTORY_POINTS) points.splice(0, points.length - HISTORY_POINTS);
}

/** Stat history (SPEC §26): `history[sectionId][itemKey]` for the items of a `stats` value with a numeric `max`, by the
 *  same rules as bonds. Lines whose key is absent from `items` are dropped (a stat that disappears takes its line). */
export function recordStatHistory(data, sectionId, items, mesId) {
  if (typeof sectionId !== 'string' || !Array.isArray(items) || !Number.isInteger(mesId)) return;
  const history = data.history ??= {};
  const present = new Set();
  for (const item of items) {
    const key = typeof item?.key === 'string' ? item.key.trim() : '';
    if (!key) continue;
    present.add(key);
    if (typeof item.max === 'number' && Number.isFinite(item.max)) addPoint(history, sectionId, key, mesId, item.value);
  }
  const lines = history[sectionId];
  if (!lines) return;
  for (const key of Object.keys(lines)) if (!present.has(key)) delete lines[key];
  if (!Object.keys(lines).length) delete history[sectionId];
}

/** Drops points whose message is gone (`keepMesIds`: a Set of ids or a chat length) and empty scales and bonds. */
export function pruneHistory(data, keepMesIds) {
  const keep = typeof keepMesIds === 'number' ? id => id < keepMesIds : id => keepMesIds.has(id);
  for (const [id, scales] of Object.entries(data.history ?? {})) {
    for (const [key, points] of Object.entries(scales)) {
      const kept = Array.isArray(points) ? points.filter(point => keep(point?.mesId)) : [];
      if (kept.length) scales[key] = kept; else delete scales[key];
    }
    if (!Object.keys(scales).length) delete data.history[id];
  }
}
