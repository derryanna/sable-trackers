import assert from 'node:assert/strict';
import test from 'node:test';
import { BG_IMAGE_MAX_LENGTH, VISUAL_DEFAULTS, normalizeBgImage, normalizeVisual } from '../src/settings.js';
import { BG_MAX_SIDE, PRESETS, PRESET_IDS, PRESET_KEEPS, THEME_FILE, applyPreset, exportTheme, fitWithin, parseTheme, presetOf } from '../src/themes.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('round 3 visual keys: defaults, clamped ranges, closed choices and booleans', () => {
  assert.deepEqual(Object.fromEntries(['bgImage', 'bgDim', 'bgFit', 'motion', 'cardFill', 'border', 'titleFont', 'titleWeight', 'chipStyle', 'accentBar', 'spacing']
    .map(key => [key, VISUAL_DEFAULTS[key]])), { bgImage: null, bgDim: 0.45, bgFit: 'cover', motion: true, cardFill: 0.05, border: 0.13,
    titleFont: 'theme', titleWeight: 700, chipStyle: 'filled', accentBar: true, spacing: 'cozy' });
  assert.deepEqual(normalizeVisual(undefined), { ...VISUAL_DEFAULTS });
  const clamped = normalizeVisual({ bgDim: 0.95, cardFill: -1, border: '0.555', titleWeight: 650 });
  assert.deepEqual([clamped.bgDim, clamped.cardFill, clamped.border, clamped.titleWeight], [0.9, 0, 0.5, 700]);
  assert.equal(normalizeVisual({ cardFill: 0.126 }).cardFill, 0.13, 'rounded to the slider step');
  assert.equal(normalizeVisual({ titleWeight: 1000 }).titleWeight, 800);
  assert.equal(normalizeVisual({ titleWeight: 420 }).titleWeight, 500);
  const choices = normalizeVisual({ bgFit: 'tile', titleFont: 'mono', chipStyle: 'outline', spacing: 'compact', motion: false, accentBar: false });
  assert.deepEqual([choices.bgFit, choices.titleFont, choices.chipStyle, choices.spacing, choices.motion, choices.accentBar],
    ['tile', 'mono', 'outline', 'compact', false, false]);
  const junk = normalizeVisual({ bgFit: 'stretch', titleFont: 'Comic Sans', chipStyle: 1, spacing: null, motion: 'false', accentBar: 0 });
  assert.deepEqual([junk.bgFit, junk.titleFont, junk.chipStyle, junk.spacing, junk.motion, junk.accentBar],
    ['cover', 'theme', 'filled', 'cozy', true, true], 'unknown choices and non-boolean flags fall back to defaults');
});

test('background image: only base64 png/jpeg/webp data URLs or http(s) URLs that are safe inside CSS url("…")', () => {
  const backslash = String.fromCharCode(92);
  for (const ok of [PNG, 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', 'data:image/webp;base64,UklGRg==',
    'http://127.0.0.1:8001/backgrounds/bedroom%20clean.jpg', 'https://example.com/a/b.webp?x=1&y=2#z']) assert.equal(normalizeBgImage(ok), ok, ok);
  assert.equal(normalizeBgImage('  https://example.com/x.png \n'), 'https://example.com/x.png', 'surrounding whitespace is trimmed');
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGOD==', 'data:image/png,rawnotbase64', 'data:text/html;base64,PGI+',
    'javascript:alert(1)', 'ftp://example.com/x.png', '//example.com/x.png', 'x.png', 'https://example.com/a b.png', 'https://example.com/a(1).png',
    'https://example.com/a".png', "https://example.com/a'.png", `https://example.com/a${backslash}.png`, 'https://example.com/<x>.png',
    `${PNG}")`, '', '   ', null, 42, {}, ['https://example.com/x.png']]) {
    assert.equal(normalizeBgImage(bad), null, String(bad));
  }
  const long = `data:image/jpeg;base64,${'A'.repeat(BG_IMAGE_MAX_LENGTH)}`;
  assert.equal(normalizeBgImage(long), null, 'over about 900 KB is refused');
  assert.equal(normalizeVisual({ bgImage: 'url(x)' }).bgImage, null);
  assert.equal(normalizeVisual({ bgImage: PNG }).bgImage, PNG);
});

