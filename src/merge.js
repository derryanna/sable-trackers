import { BOND_SCALES, SECTIONS } from './sections.js';

const clone = value => value === undefined ? undefined : structuredClone(value);

// Caps on the accumulated collections (SPEC §33): the schema bounds each reply, the merged lists were unbounded.
export const CAPS = Object.freeze({ npcs: 80, bonds: 80, dossiers: 150 });
/** Drops the oldest unprotected items (array order is arrival order) until `list` fits `cap`; protected items may exceed it. */
function capped(list, cap, protect) {
  if (!(list.length > cap)) return list;
  const victims = new Set();
  for (const item of list) { if (victims.size >= list.length - cap) break; if (!protect(item)) victims.add(item); }
  return list.filter(item => !victims.has(item));
}

function mergeDossiers(previous = [], incoming = []) {
  const result = clone(previous) ?? [];
  const known = new Set(result.map(item => item.name?.trim().toLocaleLowerCase()).filter(Boolean));
  const fresh = new Set();
  for (const dossier of incoming) {
    const key = dossier.name?.trim().toLocaleLowerCase();
    if (key && !known.has(key)) { const copy = clone(dossier); result.push(copy); fresh.add(copy); known.add(key); }
  }
  return capped(result, CAPS.dossiers, item => fresh.has(item));
}

function mergeBanlist(previous = [], incoming = []) {
  const result = [];
  const seen = new Set();
  for (const item of [...previous, ...incoming]) {
    const key = `${item?.pattern ?? ''}\u0000${item?.example ?? ''}`;
    if (!item?.pattern || seen.has(key)) continue;
    seen.add(key); result.push(clone(item));
  }
  return result.slice(-8);
}

function mergeById(previous = [], incoming = [], cap = Infinity, protect = () => false) {
  const result = clone(previous);
  const touched = new Set(incoming.map(item => item.id));
  for (const item of incoming) {
    const index = result.findIndex(old => old.id === item.id);
    if (index < 0) result.push(clone(item));
    else result[index] = clone(item);
  }
  return capped(result, cap, item => touched.has(item.id) || protect(item));
}

function recomputeBonds(previous = [], incoming = [], scales = BOND_SCALES) {
  const oldById = new Map(previous.map(item => [item.id || item.name, item]));
  const updated = incoming.map(bond => {
    const old = oldById.get(bond.id || bond.name);
    const stats = clone(bond.stats) ?? {};
    for (const scale of scales) {
      if (!Object.hasOwn(stats, scale) && typeof old?.stats?.[scale] === 'number') stats[scale] = old.stats[scale];
    }
    const claimed = bond.changes ?? {};
    const changes = {};
    for (const scale of scales) {
      const before = old?.stats?.[scale]; const after = stats[scale];
      if (typeof before !== 'number' || typeof after !== 'number' || before === after) continue;
      const delta = after - before;
      const modelChange = claimed[scale];
      const matchingSign = modelChange && Math.sign(Number(modelChange.delta)) === Math.sign(delta);
      changes[scale] = { delta, reason: matchingSign && modelChange.reason ? modelChange.reason : '(recomputed)' };
    }
    return { ...clone(bond), stats, changes };
  });
  // Bonds the model did not return keep their numbers, but last turn's deltas are stale.
  return mergeById(previous.map(bond => ({ ...clone(bond), changes: {} })), updated, CAPS.bonds);
}

// The active bond scales are the stats fields of the registry's bonds schema (SPEC §20).
const activeScales = registry => {
  const fields = registry.find(section => section.id === 'bonds')?.schema?.item?.fields?.stats?.fields;
  return fields ? Object.keys(fields) : BOND_SCALES;
};

/** Merge only requested, valid sections and preserve every other previous value. */
export function mergeState(previousState = {}, parsed = {}, options = {}) {
  const incoming = parsed.sections ?? parsed.state ?? parsed;
  const valid = new Set(parsed.validSections ?? Object.keys(incoming ?? {}));
  const requested = options.requestedSections ?? options.requested ?? [...valid];
  const registry = options.sections ?? SECTIONS;
  const known = new Set(registry.map(section => section.id));
  const next = clone(previousState) ?? {};
  for (const id of requested) {
    if (!known.has(id) || !valid.has(id) || incoming?.[id] === undefined) continue;
    if (id === 'dossiers') next[id] = mergeDossiers(previousState.dossiers, incoming[id]);
    else if (id === 'banlist') next[id] = mergeBanlist(previousState.banlist, incoming[id]);
    else if (id === 'npcs') next[id] = mergeById(previousState.npcs, incoming[id], CAPS.npcs, item => item.present === true);
    else if (id === 'bonds') next[id] = recomputeBonds(previousState.bonds, incoming[id], activeScales(registry));
    else if (registry.find(s => s.id === id)?.shape === 'stats') {
      const before = new Map((Array.isArray(previousState[id]) ? previousState[id] : []).map(item => [item.key, item.value]));
      next[id] = incoming[id].map(item => {
        const value = clone(item); delete value.delta;
        if (Number.isFinite(before.get(item.key))) value.delta = item.value - before.get(item.key);
        return value;
      });
    } else next[id] = clone(incoming[id]);
  }
  if (options.meta) next.meta = { ...(previousState.meta ?? {}), ...options.meta };
  return next;
}

export const merge = mergeState;
