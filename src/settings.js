import { SECTIONS, SECTION_ORDER, getSections, getAllSections, normalizeBondScales, normalizeCustomSections } from './sections.js';
import { BUILTIN_PACKS, getPacks, normalizePacks } from './packs/index.js';
import { normalizeFolders } from './folders.js';
import { enabledPacks } from './store.js';
import { COMMON_RULES } from './prompt.js';

export const SETTINGS_KEY = 'sableTrackers';
export const GROUP_IDS = Object.freeze(['connection', 'context', 'sections', 'scales', 'custom', 'visual', 'actions', 'packs', 'danger']);
// Drawer look (SPEC §12). Ranges are inclusive; the UI sliders use the same bounds.
// base/text: null = automatic (dark glass, theme text; a base derives its own ink). Hex colours override (SPEC §12).
// bgImage: null or a sanitised data:/http(s) URL (normalizeBgImage); the other keys are numbers, booleans or choices.
// Live cards (SPEC §16): `effects` is the level the user picks and `fx` the composable set that `full` unlocks.
// Every effect is off until the user turns it on; null colours mean "automatic" (the accent, or the ink for rain).
export const EFFECTS_LEVELS = Object.freeze(['off', 'subtle', 'full']);
export const FX_SPEEDS = Object.freeze(['slow', 'medium', 'fast']);
export const FX_DEFAULTS = Object.freeze({
  glow: Object.freeze({ on: false, color: null, intensity: 0.5 }),
  shimmer: Object.freeze({ on: false, speed: 'medium', color: null }),
  rain: Object.freeze({ on: false, density: 0.5, color: null, angle: 10 }),
  ticks: Object.freeze({ on: false }),
  valueColor: Object.freeze({ on: false }),
  dice: Object.freeze({ on: false }),
  cardGlow: Object.freeze({ on: false }),
});
// Knob ranges as [min, max, step], keyed "effect.knob"; the settings sliders use the same bounds.
export const FX_RANGES = Object.freeze({ 'glow.intensity': [0, 1, 0.05], 'rain.density': [0, 1, 0.05], 'rain.angle': [-30, 30, 1] });
export const VISUAL_DEFAULTS = Object.freeze({ opacity: 0.93, blur: 14, fontSize: 13, widthVw: 80, accent: '#f5f4ee', base: null, text: null, icons: 'fa', radius: 18,
  bgImage: null, bgDim: 0.45, bgFit: 'cover', effects: 'subtle', fx: FX_DEFAULTS, cardColors: Object.freeze({}),
  cardFill: 0.05, border: 0.13, titleFont: 'theme', titleWeight: 700, chipStyle: 'filled', accentBar: true, spacing: 'cozy', sparklines: true });
export const VISUAL_RANGES = Object.freeze({ opacity: [0.5, 1, 0.01], blur: [0, 30, 1], fontSize: [12, 16, 1], widthVw: [60, 100, 1], radius: [8, 24, 1],
  bgDim: [0, 0.9, 0.01], cardFill: [0, 0.3, 0.01], border: [0, 0.5, 0.01], titleWeight: [500, 800, 100] });
// Closed choices in display order; VISUAL_DEFAULTS holds the default of each.
export const VISUAL_CHOICES = Object.freeze({ icons: ['fa', 'emoji'], bgFit: ['cover', 'contain', 'tile'],
  titleFont: ['theme', 'serif', 'mono', 'rounded'], chipStyle: ['filled', 'outline'], spacing: ['cozy', 'compact'], effects: EFFECTS_LEVELS });