test('presets: glass is the default look; paper and neon set their values and keep the background, size, width and motion', () => {
  assert.deepEqual(PRESET_IDS, ['glass', 'paper', 'neon']);
  assert.deepEqual(applyPreset({}, 'glass'), { ...VISUAL_DEFAULTS });
  const mine = { ...VISUAL_DEFAULTS, bgImage: PNG, bgDim: 0.6, bgFit: 'tile', motion: false, fontSize: 15, widthVw: 92, radius: 10, accent: '#ff0000', spacing: 'compact' };
  const paper = applyPreset(mine, 'paper');
  assert.deepEqual([paper.base, paper.accent, paper.titleFont, paper.blur], ['#f4f1ea', '#8a6d1e', 'serif', 0]);
  assert.equal(paper.radius, VISUAL_DEFAULTS.radius, 'a preset starts from the defaults');
  assert.equal(paper.spacing, 'cozy');
  for (const key of PRESET_KEEPS) assert.deepEqual(paper[key], mine[key], `${key} survives a preset`);
  const neon = applyPreset(mine, 'neon');
  assert.deepEqual([neon.base, neon.accent, neon.chipStyle, neon.titleFont], ['#0b0b14', '#b388ff', 'outline', 'mono']);
  assert.deepEqual(applyPreset(mine, 'nope'), normalizeVisual(mine), 'an unknown preset changes nothing');
  assert.deepEqual(applyPreset(mine, 'toString'), normalizeVisual(mine));
  for (const id of PRESET_IDS) assert.deepEqual(normalizeVisual({ ...VISUAL_DEFAULTS, ...PRESETS[id] }), { ...VISUAL_DEFAULTS, ...PRESETS[id] }, `${id} holds valid values`);
});

test('presetOf names the matching preset, ignoring kept keys, and returns "" after a tweak', () => {
  assert.equal(presetOf({}), 'glass');
  assert.equal(presetOf({ ...VISUAL_DEFAULTS, bgImage: PNG, fontSize: 16, motion: false }), 'glass');
  assert.equal(presetOf(applyPreset({ bgImage: PNG }, 'paper')), 'paper');
  assert.equal(presetOf(applyPreset({}, 'neon')), 'neon');
  assert.equal(presetOf({ ...applyPreset({}, 'neon'), cardFill: 0.1 }), '');
});

test('theme export/import round-trips the whole visual object, background data URL included', () => {
  assert.equal(THEME_FILE, 'sable-theme.json');
  const visual = { ...applyPreset({}, 'neon'), bgImage: PNG, bgDim: 0.3, cardFill: 0.12 };
  const text = exportTheme(visual);
  const data = JSON.parse(text);
  assert.equal(data.format, 'sable-theme');
  assert.equal(data.version, 1);
  assert.equal(data.visual.bgImage, PNG);
  assert.deepEqual(parseTheme(text), normalizeVisual(visual));
  assert.deepEqual(parseTheme(`﻿${text}`), normalizeVisual(visual), 'a byte-order mark is ignored');
  assert.deepEqual(parseTheme(JSON.stringify({ accent: '#abc', spacing: 'compact' })), { ...VISUAL_DEFAULTS, accent: '#aabbcc', spacing: 'compact' }, 'a bare visual object works');
  const dirty = parseTheme(JSON.stringify({ visual: { accent: '#123456', evil: '<script>', bgImage: 'javascript:alert(1)', opacity: 9 } }));
  assert.deepEqual(dirty, { ...VISUAL_DEFAULTS, accent: '#123456', opacity: 1 }, 'unknown keys drop, bad values fall back or clamp');
  assert.equal(Object.hasOwn(dirty, 'evil'), false);
  for (const bad of ['', 'not json', '[]', '[{"accent":"#fff"}]', 'null', '42', '"text"', '{}', '{"foo":1}', '{"visual":{"foo":1}}']) {
    assert.equal(parseTheme(bad), null, bad);
  }
});

test('fitWithin shrinks the long side to 1280 px, keeps the ratio and never upscales', () => {
  assert.equal(BG_MAX_SIDE, 1280);
  assert.deepEqual(fitWithin(4000, 3000), { width: 1280, height: 960 });
  assert.deepEqual(fitWithin(1080, 2400), { width: 576, height: 1280 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1280, 1280), { width: 1280, height: 1280 });
  assert.deepEqual(fitWithin(20000, 10), { width: 1280, height: 1 });
  assert.deepEqual(fitWithin(0, 0), { width: 1, height: 1 });
});
