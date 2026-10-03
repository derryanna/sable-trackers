import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createSettings } from '../src/ui/settings.js';
import { applyVisual, createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';
import { VISUAL_DEFAULTS, normalizeVisual } from '../src/settings.js';
import { BG_MAX_STORED, applyPreset, exportTheme } from '../src/themes.js';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(t, { encodeImage = async () => PNG } = {}) {
  const dom = new JSDOM('<body><div id="extensions-settings-button"><button class="drawer-toggle"></button></div><div id="extensions_settings2"></div></body>');
  const document = dom.window.document;
  const fake = createFakeST();
  fake.ctx.extensionSettings.sableTrackers.language = 'en';
  const runtime = createRuntime(fake.getContext); runtime.start();
  const patches = [], encoded = [], toasts = [];
  const wrapped = { ...runtime, updateSettings(patch) { patches.push(patch); runtime.updateSettings(patch); } };
  const previousToastr = globalThis.toastr;
  globalThis.toastr = Object.fromEntries(['success', 'warning', 'error'].map(type => [type, message => toasts.push([type, message])]));
  const ui = createSettings(wrapped, { document, getContext: fake.getContext,
    encodeImage: async (file, options) => { encoded.push([file, options.fill]); return encodeImage(file, options); } });
  const drawer = createDrawer(runtime, { document });
  t.after(() => { drawer.dispose(); ui.dispose(); runtime.dispose(); dom.window.close(); globalThis.toastr = previousToastr; });
  const query = selector => ui.element.querySelector(selector);
  const fire = (selector, type, value) => {
    const input = query(selector);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  };
  const change = (selector, value) => fire(selector, 'change', value);
  const choose = async (selector, files) => {
    const input = query(selector);
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick(); await tick();
  };
  const button = label => [...query('[data-group="visual"]').querySelectorAll('button')].find(item => item.textContent === label);
  const visual = () => runtime.snapshot().settings.visual;
  const tab = document.querySelector('.st-sable-tab');
  return { dom, document, runtime, ui, drawer: drawer.element, tab, query, fire, change, choose, button, visual, patches, encoded, toasts };
}

test('appearance group: panel / cards / background / theme sub-groups with the new controls, in both languages', t => {
  const { ui, query, runtime, button } = setup(t);
  assert.deepEqual([...ui.element.querySelectorAll('.st-sable-settings-heading')].map(item => item.textContent),
    ['Connection', 'Context', 'Sections', 'Bond scales', 'Custom blocks', 'Appearance', 'Actions', 'Packs', 'Danger zone'], 'top-level settings groups');
  const group = query('[data-group="visual"]');
  assert.deepEqual([...group.querySelectorAll('.st-sable-settings-subheading')].map(item => item.textContent), ['Panel', 'Card colours', 'Cards', 'Effects', 'Background', 'Theme']);
  for (const name of ['opacity', 'blur', 'fontSize', 'widthVw', 'base', 'text', 'accent', 'effects', 'radius', 'cardFill', 'border', 'titleWeight',
    'titleFont', 'chipStyle', 'spacing', 'icons', 'accentBar', 'bgFile', 'bgUrl', 'bgDim', 'bgFit', 'preset', 'themeFile']) {
    assert.ok(group.querySelector(`[name="${name}"]`), name);
  }
  assert.deepEqual([...group.querySelectorAll('[name="bgFit"] option')].map(item => item.value), ['cover', 'contain', 'tile']);
  assert.deepEqual([...group.querySelectorAll('[name="titleFont"] option')].map(item => item.value), ['theme', 'serif', 'mono', 'rounded']);
  assert.equal(query('[name="titleWeight"]').step, '100');
  assert.equal(query('[name="bgFile"]').accept, 'image/*');
  assert.equal(query('[name="bgFile"]').hidden, true, 'a button opens the native picker');
  assert.equal(query('[name="effects"]').value, 'subtle');
  assert.deepEqual([...group.querySelectorAll('[name="effects"] option')].map(item => item.value), ['off', 'subtle', 'full']);
  assert.equal(query('[name="accentBar"]').checked, true);
  // No picture yet: the preview says so and the picture-only controls are off.
  assert.ok(query('.st-sable-settings-thumb').hasAttribute('data-empty'));
  assert.equal(query('.st-sable-settings-thumb').textContent, 'no picture');
  assert.deepEqual([query('[name="bgDim"]').disabled, query('[name="bgFit"]').disabled, button('Remove background').disabled], [true, true, true]);
  assert.equal(query('[name="bgUrl"]').placeholder, 'https://…');
  assert.ok(button('Save theme file') && button('Load theme file') && button('Restore default look'));
  assert.equal(query('img'), null, 'the preview is a CSS background, not an <img>');
  runtime.updateSettings({ language: 'ru' });
  assert.deepEqual([...group.querySelectorAll('.st-sable-settings-subheading')].map(item => item.textContent), ['Панель', 'Цвета карточек', 'Карточки', 'Эффекты', 'Фон', 'Тема']);
  assert.equal(query('[name="effects"]').closest('label').querySelector('.st-sable-settings-label').textContent, 'Эффекты');
  assert.deepEqual([...group.querySelectorAll('[name="effects"] option')].map(item => item.textContent), ['выкл', 'мягко', 'полные']);
  for (const label of ['Убрать фон', 'Выбрать картинку', 'Экспорт темы', 'Импорт темы', 'Сбросить вид']) assert.ok(button(label), label);
  assert.equal(query('[name="preset"]').selectedOptions[0].textContent, 'Стекло');
});

test('appearance: new sliders preview on input and persist on change; selects and checkboxes reach the drawer and the tab', t => {
  const { query, fire, change, drawer, tab, patches, visual, button } = setup(t);
  const before = patches.length;
  fire('[name="cardFill"]', 'input', '0.2');
  assert.equal(patches.length, before, 'dragging does not write');
  assert.equal(drawer.style.getPropertyValue('--st-sable-card-fill'), '0.2');
  assert.equal(query('[name="cardFill"]').closest('label').querySelector('output').textContent, '20%');
  fire('[name="titleWeight"]', 'input', '600');
  assert.equal(query('[name="titleWeight"]').closest('label').querySelector('output').textContent, '600');
  change('[name="cardFill"]', '0.2');
  assert.deepEqual(patches.at(-1), { visual: { ...VISUAL_DEFAULTS, cardFill: 0.2 } });
  change('[name="border"]', '0.3');
  change('[name="titleWeight"]', '600');
  change('[name="titleFont"]', 'serif');
  change('[name="chipStyle"]', 'outline');
  change('[name="spacing"]', 'compact');
  change('[name="accentBar"]', false);
  change('[name="effects"]', 'off');
  assert.deepEqual(visual(), { ...VISUAL_DEFAULTS, cardFill: 0.2, border: 0.3, titleWeight: 600, titleFont: 'serif', chipStyle: 'outline',
    spacing: 'compact', accentBar: false, effects: 'off' });
  assert.deepEqual({ ...drawer.dataset }, { stSableEffects: 'off', stSableTitleFont: 'serif', stSableChip: 'outline', stSableAccentBar: 'off', stSableSpacing: 'compact' });
  assert.deepEqual([drawer.style.getPropertyValue('--st-sable-border'), drawer.style.getPropertyValue('--st-sable-title-weight')], ['0.3', '600']);
  assert.equal(tab.dataset.stSableEffects, 'off', 'the tab follows the effects level');
  assert.equal(query('[name="effects"]').value, 'off');
  button('Restore default look').click();
  assert.deepEqual(visual(), { ...VISUAL_DEFAULTS });
  assert.deepEqual({ ...drawer.dataset }, { stSableEffects: 'subtle' }, 'the default look carries no data attributes besides the effects level');
  assert.equal(query('[name="accentBar"]').checked, true);
});

test('background: a link or a shrunk file is stored; bad links, oversized and unreadable pictures are refused with a toast', async t => {
  const results = [];
  const { query, change, choose, drawer, tab, visual, toasts, encoded, button, runtime } = setup(t, { encodeImage: async () => results.shift()() });
  change('[name="bgUrl"]', '  https://example.com/bg.webp ');
  assert.equal(visual().bgImage, 'https://example.com/bg.webp');
  assert.equal(drawer.dataset.stSableBg, '1');
  assert.equal(drawer.style.getPropertyValue('--st-sable-bg-image'), 'url("https://example.com/bg.webp")');
  assert.equal(tab.dataset.stSableBg, undefined, 'the edge tab never gets the picture');
  assert.equal(tab.style.getPropertyValue('--st-sable-bg-image'), '');
  const thumb = query('.st-sable-settings-thumb');
  assert.equal(thumb.hasAttribute('data-empty'), false);
  assert.match(thumb.style.backgroundImage, /example\.com\/bg\.webp/);
  assert.deepEqual([query('[name="bgDim"]').disabled, query('[name="bgFit"]').disabled, button('Remove background').disabled], [false, false, false]);
  change('[name="bgFit"]', 'tile');
  change('[name="bgDim"]', '0.7');
  assert.deepEqual([drawer.dataset.stSableFit, drawer.style.getPropertyValue('--st-sable-bg-dim')], ['tile', '0.7']);
  change('[name="bgUrl"]', 'javascript:alert(1)');
  assert.equal(visual().bgImage, 'https://example.com/bg.webp', 'a bad link is not stored');
  assert.equal(toasts.at(-1)[0], 'warning');
  change('[name="bgUrl"]', '');
  assert.equal(visual().bgImage, null, 'emptying the field removes a linked picture');
  assert.equal(drawer.dataset.stSableBg, undefined);
  assert.equal(drawer.style.getPropertyValue('--st-sable-bg-image'), '');

  runtime.updateSettings({ visual: { ...visual(), base: '#f4f1ea' } });
  results.push(() => PNG);
  const file = { name: 'photo.png' };
  await choose('[name="bgFile"]', [file]);
  assert.deepEqual(encoded.at(-1), [file, '#f4f1ea'], 'transparent parts are filled with the panel colour');
  assert.equal(visual().bgImage, PNG);
  assert.equal(query('[name="bgUrl"]').value, '', 'a data URL is not shown in the link field');
  assert.equal(query('[name="bgUrl"]').placeholder, 'picture from a file');
  change('[name="bgUrl"]', '');
  assert.equal(visual().bgImage, PNG, 'an empty link field leaves a picture from a file alone');
  const count = toasts.length;
  results.push(() => `data:image/jpeg;base64,${'A'.repeat(BG_MAX_STORED)}`);
  await choose('[name="bgFile"]', [{ name: 'huge.jpg' }]);
  assert.deepEqual(toasts.slice(count).map(([type]) => type), ['warning']);
  assert.match(toasts.at(-1)[1], /600/);
  assert.equal(visual().bgImage, PNG, 'an oversized result is not stored');
  results.push(() => { throw new Error('decode failed'); });
  await choose('[name="bgFile"]', [{ name: 'broken.heic' }]);
  assert.equal(toasts.at(-1)[0], 'error');
  assert.equal(visual().bgImage, PNG);
  await choose('[name="bgFile"]', []);
  assert.equal(encoded.length, 3, 'cancelling the picker does nothing');
  button('Remove background').click();
  assert.equal(visual().bgImage, null);
  assert.ok(query('.st-sable-settings-thumb').hasAttribute('data-empty'));
  assert.equal(query('.st-sable-settings-thumb').style.backgroundImage, '');
});

test('theme: presets apply and show, a tweak shows «custom»; export downloads sable-theme.json; import validates', async t => {
  const { dom, document, query, change, choose, visual, runtime, toasts, button } = setup(t);
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, bgImage: PNG, fontSize: 15 } });
  assert.equal(query('[name="preset"]').value, 'glass');
  change('[name="preset"]', 'paper');
  assert.deepEqual(visual(), applyPreset({ ...VISUAL_DEFAULTS, bgImage: PNG, fontSize: 15 }, 'paper'));
  assert.deepEqual([visual().base, visual().titleFont, visual().bgImage, visual().fontSize], ['#f4f1ea', 'serif', PNG, 15]);
  query('[name="preset"]').blur();
  runtime.publish();
  assert.equal(query('[name="preset"]').value, 'paper');
  change('[name="radius"]', '10');
  assert.equal(query('[name="preset"]').value, '');
  assert.equal(query('[name="preset"]').selectedOptions[0].textContent, 'custom');
  assert.equal(query('[name="preset"] option[value=""]').disabled, true, '«custom» only reports, it cannot be picked');

  let blob, link;
  dom.window.URL.createObjectURL = value => { blob = value; return 'blob:theme'; };
  dom.window.URL.revokeObjectURL = () => {};
  document.addEventListener('click', event => { if (event.target.tagName === 'A') { link = event.target; event.preventDefault(); } });
  button('Save theme file').click();
  assert.equal(link.download, 'sable-theme.json');
  assert.equal(link.href, 'blob:theme');
  assert.equal(link.isConnected, false, 'the temporary link is removed');
  const text = await new Promise(resolve => { const reader = new dom.window.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
  assert.deepEqual(JSON.parse(text).visual, normalizeVisual(visual()), 'the whole visual object, picture included');
  assert.equal(JSON.parse(text).visual.bgImage, PNG);

  const neon = { ...applyPreset({}, 'neon'), cardFill: 0.1 };
  await choose('[name="themeFile"]', [{ text: async () => exportTheme(neon) }]);
  assert.deepEqual(visual(), normalizeVisual(neon));
  assert.equal(toasts.at(-1)[0], 'success');
  for (const bad of [{ text: async () => '{"foo":1}' }, { text: async () => 'not json' }, { text: async () => { throw new Error('io'); } }]) {
    await choose('[name="themeFile"]', [bad]);
    assert.equal(toasts.at(-1)[0], 'warning');
    assert.deepEqual(visual(), normalizeVisual(neon), 'an invalid file changes nothing');
  }
});

