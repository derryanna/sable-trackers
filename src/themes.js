import { VISUAL_DEFAULTS, normalizeVisual } from './settings.js';

// Themes (SPEC §12): a theme is the whole `visual` object. Pure helpers, no browser globals.

export const THEME_FILE = 'sable-theme.json';
export const THEME_FORMAT = 'sable-theme';

// Personal choices a preset leaves alone: the background image, reading size, phone width and motion.
export const PRESET_KEEPS = Object.freeze(['bgImage', 'bgDim', 'bgFit', 'motion', 'fontSize', 'widthVw', 'cardColors']);

/** Bundled starting points: partial visual objects over the defaults. The user tweaks from there. */
export const PRESETS = Object.freeze({
  glass: Object.freeze({}),
  paper: Object.freeze({ base: '#f4f1ea', accent: '#8a6d1e', titleFont: 'serif', blur: 0, opacity: 0.98 }),
  neon: Object.freeze({ base: '#0b0b14', accent: '#b388ff', chipStyle: 'outline', titleFont: 'mono', border: 0.16 }),
});
export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

/** The visual object for a preset, keeping the current PRESET_KEEPS values. Unknown ids change nothing. */
export function applyPreset(visual, id) {
  const current = normalizeVisual(visual);
  if (!Object.hasOwn(PRESETS, id)) return current;
  const kept = Object.fromEntries(PRESET_KEEPS.map(key => [key, current[key]]));
  return normalizeVisual({ ...VISUAL_DEFAULTS, ...PRESETS[id], ...kept });
}

/** Id of the preset the look matches exactly (kept keys aside), or '' for a custom look. */
export function presetOf(visual) {
  const current = normalizeVisual(visual);
  return PRESET_IDS.find(id => {
    const preset = applyPreset(current, id);
    return Object.keys(VISUAL_DEFAULTS).every(key => PRESET_KEEPS.includes(key) || preset[key] === current[key]);
  }) ?? '';
}

/** Theme file text: a format tag plus the normalised visual object, background data URL included. */
export function exportTheme(visual) {
  return `${JSON.stringify({ format: THEME_FORMAT, version: 1, visual: normalizeVisual(visual) }, null, 2)}\n`;
}

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** Normalised visual object from theme file text (a wrapped export or a bare visual object), or null
 *  when the text is not JSON or has no visual key at all. Unknown keys are dropped, bad values fall back. */
export function parseTheme(text) {
  let data;
  const source = String(text ?? '');
  try { data = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source); } catch { return null; }
  const visual = isObject(data) && isObject(data.visual) ? data.visual : data;
  if (!isObject(visual) || !Object.keys(visual).some(key => Object.hasOwn(VISUAL_DEFAULTS, key))) return null;
  return normalizeVisual(visual);
}

// Background images from a file: long side at most BG_MAX_SIDE px, JPEG at BG_QUALITY, refused above BG_MAX_STORED characters.
export const BG_MAX_SIDE = 1280;
export const BG_QUALITY = 0.82;
export const BG_MAX_STORED = 600 * 1024;

/** Size that fits within max × max with the same aspect ratio; never upscales, never below 1 px. */
export function fitWithin(width, height, max = BG_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
