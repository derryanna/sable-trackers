import { shapeSchema } from '../sections.js';
import { t } from '../i18n.js';

const section = (pack, key, shape, icon, instructions, max = 8) => ({ key, title: `pack.${pack}.${key}`, icon, instructions, shape, max, mode: 'inject', period: 1 });
const adult = 'Every participant must be an established adult; otherwise return empty values. ';

// Provisional canon-safe content; T8c supplies the final wording.
export const BUILTIN_PACKS = Object.freeze([
  { id: 'combat', builtin: true, title: 'pack.combat.title', description: 'pack.combat.desc', icon: 'fa-hand-fist', scope: true,
    rules: '{{scope}} Never invent facts: numbers move only for shown events, damage requires a described hit, and death must be written.',
    sections: [
      section('combat', 'scene', 'text', 'fa-crosshairs', 'Record established opponents, phase, terrain and range; invent nothing.'),
      section('combat', 'stats', 'stats', 'fa-heart-pulse', '{{scope}} Track established HP and stamina per participant; numbers move only for shown events.', 12),
      section('combat', 'effects', 'tags', 'fa-bandage', 'Record only established wounds and conditions.', 10),
      section('combat', 'odds', 'kv', 'fa-percent', 'Keep only established crit %, hit % and initiative; never invent odds.', 6),
      section('combat', 'roll', 'text', 'fa-dice', 'Copy the previous value unchanged; only the local dice writes this field.'),
    ] },
  { id: 'intimacy', builtin: true, title: 'pack.intimacy.title', description: 'pack.intimacy.desc', icon: 'fa-heart', scope: true,
    rules: adult + '{{scope}} Invent nothing and change numbers only for shown events.',
    sections: [
      section('intimacy', 'scene', 'text', 'fa-heart', adult + 'Record only established position, pace, lead and consent state.'),
      section('intimacy', 'arousal', 'stats', 'fa-heart-pulse', adult + '{{scope}} Track established arousal (0–100) and stamina; change numbers only for shown events.'),
      section('intimacy', 'counters', 'stats', 'fa-hashtag', adult + 'Track established climaxes, minutes and volume in ml with max: null; change numbers only for shown events.', 8),
      section('intimacy', 'marks', 'tags', 'fa-tags', adult + 'Record only established visible marks and state.', 10),
    ] },
]);

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max).trim() : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
// The same FA class rule as custom icons; emoji must be a single grapheme.
function icon(value) {
  const valueText = text(value, 100);
  if (/^fa-[a-z0-9-]+(?:\s+fa-[a-z0-9-]+)*$/.test(valueText)) return valueText;
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(valueText)];
  return parts.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(valueText) ? valueText : '';
}

export function normalizePacks(value) {
  const used = new Set(), packs = [];
  for (const pack of Array.isArray(value) ? value : []) {
    if (!object(pack) || typeof pack.id !== 'string' || !/^p_[0-9a-f]{8}$/.test(pack.id) || used.has(pack.id) || !text(pack.title, 60)) continue;
    const keys = new Set(), sections = [];
    for (const s of Array.isArray(pack.sections) ? pack.sections : []) {
      if (!object(s) || typeof s.key !== 'string' || !/^[a-z][a-z0-9]{0,15}$/.test(s.key) || keys.has(s.key)
        || !text(s.title, 60) || !['text', 'list', 'kv', 'stats', 'tags'].includes(s.shape)) continue;
      keys.add(s.key);
      sections.push({ key: s.key, title: text(s.title, 60), icon: icon(s.icon), instructions: text(s.instructions, 2000), shape: s.shape,
        max: Number.isFinite(Number(s.max)) ? Math.max(1, Math.min(20, Math.floor(Number(s.max)))) : 8,
        mode: ['inject', 'show', 'off'].includes(s.mode) ? s.mode : 'inject',
        period: Number.isInteger(s.period) && s.period >= 0 ? s.period : 1 });
      if (sections.length === 8) break;
    }
    if (!sections.length) continue;
    used.add(pack.id);
    packs.push({ id: pack.id, title: text(pack.title, 60), icon: icon(pack.icon), description: text(pack.description, 300),
      rules: text(pack.rules, 2000), scope: pack.scope === true, sections });
  }
  return packs;
}

export function getPacks(settings = {}) { return [...BUILTIN_PACKS, ...normalizePacks(settings.packs)]; }

export function packSections(pack, settings = {}) {
  return pack.sections.map(s => {
    const id = `${pack.id}_${s.key}`;
    return { ...s, id, custom: true, pack: pack.id, builtin: !!pack.builtin,
      title: pack.builtin ? t(s.title, settings.language) : s.title,
      instructions: pack.builtin ? settings.prompts?.sections?.[id] ?? s.instructions : s.instructions,
      schema: shapeSchema(s.shape, s.max), defaultMode: s.mode, period: s.period };
  });
}