// About 900 KB of text; the settings UI refuses to store more than about 600 KB.
export const BG_IMAGE_MAX_LENGTH = 900 * 1024;
// Reasoning sent with the side request: thinking models (GLM, Gemini, Kimi) otherwise spend the whole output limit on
// reasoning and return no state. `low`/`min` go out as OpenRouter-style `reasoning.effort` (via custom_include_body for
// custom endpoints) plus SillyTavern's own `reasoning_effort`; `auto` sends nothing and leaves the model's default.
export const REASONING_LEVELS = Object.freeze(['auto', 'low', 'min']);
export const DEFAULTS = {
  enabled: true, profileId: '', language: 'ru', messages: 4,
  cardChars: 6000, loreChars: 4000, maxTokens: 8000, depth: 2, keep: 3, role: 'system', reasoning: 'low',
  perChatOverrides: false, showPanel: true, showFloatingButton: true,
  hideOff: true, spoilers: true, layout: 'topics',
  prompts: { rules: null, sections: {}, packs: {} },
  packs: [], packDefaults: [], packScope: {},
  order: SECTION_ORDER, customSections: [], folders: [], bondScales: { off: [], signed: [], custom: [] },
  groups: { connection: true }, hints: { done: false },
  folded: {}, pinned: false, floatingPosition: null,
  sections: Object.fromEntries(SECTIONS.map(s => [s.id, { mode: s.defaultMode, period: s.period }])),
  visual: { ...VISUAL_DEFAULTS },
};
const isMode = value => ['inject', 'show', 'off'].includes(value);
// Injection role for setExtensionPrompt (SPEC §5), in the order of SillyTavern's extension_prompt_roles.
export const ROLES = Object.freeze(['system', 'user', 'assistant']);
// Drawer layout (SPEC §21): topic cards, or the four NPC-keyed sections as one card per person.
export const LAYOUTS = Object.freeze(['topics', 'people']);

export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const result = { ...structuredClone(DEFAULTS), ...value };
  // Removed in SPEC §27: the stale status button replaced the automatic recompute after an edit.
  delete result.recomputeOnEdit;
  // First-run hints (SPEC §27): only the done flag is kept.
  result.hints = { done: typeof value.hints?.done === 'boolean' ? value.hints.done : DEFAULTS.hints.done };
  if (typeof result.hideOff !== 'boolean') result.hideOff = DEFAULTS.hideOff;
  for (const key of ['enabled', 'spoilers', 'perChatOverrides', 'showPanel', 'showFloatingButton', 'pinned']) {
    if (typeof result[key] !== 'boolean') result[key] = DEFAULTS[key];
  }
  for (const key of ['messages', 'cardChars', 'loreChars', 'maxTokens', 'depth', 'keep']) {
    const min = ['cardChars', 'loreChars', 'depth'].includes(key) ? 0 : 1;
    result[key] = Number.isFinite(Number(result[key])) ? Math.max(min, Math.floor(Number(result[key]))) : DEFAULTS[key];
  }
  result.profileId = typeof result.profileId === 'string' ? result.profileId : '';
  result.role = ROLES.includes(result.role) ? result.role : DEFAULTS.role;
  result.layout = LAYOUTS.includes(result.layout) ? result.layout : DEFAULTS.layout;
  result.reasoning = REASONING_LEVELS.includes(result.reasoning) ? result.reasoning : DEFAULTS.reasoning;
  result.language = ['ru', 'en'].includes(result.language) ? result.language : 'ru';
  result.customSections = normalizeCustomSections(value.customSections);
  result.bondScales = normalizeBondScales(value.bondScales);
  result.packs = normalizePacks(value.packs);
  result.folders = normalizeFolders(value.folders, getSections(result));
  const packIds = getPacks(result).map(pack => pack.id);
  result.packDefaults = [...new Set(Array.isArray(value.packDefaults) ? value.packDefaults : [])].filter(id => packIds.includes(id));
  result.packScope = Object.fromEntries(packIds.filter(id => ['all', 'user', 'others'].includes(value.packScope?.[id])).map(id => [id, value.packScope[id]]));
  const all = getAllSections({ ...result, prompts: {} });
  const ids = all.map(section => section.id);
  // Fold keys are section ids plus pack and folder container keys (SPEC §15/§18), the People group, person cards (§21)
  // and character groups in the Bonds card (§34).
  const foldKeys = [...ids, ...packIds.map(id => `pack:${id}`), ...result.folders.map(folder => `folder:${folder.id}`), 'people'];
  const isPerson = id => /^(person|bond):.{1,200}$/s.test(id);
  result.folded = Object.fromEntries(Object.keys(value.folded && typeof value.folded === 'object' ? value.folded : {})
    .filter(id => (foldKeys.includes(id) || isPerson(id)) && typeof value.folded[id] === 'boolean').map(id => [id, value.folded[id]]));
  result.groups = { ...DEFAULTS.groups, ...Object.fromEntries(GROUP_IDS
    .filter(id => typeof value.groups?.[id] === 'boolean').map(id => [id, value.groups[id]])) };
  const position = value.floatingPosition;
  result.floatingPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
    ? { x: Math.max(0, position.x), y: Math.max(0, position.y) } : null;
  // Keep explicit pack positions globally without adding disabled cards to the legacy UI order.
  result.order = [...new Set([...(Array.isArray(value.order) ? value.order : []).filter(id => ids.includes(id)),
    ...getSections(result).map(s => s.id)])];
  result.sections = Object.fromEntries(all.map(s => {
    const item = value.sections?.[s.id];
    const period = Number(item?.period);
    return [s.id, { mode: isMode(item?.mode) ? item.mode : s.defaultMode,
      period: Number.isInteger(period) && period >= 0 ? period : s.period }];
  }));
  result.visual = normalizeVisual(value.visual, result);
  const override = (value, limit, fallback) => {
    const text = typeof value === 'string' ? value.trim().slice(0, limit).trim() : '';
    return text && text !== fallback ? text : null;
  };
  result.prompts = { rules: override(value.prompts?.rules, 4000, COMMON_RULES), sections: {}, packs: {} };
  for (const section of all.filter(s => !s.custom || s.builtin)) {
    const text = override(value.prompts?.sections?.[section.id], 2000, section.instructions);
    if (text) result.prompts.sections[section.id] = text;
  }
  for (const pack of BUILTIN_PACKS) {
    const text = override(value.prompts?.packs?.[pack.id], 2000, pack.rules);
    if (text) result.prompts.packs[pack.id] = text;
  }
  return result;
}

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
/** A number from a slider or a typed string, clamped to [min, max] and rounded to the step; the fallback otherwise. */
function stepped(raw, [min, max, step], fallback) {
  const number = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
  const result = Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number / step) * step)) : fallback;
  return step < 1 ? Number(result.toFixed(2)) : result;
}

