import { SECTIONS, SECTION_ORDER, getSections, normalizeCustomSections, orderedSectionIds } from './sections.js';

export const SETTINGS_KEY = 'sableTrackers';
// Drawer look (SPEC §12). Ranges are inclusive; the UI sliders use the same bounds.
// base/text: null = automatic (dark glass, theme text; a base derives its own ink). Hex colours override (SPEC §12).
// bgImage: null or a sanitised data:/http(s) URL (normalizeBgImage); the other keys are numbers, booleans or choices.
export const VISUAL_DEFAULTS = Object.freeze({ opacity: 0.93, blur: 14, fontSize: 13, widthVw: 80, accent: '#f5f4ee', base: null, text: null, icons: 'fa', radius: 18,
  bgImage: null, bgDim: 0.45, bgFit: 'cover', motion: true,
  cardFill: 0.05, border: 0.13, titleFont: 'theme', titleWeight: 700, chipStyle: 'filled', accentBar: true, spacing: 'cozy' });
export const VISUAL_RANGES = Object.freeze({ opacity: [0.5, 1, 0.01], blur: [0, 30, 1], fontSize: [12, 16, 1], widthVw: [60, 100, 1], radius: [8, 24, 1],
  bgDim: [0, 0.9, 0.01], cardFill: [0, 0.3, 0.01], border: [0, 0.5, 0.01], titleWeight: [500, 800, 100] });
// Closed choices; the first value is the default.
export const VISUAL_CHOICES = Object.freeze({ icons: ['fa', 'emoji'], bgFit: ['cover', 'contain', 'tile'],
  titleFont: ['theme', 'serif', 'mono', 'rounded'], chipStyle: ['filled', 'outline'], spacing: ['cozy', 'compact'] });
// About 900 KB of text; the settings UI refuses to store more than about 600 KB.
export const BG_IMAGE_MAX_LENGTH = 900 * 1024;
export const DEFAULTS = {
  enabled: true, profileId: '', language: 'ru', messages: 4,
  cardChars: 6000, loreChars: 4000, maxTokens: 3000, depth: 2, keep: 3,
  perChatOverrides: false, showPanel: true, showFloatingButton: true,
  order: SECTION_ORDER, customSections: [],
  folded: {}, pinned: false, floatingPosition: null,
  sections: Object.fromEntries(SECTIONS.map(s => [s.id, { mode: s.defaultMode, period: s.period }])),
  visual: { ...VISUAL_DEFAULTS },
};
const isMode = value => ['inject', 'show', 'off'].includes(value);

export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const result = { ...structuredClone(DEFAULTS), ...value };
  for (const key of ['enabled', 'perChatOverrides', 'showPanel', 'showFloatingButton', 'pinned']) {
    if (typeof result[key] !== 'boolean') result[key] = DEFAULTS[key];
  }
  for (const key of ['messages', 'cardChars', 'loreChars', 'maxTokens', 'depth', 'keep']) {
    const min = ['cardChars', 'loreChars', 'depth'].includes(key) ? 0 : 1;
    result[key] = Number.isFinite(Number(result[key])) ? Math.max(min, Math.floor(Number(result[key]))) : DEFAULTS[key];
  }
  result.profileId = typeof result.profileId === 'string' ? result.profileId : '';
  result.language = ['ru', 'en'].includes(result.language) ? result.language : 'ru';
  result.customSections = normalizeCustomSections(value.customSections);
  const ids = getSections(result).map(section => section.id);
  result.folded = Object.fromEntries(ids.filter(id => typeof value.folded?.[id] === 'boolean').map(id => [id, value.folded[id]]));
  const position = value.floatingPosition;
  result.floatingPosition = position && Number.isFinite(position.x) && Number.isFinite(position.y)
    ? { x: Math.max(0, position.x), y: Math.max(0, position.y) } : null;
  result.order = orderedSectionIds(value.order, getSections(result));
  result.sections = Object.fromEntries(SECTIONS.map(s => {
    const item = value.sections?.[s.id];
    const period = Number(item?.period);
    return [s.id, { mode: isMode(item?.mode) ? item.mode : s.defaultMode,
      period: Number.isInteger(period) && period >= 0 ? period : s.period }];
  }));
  result.visual = normalizeVisual(value.visual);
  return result;
}

/** Fills missing visual keys from defaults and clamps numbers to their ranges. */
export function normalizeVisual(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { ...VISUAL_DEFAULTS };
  for (const [key, [min, max, step]] of Object.entries(VISUAL_RANGES)) {
    const raw = source[key];
    const number = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
    if (Number.isFinite(number)) result[key] = Math.min(max, Math.max(min, Math.round(number / step) * step));
    if (step < 1) result[key] = Number(result[key].toFixed(2));
  }
  result.accent = normalizeHex(source.accent) ?? VISUAL_DEFAULTS.accent;
  result.base = normalizeHex(source.base);
  result.text = normalizeHex(source.text);
  for (const [key, values] of Object.entries(VISUAL_CHOICES)) result[key] = values.includes(source[key]) ? source[key] : VISUAL_DEFAULTS[key];
  for (const key of ['motion', 'accentBar']) result[key] = typeof source[key] === 'boolean' ? source[key] : VISUAL_DEFAULTS[key];
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
  const sections = Object.fromEntries(SECTIONS.map(s => [s.id, { ...previous.sections[s.id], ...patch.sections?.[s.id] }]));
  // Custom definitions own their modes/periods; accept the shared setMode patch API too.
  const customSections = normalizeCustomSections(patch.customSections ?? previous.customSections).map(item => ({
    ...item, ...patch.sections?.[item.id], id: item.id,
  }));
  ctx.extensionSettings[SETTINGS_KEY] = normalizeSettings({ ...previous, ...patch, sections, customSections });
  ctx.saveSettingsDebounced();
  return ctx.extensionSettings[SETTINGS_KEY];
}

export function effectiveModes(settings, store) {
  return Object.fromEntries(getSections(settings).map(s => [s.id,
    isMode(store?.modeOverride?.[s.id]) ? store.modeOverride[s.id] : s.custom ? s.defaultMode : settings.sections[s.id].mode]));
}
