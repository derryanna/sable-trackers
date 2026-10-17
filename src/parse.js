import { SECTIONS, isSafeKey } from './sections.js';

const trim = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : undefined;

function sanitize(value, schema) {
  if (!schema) return undefined;
  if (schema.type === 'string') {
    const result = trim(value, schema.max);
    return schema.min && !result ? undefined : result;
  }
  if (schema.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (schema.type === 'integer') {
    if (schema.nullable && (value == null || typeof value !== 'number' || !Number.isFinite(value))) return null;
    if (schema.numberOnly && typeof value !== 'number') return undefined;
    const n = Number(value); if (!Number.isFinite(n)) return undefined;
    return Math.min(schema.max ?? n, Math.max(schema.min ?? n, Math.round(n)));
  }
  if (schema.type === 'score') {
    if (value === null) return null;
    // Signed scales (SPEC §22) carry min: -100; the default range is 0–100.
    const n = Number(value); return Number.isFinite(n) ? Math.min(100, Math.max(schema.min ?? 0, Math.round(n))) : undefined;
  }
  if (schema.type === 'enum') return schema.values.includes(value) ? value : schema.fallback;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return undefined;
    if (schema.unique) {
      const seen = new Set(), items = [];
      for (const raw of value) {
        const item = sanitize(raw, schema.item);
        if (item === undefined) continue;
        const key = schema.unique === true ? item : item[schema.unique];
        if (seen.has(key)) continue;
        seen.add(key); items.push(item);
        if (items.length >= schema.max) break;
      }
      return items;
    }
    const items = value.slice(0, schema.max).map(item => sanitize(item, schema.item)).filter(item => item !== undefined);
    return items;
  }
  if (schema.type === 'changes') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, change] of Object.entries(value)) {
      if (!isSafeKey(key) || !change || typeof change !== 'object') continue;
      const delta = Number(change.delta); if (!Number.isFinite(delta)) continue;
      out[key] = { delta: Math.round(delta), reason: trim(change.reason, 300) ?? '' };
    }
    return out;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if (schema.allowUnknown) return structuredClone(value);
    const out = {};
    for (const [key, child] of Object.entries(schema.fields ?? {})) {
      const cleaned = sanitize(value[key], child);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    if (schema.fields?.id && schema.fields?.name) {
      if (!out.id && out.name) out.id = out.name.toLowerCase().replace(/[^\p{L}\p{N}\s_]/gu, '').replace(/\s+/g, '_').slice(0, schema.fields.id.max);
      if (!out.id) return undefined;
    }
    // A reserved name would reach Object.prototype as a key of the history and merge maps (SPEC §33).
    if (['id', 'key'].some(field => out[field] !== undefined && !isSafeKey(out[field]))) return undefined;
    if (schema.required?.some(key => out[key] === undefined)) return undefined;
    return out;
  }
}

/** Validate one section value (model output or a manual edit) with the section's schema; undefined = invalid. */
export function sanitizeSection(section, value) {
  return sanitize(value, section?.schema);
}

const OPEN_TAG = /<sable_state\b/i, CLOSE_TAG = /<\/sable_state\s*>/i;

/** The JSON candidate inside the reply: the tagged body, else the outermost braces; code fences stripped. */
function candidateJson(text) {
  const tagged = text.match(/<sable_state\b[^>]*>([\s\S]*?)<\/sable_state\s*>/i)?.[1];
  const candidate = tagged ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return candidate.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

/** Append the brackets a reply forgot to close (string-aware), after dropping a dangling comma. */
function balanceClosers(text) {
  const stack = [];
  let inString = false, escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if ((ch === '}' || ch === ']') && stack.at(-1) === ch) stack.pop();
  }
  return text.replace(/,\s*$/, '') + (inString ? '"' : '') + stack.reverse().join('');
}

