import { SECTIONS } from './sections.js';

const trim = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : undefined;

function sanitize(value, schema) {
  if (!schema) return undefined;
  if (schema.type === 'string') return trim(value, schema.max);
  if (schema.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (schema.type === 'integer') {
    const n = Number(value); if (!Number.isFinite(n)) return undefined;
    return Math.min(schema.max ?? n, Math.max(schema.min ?? n, Math.round(n)));
  }
  if (schema.type === 'score') {
    if (value === null) return null;
    const n = Number(value); return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : undefined;
  }
  if (schema.type === 'enum') return schema.values.includes(value) ? value : schema.fallback;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return undefined;
    const items = value.slice(0, schema.max).map(item => sanitize(item, schema.item)).filter(item => item !== undefined);
    return items;
  }
  if (schema.type === 'changes') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const [key, change] of Object.entries(value)) {
      if (!change || typeof change !== 'object') continue;
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
    if (schema.required?.some(key => out[key] === undefined)) return undefined;
    return out;
  }
}

/** Validate one section value (model output or a manual edit) with the section's schema; undefined = invalid. */
export function sanitizeSection(section, value) {
  return sanitize(value, section?.schema);
}

export function extractJson(text) {
  const tagged = text.match(/<sable_state\b[^>]*>([\s\S]*?)<\/sable_state\s*>/i)?.[1];
  let candidate = tagged ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  candidate = candidate.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  return candidate.replace(/,\s*([}\]])/g, '$1');
}

/** Parse untrusted model text. Never throws. */
export function parseStateOutput(input, requestedSections, registry = SECTIONS) {
  const SECTION_MAP = Object.fromEntries(registry.map(section => [section.id, section]));
  const warnings = [];
  const sections = {};
  try {
    const text = typeof input === 'string' ? input : input?.content;
    if (typeof text !== 'string' || !text.includes('{')) throw new Error('No JSON object found');
    const raw = JSON.parse(extractJson(text));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('State is not an object');
    const allowed = requestedSections ? new Set(requestedSections) : new Set(Object.keys(SECTION_MAP));
    for (const id of allowed) {
      if (!(id in raw) || !SECTION_MAP[id]) continue;
      const cleaned = sanitize(raw[id], SECTION_MAP[id].schema);
      if (cleaned === undefined) warnings.push(`Invalid section: ${id}`);
      else sections[id] = cleaned;
    }
    return { ok: true, sections, state: sections, validSections: Object.keys(sections), warnings };
  } catch (error) {
    return { ok: false, sections, state: sections, validSections: [], warnings: [error.message] };
  }
}

export const parseOutput = parseStateOutput;