test('applyVisual: numbers as variables, choices as data attributes only when not default, the picture only on the panel', () => {
  const dom = new JSDOM('<body><aside class="st-sable-drawer"></aside><button class="st-sable-tab"></button></body>');
  const [panel, tab] = [dom.window.document.querySelector('aside'), dom.window.document.querySelector('button')];
  const vars = element => Object.fromEntries(['card-fill', 'border', 'title-weight', 'bg-dim', 'bg-image'].map(name => [name, element.style.getPropertyValue(`--st-sable-${name}`)]));
  applyVisual(panel, {});
  assert.deepEqual(vars(panel), { 'card-fill': '0.05', border: '0.13', 'title-weight': '700', 'bg-dim': '0.45', 'bg-image': '' });
  assert.deepEqual({ ...panel.dataset }, { stSableEffects: 'subtle' });
  const custom = { bgImage: PNG, bgFit: 'contain', bgDim: 0.2, effects: 'off', titleFont: 'mono', chipStyle: 'outline', accentBar: false, spacing: 'compact' };
  let imageWrites = 0;
  const setProperty = panel.style.setProperty.bind(panel.style);
  panel.style.setProperty = (name, ...rest) => { if (name === '--st-sable-bg-image') imageWrites++; return setProperty(name, ...rest); };
  applyVisual(panel, custom);
  applyVisual(panel, { ...custom, bgDim: 0.3 });
  applyVisual(panel, { ...custom, bgDim: 0.4 });
  assert.equal(imageWrites, 1, 'an unchanged picture is not re-set on every render or slider tick');
  assert.equal(panel.style.getPropertyValue('--st-sable-bg-image'), `url("${PNG}")`);
  assert.deepEqual({ ...panel.dataset }, { stSableEffects: 'off', stSableTitleFont: 'mono', stSableChip: 'outline', stSableAccentBar: 'off',
    stSableSpacing: 'compact', stSableBg: '1', stSableFit: 'contain' });
  applyVisual(tab, custom);
  assert.equal(tab.style.getPropertyValue('--st-sable-bg-image'), '');
  assert.equal(tab.dataset.stSableBg, undefined);
  assert.equal(tab.dataset.stSableEffects, 'off');
  applyVisual(panel, { ...custom, bgImage: 'https://example.com/x.png"); background: red' });
  assert.equal(panel.style.getPropertyValue('--st-sable-bg-image'), '', 'an unsafe URL never reaches the style');
  assert.equal(panel.dataset.stSableBg, undefined);
  assert.equal(panel.dataset.stSableFit, undefined, 'fit only matters with a picture');
  applyVisual(panel, {});
  assert.deepEqual({ ...panel.dataset }, { stSableEffects: 'subtle' });
});