/** The composable effects (SPEC §16) with defaults filled, numbers clamped, colours validated (null = automatic),
 *  speeds limited to FX_SPEEDS and unknown effects or knobs dropped. Idempotent; nothing a user types can break the drawer. */
export function normalizeFx(value) {
  const source = isObject(value) ? value : {};
  const result = {};
  for (const [name, defaults] of Object.entries(FX_DEFAULTS)) {
    const item = isObject(source[name]) ? source[name] : {}, effect = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      if (key === 'on') effect.on = typeof item.on === 'boolean' ? item.on : fallback;
      else if (key === 'color') effect.color = normalizeHex(item.color);
      else if (key === 'speed') effect.speed = FX_SPEEDS.includes(item.speed) ? item.speed : fallback;
      else effect[key] = stepped(item[key], FX_RANGES[`${name}.${key}`], fallback);
    }
    result[name] = effect;
  }
  return result;
}

/** Fills missing visual keys from defaults and clamps numbers to their ranges. */
export function normalizeVisual(value, settings = {}) {
  const source = isObject(value) ? value : {};
  const result = { ...VISUAL_DEFAULTS };
  for (const [key, range] of Object.entries(VISUAL_RANGES)) result[key] = stepped(source[key], range, VISUAL_DEFAULTS[key]);
  result.accent = normalizeHex(source.accent) ?? VISUAL_DEFAULTS.accent;
  result.cardColors = {};
  if (source.cardColors && typeof source.cardColors === 'object' && !Array.isArray(source.cardColors)) {
    const ids = new Set(getAllSections(settings).map(s => s.id));
    for (const [id, value] of Object.entries(source.cardColors)) {
      const color = normalizeHex(value);
      if ((ids.has(id) || /^c_[0-9a-f]{8}$/.test(id)) && color) result.cardColors[id] = color;
    }
  }
  result.base = normalizeHex(source.base);
  result.text = normalizeHex(source.text);
  for (const [key, values] of Object.entries(VISUAL_CHOICES)) result[key] = values.includes(source[key]) ? source[key] : VISUAL_DEFAULTS[key];
  // Migration (SPEC §16): the old `motion` boolean becomes the level (false → off, true → subtle) and is not kept.
  if (!EFFECTS_LEVELS.includes(source.effects) && typeof source.motion === 'boolean') result.effects = source.motion ? 'subtle' : 'off';
  result.fx = normalizeFx(source.fx);
  for (const key of ['accentBar', 'sparklines']) result[key] = typeof source[key] === 'boolean' ? source[key] : VISUAL_DEFAULTS[key];
  result.bgImage = normalizeBgImage(source.bgImage);
  return result;
}

