// src/secrets.js — Story secrets: the author's notebook kept by the extension (SPEC §36).
// Pure module; no SillyTavern, no $, no toastr. All functions return new objects; arguments are never mutated.

export const SECRETS_TAG = 'sable_secrets';
export const LIVE_CAP = 3;

export const emptySecrets = () => ({ next: 1, truths: [] });

/** A truth is live when it has no revealedHow key (absent or undefined/null). */
export const isLive = truth => !!truth && truth.revealedHow == null;

export const liveTruths = secrets => (secrets?.truths ?? []).filter(isLive);
export const pastTruths = secrets => (secrets?.truths ?? []).filter(t => !isLive(t));

// ─── cutSecrets ──────────────────────────────────────────────────────────────

const CLOSED_RE = /<sable_secrets\b[^>]*>([\s\S]*?)<\/sable_secrets\s*>/gi;
const TAIL_RE   = /<sable_secrets\b[^>]*>([\s\S]*)$/i;

/**
 * Remove every <sable_secrets> block from text; return { text, block }.
 * block = the joined inner contents of all removed blocks, trimmed.
 * text  = the remainder with runs of 3+ newlines collapsed to 2 and trailing whitespace trimmed.
 * Non-string input: returned as-is with block = ''.
 */
export function cutSecrets(text) {
  if (typeof text !== 'string') return { text, block: '' };
  const parts = [];
  let stripped = text.replace(CLOSED_RE, (_, inner) => { parts.push(inner); return ''; });
  stripped = stripped.replace(TAIL_RE, (_, inner) => { parts.push(inner); return ''; });
  stripped = stripped.replace(/\n{3,}/g, '\n\n').replace(/[^\S\n]*\n?[^\S\n]*$/, '').replace(/\s+$/, '');
  return { text: stripped, block: parts.join('\n').trim() };
}

// ─── parseSecretsBlock ───────────────────────────────────────────────────────

// Tolerant id extraction: T<n> with optional #, *, _, `, spaces, brackets.
const FULL_ID_RE = /[Tt][*_`#\s\[\]()]*(\d+)/;

function extractId(str) {
  const cleaned = str.replace(/[*_`#\[\]()]/g, '');
  const m = cleaned.match(/[Tt]\s*(\d+)/);
  return m ? `T${m[1]}` : null;
}

// Strip leading bullet/numbering/bold preamble.
const PREAMBLE_RE = /^[\s]*(?:(?:[-*•·]|\*\*|\d+[.)]) *)*\s*/;

// Field label patterns for new-truth pipe segments.
const HIDDEN_LABEL = /^\s*(?:hidden\s*from|скрыто\s*от)\s*:/i;
const WHEN_LABEL   = /^\s*(?:comes?\s*out(?:\s*when)?|when|выйдет(?:\s*когда)?|когда\s*выйдет)\s*:/i;
const CHANGES_LABEL = /^\s*(?:changes|меняет|что\s*меняет)\s*:/i;