test('round 3 CSS: picture layer under the cards, ink-only overlays, readable cards, motion switch, reveal without @starting-style', () => {
  const start = css.indexOf('/* Round 3: appearance */');
  assert.ok(start > css.indexOf('/* Compact scene strip'), 'the round 3 block sits at the end of the file');
  const block = css.slice(start), drawerPart = block.slice(0, block.indexOf('/* Appearance settings'));
  assert.equal(drawerPart.replaceAll('var(--st-sable-ink-rgb, 255,255,255)', 'INK').match(/rgba?\(\s*255\s*,\s*255\s*,\s*255/g), null, 'overlays use the ink');
  const layer = block.match(/\.st-sable-drawer\[data-st-sable-bg="1"\]::before\s*\{([^}]*)\}/)?.[1] ?? '';
  for (const rule of [/position:\s*absolute/, /z-index:\s*-1/, /top:\s*0/, /left:\s*0/, /right:\s*0/, /height:\s*100%/, /pointer-events:\s*none/,
    /var\(--st-sable-bg-image, none\)/, /rgba\(var\(--st-sable-base-rgb, 14,14,18\), var\(--st-sable-bg-dim, \.45\)\)/, /background-size:\s*100% 100%, cover/]) {
    assert.match(layer, rule);
  }
  assert.match(block, /\[data-st-sable-fit="contain"\]::before\s*\{\s*background-size:\s*100% 100%, contain/);
  assert.match(block, /\[data-st-sable-fit="tile"\]::before\s*\{[^}]*background-repeat:\s*no-repeat, repeat/);
  assert.match(block, /\[data-st-sable-bg="1"\] \.st-sable-card\s*\{[^}]*rgba\(var\(--st-sable-base-rgb, 14,14,18\), \.\d+\)/, 'cards get a base backing over a picture');
  assert.equal(/\.st-sable-tab[^{]*\{[^}]*--st-sable-bg-image/.test(block), false, 'the tab has no picture');
  assert.match(block, /\.st-sable-card\s*\{[^}]*var\(--st-sable-card-fill, \.05\)[^}]*\}/);
  assert.match(block, /\.st-sable-card\s*\{\s*border-color:\s*rgba\(var\(--st-sable-ink-rgb, 255,255,255\), var\(--st-sable-border, \.13\)\)/);
  assert.match(block, /\.st-sable-title, \.st-sable-card-title\s*\{\s*font-weight:\s*var\(--st-sable-title-weight, 700\)/);
  for (const font of ['serif', 'mono', 'rounded']) assert.match(block, new RegExp(`\\[data-st-sable-title-font="${font}"\\] :is\\(\\.st-sable-title, \\.st-sable-card-title\\) \\{ font-family:`));
  assert.match(block, /\[data-st-sable-chip="outline"\] \.st-sable-mode\[data-mode="inject"\]/);
  assert.match(block, /\[data-st-sable-accent-bar="off"\] \.st-sable-card::before\s*\{\s*display:\s*none/);
  assert.match(block, /\.st-sable-tab\[data-st-sable-effects="off"\], [^{]*\{\s*animation:\s*none !important;\s*transition:\s*none !important/);
  assert.match(block, /\.st-sable-drawer\[data-st-sable-effects="off"\] \*, [^{]*\{\s*animation:\s*none !important;\s*transition:\s*none !important/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*animation:\s*none !important/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.st-sable-drawer, \.st-sable-tab\[aria-expanded="true"\] \{ animation: none; \}/, 'the original rule stays');
  // Unfold motion lives on the persistent card, so full re-renders never replay it (see the comment in style.css).
  assert.match(block, /@property --st-sable-reveal \{ syntax: '<number>'; inherits: true; initial-value: 1; \}/);
  assert.match(block, /\.st-sable-card:has\(> \.st-sable-card-body\[hidden\]\)\s*\{\s*--st-sable-reveal:\s*0/);
  assert.equal(/^\s*@starting-style/m.test(css), false);
  // Press feedback uses the scale property, which composes with the tab's translateY(-50%) centring.
  assert.match(block, /\.st-sable-tab:active\s*\{\s*scale:\s*\.97/);
  assert.equal(/:active[^{]*\{[^}]*transform:/.test(block), false);
  // The live-card rules (SPEC §16) follow with their own limits; see test/effects.test.mjs.
  const round3 = block.slice(0, block.indexOf('/* Live cards (SPEC §16)'));
  for (const [, , value] of round3.matchAll(/(animation|transition):([^;}]*)/g)) {
    if (value.includes('st-sable-pulse')) { assert.match(value, /1\.5s ease-in-out infinite/); continue; }
    for (const [, amount, unit] of value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) assert.ok(Number(amount) * (unit === 's' ? 1000 : 1) <= 200);
  }
});

test('card colours normalize valid ids and hex values into fresh objects', () => {
  const source = { world: '#ABC', c_0123abcd: '#123456', npcs: 'red', nope: '#fff', c_ABCDEF12: '#fff', constructor: '#fff' };
  const visual = normalizeVisual({ cardColors: source });
  assert.deepEqual(visual.cardColors, { world: '#aabbcc', c_0123abcd: '#123456' });
  assert.notEqual(visual.cardColors, source);
  assert.notEqual(normalizeVisual(visual).cardColors, visual.cardColors);
  assert.equal(Object.getPrototypeOf(visual.cardColors), Object.prototype);
  visual.cardColors.world = '#000000';
  assert.equal(source.world, '#ABC');
  for (const cardColors of [null, [], 'bad', 42, undefined]) {
    const result = normalizeVisual({ cardColors });
    assert.deepEqual(result.cardColors, {});
    assert.notEqual(result.cardColors, VISUAL_DEFAULTS.cardColors);
  }
  assert.deepEqual(VISUAL_DEFAULTS.cardColors, {});
  assert.ok(Object.isFrozen(VISUAL_DEFAULTS.cardColors));
});

test('tinted card border has an rgba fallback before color-mix and leaves text alone', () => {
  const rule = css.match(/\.st-sable-card\[data-st-sable-tinted="1"\]\s*\{([^}]+)\}/)[1];
  assert.match(rule, /border-color: rgba\([^;]+;\s*border-color: color-mix\(in srgb, var\(--st-sable-accent\) 40%, transparent\)/);
  assert.doesNotMatch(rule, /(?:^|;)\s*(?:color|background):/);
});
