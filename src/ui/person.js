// Person card editing (SPEC §25): pure helpers shared by the drawer and the tests. No DOM, no SillyTavern globals.

// The NPC-keyed sections behind a person card (SPEC §21).
export const PERSON_SECTIONS = Object.freeze(['npcs', 'thoughts', 'bonds', 'dossiers']);

const lower = text => String(text ?? '').trim().toLowerCase();
const list = value => (Array.isArray(value) ? value : []);

/** The id a new row gets from its name: the same rule as the schema sanitizer (and so the section editor). */
export function deriveId(name, max = 80) {
  return String(name ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_]/gu, '').replace(/\s+/g, '_').slice(0, max);
}

/** `deriveId(name)`, made unique against `taken` (ids already used) with a `_2`, `_3`… suffix. */
export function newPersonId(name, taken = []) {
  const used = new Set(taken), base = deriveId(name) || 'npc';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  return id;
}

/** One string for the four sections, compared to tell that the data under an open form changed. */
export function personFingerprint(state) {
  return JSON.stringify(PERSON_SECTIONS.map(id => state?.[id] ?? null));
}

/** Whether a dossier belongs to this person, as the people layout matches it: by id, or by name (case-insensitive)
 *  against the NPC's name or id. */
export function dossierMatches(item, person) {
  if (!item) return false;
  if (item.id && item.id === person.id) return true;
  const name = lower(item.name);
  return !!name && [person.npc?.name ?? person.name, person.id].some(value => lower(value) === name);
}

/** Replaces this person's items in `items` (matched by `match`) with `next` at the place of the first one, or appends
 *  `next` when the person had none. `next` = [] removes them. */
function splice(items, match, next) {
  const index = items.findIndex(match);
  const rest = items.filter(item => !match(item));
  if (index < 0) return [...rest, ...next];
  const before = items.slice(0, index).filter(item => !match(item)).length;
  return [...rest.slice(0, before), ...next, ...rest.slice(before)];
}

/** Applies a person draft to the four sections (SPEC §25). `sections` = `{ npcs, thoughts, bonds, dossiers }` (current
 *  values; missing ones read as empty), `person` = `{ id, name, npc? }` as the card was built, `draft` =
 *  `{ npc?, thought?, bond?, dossier? }`: an object replaces or adds that part (`bond` may be an array: all of the
 *  person's bonds), `null` removes it, an absent key leaves it alone. Returns only the sections that changed. */
export function applyPersonDraft(sections = {}, person = {}, draft = {}) {
  const id = person.npc?.id ?? person.id;
  const byId = item => item?.id === id;
  const parts = [
    ['npc', 'npcs', byId], ['thought', 'thoughts', byId], ['bond', 'bonds', byId],
    ['dossier', 'dossiers', item => dossierMatches(item, person)],
  ];
  const result = {};
  for (const [part, sectionId, match] of parts) {
    if (!draft || !Object.hasOwn(draft, part) || draft[part] === undefined) continue;
    const value = draft[part], before = list(sections[sectionId]);
    const next = value === null ? [] : (Array.isArray(value) ? value : [value]).filter(item => item && typeof item === 'object');
    const after = splice(before, match, next);
    if (JSON.stringify(after) !== JSON.stringify(before)) result[sectionId] = after;
  }
  return result;
}
