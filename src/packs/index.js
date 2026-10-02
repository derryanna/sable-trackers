import { shapeSchema } from '../sections.js';
import { t } from '../i18n.js';

const section = (pack, key, shape, icon, instructions, max = 8) => ({ key, title: `pack.${pack}.${key}`, icon, instructions, shape, max, mode: 'inject', period: 1 });
const adult = 'Every participant must be an established adult; otherwise return empty values. Invent nothing. ';

export const BUILTIN_PACKS = Object.freeze([
  { id: 'combat', builtin: true, title: 'pack.combat.title', description: 'pack.combat.desc', icon: 'fa-hand-fist', scope: true,
    rules: '{{scope}} Record established combat facts only; unknown stays unknown. Apply no damage without a described hit. Move numbers only for shown events, never for a new reply alone. Record death only when written; zero HP does not establish death. Never resolve an attack the text has not resolved. Estimates of odds do not establish hits or outcomes; only the local dice writes a roll, and a roll does not establish damage.',
    sections: [
      section('combat', 'scene', 'text', 'fa-crosshairs', 'Record who fights whom, the current phase, terrain and range in compact text. Use only established facts; leave unknown details out. Preserve the last known situation until the text changes it. Do not invent opponents, movement or an outcome for an unresolved attack.'),
      section('combat', 'stats', 'stats', 'fa-heart-pulse', '{{scope}} Use stable keys Name · HP and Name · stamina per participant. Choose each max once from canon, or 100 when canon gives no maximum, then keep it unchanged. Use integer values from 0 to max; omit an unknown value rather than assume full health or stamina. Preserve previous values unless a shown hit, exertion, rest or healing changes them; HP loss requires a described hit. Use explicit amounts when given; otherwise estimate conservatively from the described event and identify the estimate in note. Never invent damage, recovery or death; never reset values on a new reply. Keep note short and tied to the event; do not write delta.', 12),
      section('combat', 'effects', 'tags', 'fa-bandage', '{{scope}} Keep short participant-labelled tags for wounds and conditions actually described. Preserve them until the text establishes a change or recovery. Do not infer bleeding, unconsciousness or death from HP, odds or a roll; invent no wound or condition.', 10),
      section('combat', 'odds', 'kv', 'fa-percent', '{{scope}} Record crit %, hit % and initiative for the tracked participants, identifying whose attack or turn each entry concerns. Use explicit canon values when available; otherwise give honest estimates grounded in established skill, range, terrain and current conditions, labelled as estimates in the value. Keep percentages within 0–100; omit entries without a basis. Keep estimates stable unless the established scene changes their basis. Never invent skills, roll dice or resolve an attack; initiative estimates do not make anyone act.', 6),
      section('combat', 'roll', 'text', 'fa-dice', 'Copy the previous value unchanged; only the local dice writes this field. Return an empty string when no previous value exists. Never generate, translate, reinterpret or replace a roll, and never treat it as a described hit or damage.'),
    ] },
  { id: 'intimacy', builtin: true, title: 'pack.intimacy.title', description: 'pack.intimacy.desc', icon: 'fa-heart', scope: true,
    rules: adult + '{{scope}} Check adulthood for every participant in the scene, including those outside the tracking scope; never infer age from appearance or context. If any participant is not an established adult, return an empty string for scene and empty arrays for arousal, counters and marks, even if previous values exist. Track only established facts and move numbers only for shown events. Never infer consent from arousal, silence or prior consent; do not invent actions, feelings or outcomes.',
    sections: [
      section('intimacy', 'scene', 'text', 'fa-heart', adult + 'Return an empty string if the adult guard fails for anyone in the scene. Record only established position, pace, who leads and consent state in compact text. Leave unknown details unknown; never infer consent from arousal, silence or earlier consent. Preserve explicit changes, pauses and withdrawal of consent without continuing the scene.'),
      section('intimacy', 'arousal', 'stats', 'fa-heart-pulse', adult + '{{scope}} Return [] if the adult guard fails for anyone in the scene. Use stable keys Name · arousal and Name · stamina. Arousal is an integer 0–100 with max: 100; choose stamina max once from canon, or 100 if unspecified, and keep it. Omit unknown values rather than assume zero or full stamina. Preserve known values without new evidence; change them only for shown events, using explicit amounts or cautious estimates labelled in note. Keep stamina between 0 and max. Never equate arousal with consent or invent a climax; do not write delta.'),
      section('intimacy', 'counters', 'stats', 'fa-hashtag', adult + '{{scope}} Return [] if the adult guard fails for anyone in the scene. Track climaxes, elapsed minutes and volume in ml with stable participant-labelled keys, plain nonnegative integer values and max: null; use unit: ml for volume. Count only explicit events and explicitly stated durations or quantities. Never estimate elapsed time from reply count or volume from an event alone. Omit unknown counters; zero means an established zero. Preserve totals without new explicit evidence, count each event once, and reset only when the text establishes a new counting interval. Do not write delta.', 8),
      section('intimacy', 'marks', 'tags', 'fa-tags', adult + '{{scope}} Return [] if the adult guard fails for anyone in the scene. Keep short participant-labelled tags for visible marks and state actually described. Preserve them until a change is established. Do not invent marks, hidden physical states, feelings or causes; a visible response does not establish consent.', 10),
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