/** Replace raw control characters (tabs, newlines) inside string literals with spaces. */
function fixControlChars(text) {
  let out = '', inString = false, escaped = false;
  for (const ch of text) {
    if (inString) {
      if (ch < ' ') { out += ' '; continue; }
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/** The end (exclusive) of the first balanced object or array that starts at `from`, or -1. */
function balancedEnd(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{' && text[i] !== '[') return -1;
  const stack = [];
  let inString = false, escaped = false;
  for (let k = i; k < text.length; k++) {
    const ch = text[k];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.at(-1) === ch) stack.pop();
      if (!stack.length) return k + 1;
    }
  }
  return -1;
}

/** Replace a closing bracket of the wrong kind (`}` where the open bracket was `[`, or the reverse). */
function fixMismatchedClosers(text) {
  const stack = [];
  let out = '', inString = false, escaped = false;
  for (const ch of text) {
    let next = ch;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.length && stack.at(-1) !== ch) next = stack.at(-1);
      if (stack.length) stack.pop();
    }
    out += next;
  }
  return out;
}

// Syntax slips seen in side-model output (SPEC §31). Each repair is kept only when its result parses, so a
// pattern that happens to occur inside a legitimate string never changes a reply that was valid to begin with.
const REPAIRS = [
  // A comma before a closing bracket.
  text => text.replace(/,\s*([}\]])/g, '$1'),
  fixControlChars,
  // A bare word with a full-width colon squeezed between two members: `},grudge："","grudge":{`.
  text => text.replace(/,\s*[A-Za-z_][A-Za-z0-9_]*\s*：[^,}\]]*/g, ''),
  fixMismatchedClosers,
  // A stray quote (straight or typographic) before an object or array item: `},"{"id"` instead of `},{"id"`.
  text => text.replace(/([[,:]\s*)["'’‘“”]\s*([{[])/g, '$1$2'),
  // A doubled opener in front of the first key: `{"{"id"` or `{""id"` instead of `{"id"`.
  text => text.replace(/\{\s*"\s*\{\s*"/g, '{"').replace(/\{\s*""(?=\s*[A-Za-z_])/g, '{"'),
  // A quote-like token standing alone between two items: `},’,{` instead of `},{`.
  text => text.replace(/([}\]])\s*,\s*["'’‘“”]\s*,\s*([{[])/g, '$1,$2'),
  // A key opened with a single or typographic quote: `'legacy_stats":`.
  text => text.replace(/([{,]\s*)['’‘“”]([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '$1"$2":'),
  // An item that lost its opening brace: `},"id":` instead of `},{"id":`.
  text => text.replace(/([}\]]\s*,\s*)("id"\s*:)/g, '$1{$2'),
  // An empty key left before a closing bracket: `,""}`.
  text => text.replace(/,\s*""\s*(?=[}\]])/g, ''),
  // A string value whose closing quote is missing right before the bracket that closes its container.
  text => text.replace(/(:\s*"(?:[^"\\\n]|\\.)*?)([}\]])(?=\s*(?:,\s*["{[]|[}\]]|$))/g, '$1"$2'),
  balanceClosers,
];

/** The first repaired variant of `text` that parses as JSON: the text itself, one repair alone, or the repairs
 *  applied cumulatively. `null` when nothing parses. */
export function repairJson(text) {
  if (tryParse(text) !== undefined) return text;
  let current = text;
  for (const repair of REPAIRS) {
    const alone = repair(text);
    if (tryParse(alone) !== undefined) return alone;
    current = repair(current);
    if (tryParse(current) !== undefined) return current;
  }
  return null;
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Recover the sections of an unparseable object one by one: the value after each known `"id":` key runs up to
 *  the next known key (or the end); each slice is parsed on its own, repaired when needed. Sections whose
 *  slice still does not parse are dropped and reported. */
export function salvageSections(text, ids) {
  const found = [];
  for (const id of ids) {
    const match = new RegExp(`"${escapeRegExp(id)}"\\s*:`).exec(text);
    if (match) found.push({ id, start: match.index, valueStart: match.index + match[0].length });
  }
  found.sort((a, b) => a.start - b.start);
  const sections = {}, dropped = [];
  found.forEach((item, index) => {
    const last = index + 1 === found.length;
    const slice = text.slice(item.valueStart, last ? undefined : found[index + 1].start).trim().replace(/,\s*$/, '');
    // The balanced value first (it leaves out unknown keys and prose after the section); then the slice up to
    // the next known key, which for the last section also carries the closing brace of the root object.
    const end = balancedEnd(text, item.valueStart);
    const candidates = end > 0 ? [text.slice(item.valueStart, end).trim()] : [];
    candidates.push(slice);
    if (last) candidates.push(slice.replace(/\}\s*$/, ''));
    for (const candidate of candidates) {
      const fixed = repairJson(candidate);
      const value = fixed === null ? undefined : tryParse(fixed);
      if (value !== undefined && value !== null && typeof value === 'object') { sections[item.id] = value; return; }
    }
    dropped.push(item.id);
  });
  return { sections, dropped };
}

/** The JSON text of a reply, repaired when it does not parse as is (legacy import and tests). */
export function extractJson(text) {
  const candidate = candidateJson(text);
  return repairJson(candidate) ?? candidate.replace(/,\s*([}\]])/g, '$1');
}

/** Parse untrusted model text. Never throws. A complete reply with broken JSON is repaired or salvaged section by
 *  section; a truncated reply (opened tag, no closing tag) is left as it is so the output limit stays visible. */
export function parseStateOutput(input, requestedSections, registry = SECTIONS) {
  const SECTION_MAP = Object.fromEntries(registry.map(section => [section.id, section]));
  const warnings = [];
  const sections = {};
  try {
    const text = typeof input === 'string' ? input : input?.content;
    if (typeof text !== 'string' || !text.includes('{')) throw new Error('No JSON object found');
    const allowed = requestedSections ? new Set(requestedSections) : new Set(Object.keys(SECTION_MAP));
    const candidate = candidateJson(text);
    const truncated = OPEN_TAG.test(text) && !CLOSE_TAG.test(text);
    let raw = tryParse(candidate);
    if (raw === undefined && !truncated) {
      const known = [...allowed].filter(id => SECTION_MAP[id]);
      const fixed = repairJson(candidate);
      let note = null;
      if (fixed !== null) { raw = tryParse(fixed); note = 'Repaired JSON syntax'; }
      // A whole-text repair can parse while swallowing the tail into one string; when sections named in the
      // text are missing from the result, section-by-section salvage wins if it recovers more of them.
      const present = raw && typeof raw === 'object' ? known.filter(id => id in raw).length : 0;
      const named = known.filter(id => new RegExp(`"${escapeRegExp(id)}"\\s*:`).test(candidate)).length;
      if (present < named) {
        const salvaged = salvageSections(candidate, known);
        if (Object.keys(salvaged.sections).length > present) {
          raw = salvaged.sections;
          note = `Salvaged sections: ${Object.keys(raw).join(', ')}`
            + (salvaged.dropped.length ? `; dropped: ${salvaged.dropped.join(', ')}` : '');
        }
      }
      if (raw === undefined) throw new Error('Invalid JSON: no section could be recovered');
      warnings.push(note);
    }
    if (raw === undefined) throw new Error(truncated ? 'JSON is cut' : 'Invalid JSON');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('State is not an object');
    for (const id of allowed) {
      if (!(id in raw) || !SECTION_MAP[id]) continue;
      const cleaned = sanitize(raw[id], SECTION_MAP[id].schema);
      if (cleaned === undefined) warnings.push(`Invalid section: ${id}`);
      else sections[id] = cleaned;
    }
    return { ok: true, sections, state: sections, validSections: Object.keys(sections), warnings };
  } catch (error) {
    return { ok: false, sections, state: sections, validSections: [], warnings: [...warnings, error.message] };
  }
}

export const parseOutput = parseStateOutput;

/** Why a reply failed before section validation (SPEC §31): 'empty' (no text at all), 'cut' (an opened
 *  <sable_state> without its closing tag, usually the output limit), 'broken' (a complete <sable_state> whose
 *  JSON could not be parsed, repaired or salvaged), else null. */
export function outputProblem(input, parsed) {
  const text = typeof input === 'string' ? input : input?.content;
  if (typeof text !== 'string' || !text.trim()) return 'empty';
  if (parsed?.ok || !OPEN_TAG.test(text)) return null;
  return CLOSE_TAG.test(text) ? 'broken' : 'cut';
}