const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
// No quotes, parentheses, backslashes, angle brackets or whitespace: the URL goes into CSS url("…").
const HTTP_IMAGE = /^https?:\/\/[^\s"'()\\<>]+$/i;
let lastImage;
/** A background image URL that is safe inside CSS url("…"): a base64 png/jpeg/webp data URL or an http(s) URL,
 *  at most BG_IMAGE_MAX_LENGTH characters; anything else is null. */
export function normalizeBgImage(value) {
  if (typeof value !== 'string') return null;
  // One-entry memo: previews re-normalise the same (possibly large) data URL on every slider tick.
  if (value === lastImage) return value;
  const url = value.trim();
  if (!url || url.length > BG_IMAGE_MAX_LENGTH || !(DATA_IMAGE.test(url) || HTTP_IMAGE.test(url))) return null;
  if (url === value) lastImage = value;
  return url;
}

/** '#rrggbb' (lower case) from '#rrggbb' or '#rgb'; anything else is null. */
export function normalizeHex(value) {
  const hex = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map(c => c + c).join('')}`;
  return null;
}

export function loadSettings(ctx) {
  const saved = ctx.extensionSettings[SETTINGS_KEY];
  const settings = normalizeSettings(saved);
  ctx.extensionSettings[SETTINGS_KEY] = settings;
  if (JSON.stringify(saved) !== JSON.stringify(settings)) ctx.saveSettingsDebounced();
  return settings;
}

export function saveSettings(ctx, patch) {
  const previous = loadSettings(ctx);
  const sections = Object.fromEntries(getAllSections({ ...previous, ...patch }).map(s => [s.id, { ...previous.sections[s.id], ...patch.sections?.[s.id] }]));
  // Custom definitions own their modes/periods; accept the shared setMode patch API too.
  const customSections = normalizeCustomSections(patch.customSections ?? previous.customSections).map(item => ({
    ...item, ...patch.sections?.[item.id], id: item.id,
  }));
  const prompts = { ...previous.prompts, ...patch.prompts,
    sections: { ...previous.prompts.sections, ...patch.prompts?.sections },
    packs: { ...previous.prompts.packs, ...patch.prompts?.packs } };
  const packScope = { ...previous.packScope, ...patch.packScope };
  const groups = { ...previous.groups, ...patch.groups };
  ctx.extensionSettings[SETTINGS_KEY] = normalizeSettings({ ...previous, ...patch, sections, customSections, prompts, packScope, groups });
  ctx.saveSettingsDebounced();
  return ctx.extensionSettings[SETTINGS_KEY];
}

/** Extra payload for ConnectionManagerRequestService.sendRequest (its fifth argument) that caps model reasoning. */
export function reasoningPayload(settings) {
  const level = REASONING_LEVELS.includes(settings?.reasoning) ? settings.reasoning : DEFAULTS.reasoning;
  if (level === 'auto') return {};
  const effort = level === 'min' ? 'minimal' : level;
  return { reasoning_effort: level, custom_include_body: `reasoning:
  effort: ${effort}` };
}

export function effectiveModes(settings, store) {
  return Object.fromEntries(getSections(settings, enabledPacks(store, settings)).map(s => [s.id,
    isMode(store?.modeOverride?.[s.id]) ? store.modeOverride[s.id] : s.custom && !s.pack ? s.defaultMode : settings.sections?.[s.id]?.mode ?? s.defaultMode]));
}
