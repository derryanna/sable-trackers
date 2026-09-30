import { BOND_SCALES, SECTIONS } from './sections.js';

const clone = value => value === undefined ? undefined : structuredClone(value);

function mergeDossiers(previous = [], incoming = []) {
  const result = clone(previous) ?? [];
  const known = new Set(result.map(item => item.name?.trim().toLocaleLowerCase()).filter(Boolean));
  for (const dossier of incoming) {
    const key = dossier.name?.trim().toLocaleLowerCase();
    if (key && !known.has(key)) { result.push(clone(dossier)); known.add(key); }
  }
  return result;
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

function mergeById(previous = [], incoming = []) {
  const result = clone(previous);
  for (const item of incoming) {
    const index = result.findIndex(old => old.id === item.id);
    if (index < 0) result.push(clone(item));
    else result[index] = clone(item);
  }
  return result;
}

function recomputeBonds(previous = [], incoming = []) {
  const oldById = new Map(previous.map(item => [item.id || item.name, item]));
  const updated = incoming.map(bond => {
    const old = oldById.get(bond.id || bond.name);
    const stats = clone(bond.stats) ?? {};
    for (const scale of BOND_SCALES) {
      if (!Object.hasOwn(stats, scale) && typeof old?.stats?.[scale] === 'number') stats[scale] = old.stats[scale];
    }
    const claimed = bond.changes ?? {};
    const changes = {};
    for (const scale of BOND_SCALES) {
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
  return mergeById(previous.map(bond => ({ ...clone(bond), changes: {} })), updated);
}

/** Merge only requested, valid sections and preserve every other previous value. */
export function mergeState(previousState = {}, parsed = {}, options = {}) {
  const incoming = parsed.sections ?? parsed.state ?? parsed;
  const valid = new Set(parsed.validSections ?? Object.keys(incoming ?? {}));
  const requested = options.requestedSections ?? options.requested ?? [...valid];
  const known = new Set((options.sections ?? SECTIONS).map(section => section.id));
  const next = clone(previousState) ?? {};
  for (const id of requested) {
    if (!known.has(id) || !valid.has(id) || incoming?.[id] === undefined) continue;
    if (id === 'dossiers') next[id] = mergeDossiers(previousState.dossiers, incoming[id]);
    else if (id === 'banlist') next[id] = mergeBanlist(previousState.banlist, incoming[id]);
    else if (id === 'npcs') next[id] = mergeById(previousState.npcs, incoming[id]);
    else if (id === 'bonds') next[id] = recomputeBonds(previousState.bonds, incoming[id]);
    else next[id] = clone(incoming[id]);
  }
  if (options.meta) next.meta = { ...(previousState.meta ?? {}), ...options.meta };
  return next;
}

export const merge = mergeState;