function splitNames(str) {
  return str.split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

/** Parse one line of the secrets block into an op, or push to notes and return null. */
function parseLine(raw, notes) {
  const line = raw.trim();
  if (!line) return null;

  const rest = line.replace(PREAMBLE_RE, '');

  // ── new truth ────────────────────────────────────────────────────────────
  if (/^\+/.test(rest) || /^новая(?!\p{L})/iu.test(rest)) {
    const noMarker = rest.replace(/^\+\s*/, '').replace(/^новая\s*/iu, '');
    let ref = null;
    let payload = noMarker;
    // Optional T<n>: at the start (with noise chars)
    const idHeadMatch = noMarker.replace(/[*_`#\[\]()]/g, '').match(/^[Tt]\s*(\d+)\s*[:：]?\s*/);
    if (idHeadMatch) {
      ref = `T${idHeadMatch[1]}`;
      // Advance payload past the id token in the original string
      const end = noMarker.search(/(?<=[Tt][*_`#\[\]()\s]*\d+)[*_`#\[\]()\s]*[:：]?\s*/i);
      const m = noMarker.match(/[Tt][*_`#\[\]()\s]*\d+[*_`#\[\]()\s]*[:：]?\s*/i);
      payload = m ? noMarker.slice(m[0].length) : noMarker;
    }
    const segments = payload.split('|');
    const text = segments[0].trim();
    let hiddenFrom = [], when = '', changes = '';
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (HIDDEN_LABEL.test(seg)) hiddenFrom = splitNames(seg.replace(HIDDEN_LABEL, ''));
      else if (WHEN_LABEL.test(seg)) when = seg.replace(WHEN_LABEL, '').trim();
      else if (CHANGES_LABEL.test(seg)) changes = seg.replace(CHANGES_LABEL, '').trim();
    }
    return { op: 'new', ref, text, hiddenFrom, when, changes, line };
  }

  // ── clue ─────────────────────────────────────────────────────────────────
  if (/^(?:clue|подсказка)(?!\p{L})/iu.test(rest)) {
    const after = rest.replace(/^(?:clue|подсказка)\s*/iu, '');
    const ref = extractId(after);
    if (!ref) { notes.push(line.slice(0, 120)); return null; }
    const text = after.replace(/[Tt][*_`#\[\]()\s]*\d+[*_`#\[\]()\s]*[:：]?\s*/i, '').trim();
    return { op: 'clue', ref, text, line };
  }

  // ── learned ──────────────────────────────────────────────────────────────
  if (/^(?:learned|узнал[аи]?)(?!\p{L})/iu.test(rest)) {
    const after = rest.replace(/^(?:learned|узнал[аи]?)\s*/iu, '');
    const ref = extractId(after);
    if (!ref) { notes.push(line.slice(0, 120)); return null; }
    const namesPart = after.replace(/[Tt][*_`#\[\]()\s]*\d+[*_`#\[\]()\s]*[:：]?\s*/i, '').trim();
    const names = namesPart.split(/[,;]|\s+и\s+|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
    return { op: 'learned', ref, names, line };
  }

  // ── out ──────────────────────────────────────────────────────────────────
  if (/^(?:out|вышла|раскрыта)(?!\p{L})/iu.test(rest)) {
    const after = rest.replace(/^(?:out|вышла|раскрыта)\s*/iu, '');
    const ref = extractId(after);
    if (!ref) { notes.push(line.slice(0, 120)); return null; }
    return { op: 'out', ref, line };
  }

  // ── unmatched → note ─────────────────────────────────────────────────────
  notes.push(line.slice(0, 120));
  return null;
}

/** Parse a secrets block (joined inner text of all <sable_secrets> tags). */
export function parseSecretsBlock(block) {
  if (typeof block !== 'string' || !block) return { ops: [], notes: [] };
  const ops = [], notes = [];
  for (const rawLine of block.split('\n')) {
    const op = parseLine(rawLine, notes);
    if (op) ops.push(op);
  }
  return { ops, notes };
}

// ─── clueFound ───────────────────────────────────────────────────────────────

const STOP_EN = new Set(['this','that','with','from','they','them','have','will','what','when','were','been','into']);
const STOP_RU = new Set(['этот','этой','того','тому','когда','если','чтобы','который','которая','которые','была','были','было','есть','тоже','также','очень','себя','свой','своя']);

function tokenize(str) {
  if (typeof str !== 'string') return [];
  return [...str.toLowerCase().replace(/ё/g, 'е').matchAll(/\p{L}+/gu)]
    .map(m => m[0])
    .filter(w => w.length >= 4 && !STOP_EN.has(w) && !STOP_RU.has(w));
}

/**
 * Words match when equal or when shared prefix ≥ 4 letters covers ≥ 80 % of the shorter word.
 * (80 % of shorter: серебряного/серебряный → 8/10 = 80 % → true;
 *  охранник/охранный → 6/8 = 75 % → false.)
 */
function wordMatch(cw, pw) {
  if (cw === pw) return true;
  const minLen = Math.min(cw.length, pw.length);
  if (minLen < 4) return false;
  let shared = 0;
  while (shared < minLen && cw[shared] === pw[shared]) shared++;
  return shared >= 4 && shared / minLen >= 0.8;
}

/**
 * True when: at least two distinct clue content words match prose, or when
 * the clue has exactly one content word and it matches.
 */
export function clueFound(clueText, prose) {
  const clueTokens = tokenize(clueText);
  const proseTokens = tokenize(prose);
  if (!clueTokens.length || !proseTokens.length) return false;
  let matched = 0;
  for (const cw of clueTokens) {
    if (proseTokens.some(pw => wordMatch(cw, pw))) matched++;
  }
  return clueTokens.length === 1 ? matched >= 1 : matched >= 2;
}

// ─── applySecrets ────────────────────────────────────────────────────────────

function normText(text) {
  return (text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

function firstWord(name) {
  return (name ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
}

/** Case-insensitive name match: equal, or first words share a 5-letter prefix when both ≥ 5. */
function nameMatches(a, b) {
  const wa = firstWord(a), wb = firstWord(b);
  if (!wa || !wb) return false;
  if (wa === wb) return true;
  return wa.length >= 5 && wb.length >= 5 && wa.slice(0, 5) === wb.slice(0, 5);
}

/**
 * Apply ops to the previous secrets, returning { secrets, notes, applied }.
 * applied = input applied ∪ every op line processed in this call (success or note).
 */
export function applySecrets(previous, ops, { mesId, prose = '', applied = [] } = {}) {
  const secrets = structuredClone(previous ?? emptySecrets());
  const notes = [];
  const appliedSet = new Set(applied);
  const newApplied = new Set(applied);

  // placeholder ref → assigned id within this call
  const idMap = new Map();
  // normalized text → existing truth id (for same-text dedup)
  const normMap = new Map();
  for (const t of secrets.truths) normMap.set(normText(t.text), t.id);
  // first-wins tracker: truthId → Set of op types applied in this call
  const seen = new Map();

  const resolveRef = ref => idMap.get(ref) ?? ref;

  for (const op of ops) {
    if (appliedSet.has(op.line)) continue;
    newApplied.add(op.line);

    if (op.op === 'new') {
      const norm = normText(op.text ?? '');
      // Same normalized text as existing truth → map ref, no note
      if (normMap.has(norm)) {
        if (op.ref) idMap.set(op.ref, normMap.get(norm));
        continue;
      }
      // Ref equals existing truth id → map ref, no note (coordinator §1)
      if (op.ref && secrets.truths.some(t => t.id === op.ref)) {
        idMap.set(op.ref, op.ref);
        continue;
      }
      if (!op.hiddenFrom || !op.hiddenFrom.length) {
        notes.push('New truth left out: hidden from no one');
        continue;
      }
      if (liveTruths(secrets).length >= LIVE_CAP) {
        notes.push(`New truth left out: ${LIVE_CAP} are already live`);
        continue;
      }
      const id = `T${secrets.next++}`;
      if (op.ref) idMap.set(op.ref, id);
      const truth = {
        id, text: op.text ?? '',
        hiddenFrom: [...op.hiddenFrom],
        when: op.when ?? '', changes: op.changes ?? '',
        clues: [], createdMesId: mesId ?? null, revealedMesId: null,
      };
      secrets.truths.push(truth);
      normMap.set(norm, id);
      continue;
    }

    if (op.op === 'clue') {
      const ref = resolveRef(op.ref);
      const truth = secrets.truths.find(t => t.id === ref);
      if (!truth) { notes.push(`${op.ref}: unknown truth`); continue; }
      if (!isLive(truth)) { notes.push(`${ref}: already revealed`); continue; }
      const s = seen.get(ref) ?? new Set(); seen.set(ref, s);
      if (s.has('clue')) continue; // first wins, silently
      s.add('clue');
      truth.clues.push({ text: op.text, mesId: mesId ?? null, found: clueFound(op.text, prose) });
      continue;
    }

    if (op.op === 'learned') {
      const ref = resolveRef(op.ref);
      const truth = secrets.truths.find(t => t.id === ref);
      if (!truth) { notes.push(`${op.ref}: unknown truth`); continue; }
      if (!isLive(truth)) { notes.push(`${ref}: already revealed`); continue; }
      const s = seen.get(ref) ?? new Set(); seen.set(ref, s);
      if (s.has('learned')) continue;
      s.add('learned');
      for (const name of (op.names ?? [])) {
        const idx = truth.hiddenFrom.findIndex(hf => nameMatches(hf, name));
        if (idx === -1) notes.push(`${ref}: ${name} was not on its hidden-from list`);
        else truth.hiddenFrom.splice(idx, 1);
      }
      if (isLive(truth) && truth.hiddenFrom.length === 0) {
        truth.revealedMesId = mesId ?? null;
        truth.revealedHow = 'learned';
      }
      continue;
    }

    if (op.op === 'out') {
      const ref = resolveRef(op.ref);
      const truth = secrets.truths.find(t => t.id === ref);
      if (!truth) { notes.push(`${op.ref}: unknown truth`); continue; }
      if (!isLive(truth)) { notes.push(`${ref}: already revealed`); continue; }
      const s = seen.get(ref) ?? new Set(); seen.set(ref, s);
      if (s.has('out')) continue;
      s.add('out');
      truth.revealedMesId = mesId ?? null;
      truth.revealedHow = 'out';
      continue;
    }
  }

  return { secrets, notes, applied: [...newApplied] };
}

// ─── user ops ────────────────────────────────────────────────────────────────

/** Copy allowed fields from `fields` onto the truth; if live and hiddenFrom empties → 'user' reveal. */
export function editTruth(secrets, id, fields) {
  const idx = secrets.truths.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const next = structuredClone(secrets);
  const t = next.truths[idx];
  if (typeof fields.text === 'string') t.text = fields.text.trim();
  if (Array.isArray(fields.hiddenFrom))
    t.hiddenFrom = fields.hiddenFrom.map(s => String(s).trim()).filter(Boolean);
  if (typeof fields.when === 'string') t.when = fields.when.trim();
  if (typeof fields.changes === 'string') t.changes = fields.changes.trim();
  if (Array.isArray(fields.clues))
    t.clues = fields.clues.filter(c => c && typeof c.text === 'string').map(c => ({
      text: c.text, mesId: c.mesId ?? null, found: !!c.found,
    }));
  if (isLive(t) && t.hiddenFrom.length === 0) t.revealedHow = 'user';
  return next;
}

/** Mark an existing truth as revealed by the user. */
export function revealTruth(secrets, id, mesId) {
  const idx = secrets.truths.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const next = structuredClone(secrets);
  next.truths[idx].revealedMesId = mesId ?? null;
  next.truths[idx].revealedHow = 'user';
  return next;
}

/** Remove a truth from the notebook permanently. */
export function forgetTruth(secrets, id) {
  const idx = secrets.truths.findIndex(t => t.id === id);
  if (idx === -1) return null;
  const next = structuredClone(secrets);
  next.truths.splice(idx, 1);
  return next;
}

/** Restore a past truth to live; returns null when unknown, already live, or the cap is full. */
export function restoreTruth(secrets, id) {
  const idx = secrets.truths.findIndex(t => t.id === id);
  if (idx === -1) return null;
  if (isLive(secrets.truths[idx])) return null;
  if (liveTruths(secrets).length >= LIVE_CAP) return null;
  const next = structuredClone(secrets);
  const t = next.truths[idx];
  delete t.revealedHow;
  t.revealedMesId = null;
  return next;
}
