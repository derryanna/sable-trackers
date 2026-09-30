export const STORE_KEY = 'sableTrackers';

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

export function currentEntry(data, chat, before = Infinity) {
  return data.ring.filter(entry => entry.mesId < before && chat[entry.mesId]
    && entry.swipeId === (chat[entry.mesId].swipe_id ?? 0))
    .sort((a, b) => a.mesId - b.mesId).at(-1);
}

export function restoreCounters(data, entry) {
  data.turnsSince = structuredClone(entry?.turnsSince ?? {});
}

export function putEntry(data, entry, keep) {
  data.ring = data.ring.filter(old => old.mesId <= entry.mesId
    && !(old.mesId === entry.mesId && old.swipeId === entry.swipeId));
  data.ring.push(structuredClone(entry));
  data.ring = data.ring.slice(-keep);
  restoreCounters(data, entry);
}

export function pruneEntries(data, length) {
  data.ring = data.ring.filter(entry => entry.mesId < length);
}
