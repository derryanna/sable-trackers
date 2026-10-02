import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { applyEffects, createDrawer, TICK_MS } from '../src/ui/drawer.js';
import { createPanel } from '../src/ui/panel.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';
import { EFFECTS_LEVELS, FX_DEFAULTS, FX_RANGES, FX_SPEEDS, VISUAL_CHOICES, VISUAL_DEFAULTS, normalizeFx, normalizeVisual } from '../src/settings.js';
import { PRESET_IDS, PRESET_KEEPS, applyPreset, exportTheme, parseTheme, presetOf } from '../src/themes.js';

// Live cards (SPEC §16): the effects level, the composable fx set, keyed rows, the reply panel and the CSS gating.
const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
const css = (await readFile(new URL('../style.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n'); // CRLF checkouts
const drawerSource = await readFile(new URL('../src/ui/drawer.js', import.meta.url), 'utf8');
const panelSource = await readFile(new URL('../src/ui/panel.js', import.meta.url), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const combat = () => ({
  combat_scene: 'Two guards at the gate.',
  combat_stats: [
    { key: 'Guard · HP', value: 40, max: 100, note: 'blade cut' },
    { key: 'Guard · stamina', value: 70, max: 100 },
    { key: 'rounds', value: 3, max: null, unit: 'r' },
  ],
  combat_odds: [{ key: 'crit %', value: '15 (estimate)' }],
  combat_roll: '',
});

function setup(t, { state = structuredClone(fixture), visual, reduced = false, random = () => 0.86, chat = false } = {}) {
  const dom = new JSDOM(`<body><div id="extensions-settings-button"><button class="drawer-toggle"></button></div><div id="extensionsMenu"></div>
    <div id="extensions_settings2"></div>${chat ? '<div id="chat"><div class="mes" mesid="0" is_user="false"><div class="mes_text">Reply</div></div></div>' : ''}</body>`,
  { pretendToBeVisual: true });
  const document = dom.window.document;
  if (reduced) dom.window.matchMedia = query => ({ matches: query.includes('reduce'), media: query });
  const fake = createFakeST(); fake.add();
  fake.ctx.extensionSettings.sableTrackers.language = 'en';
  if (visual) fake.ctx.extensionSettings.sableTrackers.visual = visual;
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 14, state }], lastRun: { at: 1234567890000, ok: true, ms: 250 } };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const patches = [];
  const wrapped = { ...runtime, updateSettings(patch) { patches.push(patch); runtime.updateSettings(patch); } };
  const ui = createDrawer(runtime, { document, random });
  const settings = createSettings(wrapped, { document, getContext: fake.getContext });
  const panel = chat ? createPanel(runtime, ui, { document, getContext: fake.getContext }) : null;
  t.after(() => { panel?.dispose(); settings.dispose(); ui.dispose(); runtime.dispose(); dom.window.close(); });
  const card = id => ui.element.querySelector(`[data-section="${id}"]`);
  const row = (id, key) => card(id).querySelector(`details[data-key="${id}:${key}"]`);
  const query = selector => settings.element.querySelector(selector);
  const fire = (selector, type, value) => {
    const input = query(selector);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  };
  const change = (selector, value) => fire(selector, 'change', value);
  return { dom, document, fake, runtime, ui, drawer: ui.element, settings, panel, card, row, query, fire, change, patches,
    state: () => runtime.snapshot().entry.state, visual: () => runtime.snapshot().settings.visual };
}

test('visual.effects replaces motion: false → off, true → subtle, missing → subtle; the motion key is dropped', () => {
  assert.deepEqual(EFFECTS_LEVELS, ['off', 'subtle', 'full']);
  assert.equal(VISUAL_CHOICES.effects, EFFECTS_LEVELS);
  assert.equal(VISUAL_DEFAULTS.effects, 'subtle');
  assert.equal(Object.hasOwn(VISUAL_DEFAULTS, 'motion'), false);
  for (const [source, level] of [[{ motion: false }, 'off'], [{ motion: true }, 'subtle'], [{}, 'subtle'], [{ motion: 'false' }, 'subtle'],
    [{ effects: 'full', motion: false }, 'full'], [{ effects: 'loud', motion: false }, 'off'], [{ effects: 'off' }, 'off']]) {
    const visual = normalizeVisual(source);
    assert.equal(visual.effects, level, JSON.stringify(source));
    assert.equal(Object.hasOwn(visual, 'motion'), false);
  }
  // Theme import runs through the same normaliser: an old theme file migrates too.
  assert.equal(parseTheme(JSON.stringify({ format: 'sable-theme', version: 1, visual: { opacity: 0.9, motion: false } })).effects, 'off');
  assert.equal(parseTheme(JSON.stringify({ motion: true, accent: '#abc' })).effects, 'subtle');
});

test('normalizeVisual: fx defaults, clamped knobs, validated colours and speeds, unknown keys dropped, idempotent', () => {
  assert.deepEqual(normalizeVisual({}).fx, FX_DEFAULTS);
  assert.deepEqual(normalizeFx(undefined), FX_DEFAULTS);
  assert.notEqual(normalizeVisual({}).fx, FX_DEFAULTS, 'a fresh object, never the frozen default');
  assert.deepEqual(Object.keys(FX_DEFAULTS), ['glow', 'shimmer', 'rain', 'ticks', 'valueColor', 'dice', 'cardGlow']);
  assert.deepEqual(FX_SPEEDS, ['slow', 'medium', 'fast']);
  const dirty = normalizeVisual({ fx: {
    glow: { on: true, color: '#ABC', intensity: 7, junk: 1 }, shimmer: { on: 'yes', speed: 'warp', color: 'red' },
    rain: { on: true, density: '0.333', color: null, angle: -99 }, ticks: { on: true, speed: 'fast' }, valueColor: 'on', dice: null, cardGlow: { on: 1 },
    sparkles: { on: true }, constructor: { on: true },
  } });
  assert.deepEqual(dirty.fx, {
    glow: { on: true, color: '#aabbcc', intensity: 1 }, shimmer: { on: false, speed: 'medium', color: null },
    rain: { on: true, density: 0.35, color: null, angle: -30 }, ticks: { on: true }, valueColor: { on: false }, dice: { on: false }, cardGlow: { on: false },
  });
  assert.equal(Object.hasOwn(dirty.fx, 'sparkles'), false);
  assert.equal(Object.getPrototypeOf(dirty.fx), Object.prototype);
  assert.deepEqual(normalizeVisual(dirty), dirty, 'idempotent');
  assert.deepEqual(normalizeVisual(normalizeVisual({ fx: { rain: { angle: 12.4, density: 0.52 } } })).fx.rain, { on: false, density: 0.5, color: null, angle: 12 });
  for (const [knob, [min, max]] of Object.entries(FX_RANGES)) {
    const [name, key] = knob.split('.');
    assert.equal(normalizeFx({ [name]: { [key]: 1e9 } })[name][key], max, `${knob} max`);
    assert.equal(normalizeFx({ [name]: { [key]: -1e9 } })[name][key], min, `${knob} min`);
    assert.equal(normalizeFx({ [name]: { [key]: 'NaN' } })[name][key], FX_DEFAULTS[name][key], `${knob} junk falls back`);
  }
  for (const bad of [[], 'glow', 42, null, { glow: [] }]) assert.deepEqual(normalizeFx(bad), FX_DEFAULTS, String(bad));
});

test('presets keep effects and fx; theme export round-trips them', () => {
  assert.ok(PRESET_KEEPS.includes('effects') && PRESET_KEEPS.includes('fx') && !PRESET_KEEPS.includes('motion'));
  const mine = normalizeVisual({ effects: 'full', fx: { glow: { on: true, color: '#ff0000', intensity: 0.8 }, rain: { on: true, angle: -20 } } });
  for (const id of PRESET_IDS) {
    const visual = applyPreset(mine, id);
    assert.equal(visual.effects, 'full', `${id} keeps the level`);
    assert.deepEqual(visual.fx, mine.fx, `${id} keeps the fx set`);
    assert.notEqual(visual.fx, mine.fx);
    assert.equal(presetOf(visual), id, 'the fx set never makes a look "custom"');
    assert.deepEqual(parseTheme(exportTheme(visual)), visual);
  }
  assert.deepEqual(JSON.parse(exportTheme(mine)).visual.fx.glow, { on: true, color: '#ff0000', intensity: 0.8 });
});

test('subtle: the same bar node survives a re-render with a new value; changed flags last one render; new rows appear unflagged', t => {
  const { card, runtime, state, drawer } = setup(t);
  assert.equal(drawer.dataset.stSableEffects, 'subtle');
  const bonds = card('bonds');
  const trustRow = bonds.querySelector('details[data-key="bonds:maren:trust"]'), trust = trustRow.querySelector('.st-sable-bar-fill');
  assert.equal(trust.style.transform, 'scaleX(0.34)');
  assert.equal(trustRow.querySelector('.st-sable-score').textContent, '34');
  assert.equal(bonds.querySelector('[data-st-sable-changed]'), null, 'the first render flags nothing');
  state().bonds[0].stats.trust = 60;
  runtime.publish();
  assert.equal(card('bonds'), bonds, 'the card node persists');
  assert.equal(bonds.querySelector('details[data-key="bonds:maren:trust"] .st-sable-bar-fill'), trust, 'the fill node persists');
  assert.equal(trust.style.transform, 'scaleX(0.6)');
  assert.equal(trustRow.querySelector('[role="meter"]').getAttribute('aria-valuenow'), '60');
  assert.equal(trustRow.querySelector('.st-sable-score').textContent, '60');
  assert.deepEqual([...bonds.querySelectorAll('details[data-st-sable-changed]')].map(item => item.dataset.key), ['bonds:maren:trust'], 'only the changed row');
  assert.ok(bonds.hasAttribute('data-st-sable-changed'));
  assert.equal(card('world').hasAttribute('data-st-sable-changed'), false);
  runtime.publish();
  assert.equal(bonds.querySelector('[data-st-sable-changed]'), null, 'the flag lasts one render');
  assert.equal(bonds.hasAttribute('data-st-sable-changed'), false);
  assert.equal(bonds.querySelector('details[data-key="bonds:maren:trust"] .st-sable-bar-fill'), trust, 'an unchanged render keeps the node too');
  assert.equal(bonds.querySelector('details[data-key="bonds:maren:desire"]'), null, 'an unknown scale has no row');
  state().bonds[0].stats.desire = 20;
  runtime.publish();
  const desire = bonds.querySelector('details[data-key="bonds:maren:desire"]');
  assert.ok(desire);
  assert.equal(desire.hasAttribute('data-st-sable-changed'), false, 'a brand-new row appears at its value without a flag');
  assert.equal(desire.querySelector('.st-sable-bar-fill').style.transform, 'scaleX(0.2)');
  assert.equal(desire.previousElementSibling.dataset.key, 'bonds:maren:trust', 'rows follow the scale order');
  assert.equal(bonds.querySelector('details[data-key="bonds:maren:trust"] .st-sable-bar-fill'), trust);
  // Rows keep their order from the registry; a row whose scale disappears is removed.
  state().bonds[0].stats.desire = null;
  runtime.publish();
  assert.equal(bonds.querySelector('details[data-key="bonds:maren:desire"]'), null);
  assert.deepEqual([...bonds.querySelectorAll('details')].map(item => item.tagName), Array(8).fill('DETAILS'), 'every scale row is a details');
});

test('subtle: the title dot shows on a changed card until it is unfolded or the next run', t => {
  const { card, runtime, state } = setup(t);
  const dot = id => card(id).querySelector('.st-sable-card-title > .st-sable-change-dot');
  assert.equal(dot('bonds').hidden, true);
  assert.equal(dot('bonds').getAttribute('aria-label'), 'changed');
  state().bonds[0].stats.trust = 60;
  runtime.publish();
  assert.equal(dot('bonds').hidden, false);
  assert.equal(dot('world').hidden, true);
  runtime.updateSettings({ folded: { bonds: true } });
  assert.equal(dot('bonds').hidden, false, 'folding keeps the dot');
  runtime.publish();
  assert.equal(dot('bonds').hidden, false, 'an unrelated render keeps the dot');
  card('bonds').querySelector('[data-control="fold"]').click();
  assert.equal(runtime.snapshot().settings.folded.bonds, false);
  assert.equal(dot('bonds').hidden, true, 'unfolding clears the dot');
  state().bonds[0].stats.trust = 70;
  runtime.publish();
  assert.equal(dot('bonds').hidden, false);
  // The next run touches another section only: a new ring entry clears the dots.
  state().meta = { ...state().meta, updatedAt: Date.now() + 1 };
  state().world.summary = 'A new summary.';
  runtime.publish();
  assert.equal(dot('bonds').hidden, true, 'the next run clears the dot');
  assert.equal(dot('world').hidden, true, 'text sections do not get dots');
});

test('subtle: a stat row with a note opens it on tap; a plain row stays static; a delta row keeps its badge', t => {
  const { card, runtime } = setup(t, { state: { world: { location: 'Gate' }, ...combat() } });
  runtime.setPack('combat', true);
  const stats = card('combat_stats');
  const hp = stats.querySelector('details[data-key="combat_stats:Guard · HP"]');
  assert.ok(hp && !hp.classList.contains('st-sable-static') && !hp.classList.contains('st-sable-delta'));
  assert.equal(hp.querySelector('.st-sable-badge').hidden, true);
  assert.equal(hp.querySelector('.st-sable-reason').textContent, 'blade cut');
  assert.equal(hp.open, false);
  hp.querySelector('summary').click();
  assert.equal(hp.open, true, 'the note opens on tap');
  runtime.publish();
  assert.equal(hp.open, true, 'and stays open across renders');
  const stamina = stats.querySelector('details[data-key="combat_stats:Guard · stamina"]');
  assert.ok(stamina.classList.contains('st-sable-static'));
  const click = new stamina.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true });
  stamina.querySelector('summary').dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'a plain row ignores the tap');
  assert.equal(stamina.open, false);
  const rounds = stats.querySelector('details[data-key="combat_stats:rounds"]');
  assert.equal(rounds.querySelector('[role="meter"]'), null);
  assert.equal(rounds.querySelector('.st-sable-score').textContent, '3 r');
  // Merge writes delta on a run (the sanitizer drops it from edits), so the next state is written directly here.
  runtime.snapshot().entry.state.combat_stats = [{ key: 'Guard · HP', value: 28, max: 100, note: 'blade cut', delta: -12 }, { key: 'rounds', value: 4, max: null, unit: 'r' }];
  runtime.publish();
  assert.equal(stats.querySelector('details[data-key="combat_stats:Guard · HP"]'), hp, 'the row survives the delta appearing');
  assert.ok(hp.classList.contains('st-sable-delta'));
  assert.equal(hp.querySelector('.st-sable-badge').hidden, false);
  assert.equal(hp.querySelector('.st-sable-badge').textContent, '−12');
  assert.ok(hp.hasAttribute('data-st-sable-changed'));
  assert.equal(hp.querySelector('.st-sable-bar-fill').style.transform, 'scaleX(0.28)');
  assert.equal(stats.querySelector('details[data-key="combat_stats:Guard · stamina"]'), null, 'a dropped stat removes its row');
  assert.equal(stats.querySelector('details[data-key="combat_stats:rounds"]'), rounds);
  assert.equal(rounds.querySelector('.st-sable-score').textContent, '4 r');
});

test('reduced motion forces off at runtime; fx tokens and variables exist only at full with the effect on', t => {
  const { drawer, runtime, document } = setup(t, { reduced: true, visual: { effects: 'full', fx: { glow: { on: true } } } });
  assert.equal(drawer.dataset.stSableEffects, 'off');
  assert.equal(drawer.dataset.stSableFx, undefined);
  assert.equal(document.querySelector('.st-sable-tab').dataset.stSableEffects, 'off');
  runtime.updateSettings({ visual: { effects: 'subtle' } });
  assert.equal(drawer.dataset.stSableEffects, 'off', 'the system setting wins over the level');
  const dom = new JSDOM('<aside class="st-sable-drawer"></aside>');
  const element = dom.window.document.querySelector('aside');
  const vars = () => Object.fromEntries(['glow-rgb', 'glow', 'shimmer-rgb', 'shimmer-duration', 'rain-rgb', 'rain-density', 'rain-angle']
    .map(name => [name, element.style.getPropertyValue(`--st-sable-${name}`)]));
  assert.equal(applyEffects(element, {}), 'subtle');
  assert.deepEqual({ ...element.dataset }, { stSableEffects: 'subtle' });
  assert.deepEqual(vars(), { 'glow-rgb': '', glow: '0.5', 'shimmer-rgb': '', 'shimmer-duration': '4s', 'rain-rgb': '', 'rain-density': '0.5', 'rain-angle': '10deg' },
    'automatic colours leave the variable unset, so the CSS falls back to the accent or the ink');
  const fx = { glow: { on: true, color: '#ff0000', intensity: 0.8 }, shimmer: { on: true, speed: 'fast' }, rain: { on: true, density: 0.2, angle: -15, color: '#0000ff' }, ticks: { on: true } };
  assert.equal(applyEffects(element, { effects: 'subtle', fx }), 'subtle');
  assert.equal(element.dataset.stSableFx, undefined, 'no effect applies below full');
  assert.equal(applyEffects(element, { effects: 'full', fx, accent: '#00ff00' }), 'full');
  assert.equal(element.dataset.stSableFx, 'glow shimmer rain ticks');
  assert.deepEqual(vars(), { 'glow-rgb': '255,0,0', glow: '0.8', 'shimmer-rgb': '0,255,0', 'shimmer-duration': '2s', 'rain-rgb': '0,0,255', 'rain-density': '0.2', 'rain-angle': '-15deg' },
    'a chosen colour wins; an automatic one follows the accent');
  assert.equal(applyEffects(element, { effects: 'full' }), 'full');
  assert.equal(element.dataset.stSableFx, undefined, 'everything off: no token');
  assert.equal(applyEffects(element, { effects: 'off', fx }), 'off');
  assert.equal(element.dataset.stSableFx, undefined);
});

test('full + ticks: the score counts over one rAF run of at most 250 ms and settles at once when the drawer closes', async t => {
  const { card, runtime, state, ui } = setup(t, { visual: { effects: 'full', fx: { ticks: { on: true } } } });
  assert.equal(TICK_MS, 250);
  const score = () => card('bonds').querySelector('details[data-key="bonds:maren:trust"] .st-sable-score');
  const node = score();
  state().bonds[0].stats.trust = 84;
  runtime.publish();
  assert.equal(score(), node);
  assert.equal(node.textContent, '34', 'the count starts from the old value on the next frame');
  await wait(TICK_MS + 150);
  assert.equal(node.textContent, '84');
  state().bonds[0].stats.trust = 10;
  runtime.publish();
  await wait(40);
  const during = Number(node.textContent);
  assert.ok(during < 84 && during > 10, `mid-run value ${during}`);
  ui.close();
  assert.equal(node.textContent, '10', 'closing settles the number and cancels the frame');
  await wait(60);
  assert.equal(node.textContent, '10');
  runtime.updateSettings({ visual: { effects: 'subtle', fx: { ticks: { on: true } } } });
  state().bonds[0].stats.trust = 55;
  runtime.publish();
  assert.equal(node.textContent, '55', 'below full the number just changes');
});

test('full + dice: the die spins, the result row flashes and a crit glows the roll card', t => {
  const { card, runtime } = setup(t, { state: { world: { location: 'Gate' }, ...combat() }, visual: { effects: 'full', fx: { dice: { on: true } } }, random: () => 0.1 });
  runtime.setPack('combat', true);
  const die = card('combat_odds').querySelector('.st-sable-dice');
  assert.equal(die.classList.contains('st-sable-rolling'), false);
  die.click();
  assert.equal(runtime.snapshot().entry.state.combat_roll, 'LAST ROLL: 11 vs crit 15 → hit');
  const spinning = card('combat_odds').querySelector('.st-sable-dice');
  assert.ok(spinning.classList.contains('st-sable-rolling'), 'the rebuilt die carries the spin');
  assert.match(spinning.style.getPropertyValue('--st-sable-roll-delay'), /^-\d+ms$/, 'resumed where the render left it');
  assert.ok(card('combat_roll').querySelector('.st-sable-line').hasAttribute('data-st-sable-rolled'));
  assert.ok(card('combat_roll').hasAttribute('data-st-sable-crit'), 'a hit on a crit chance glows the card');
  assert.equal(card('combat_odds').hasAttribute('data-st-sable-crit'), false);
  spinning.dispatchEvent(new spinning.ownerDocument.defaultView.Event('animationend', { bubbles: true }));
  assert.equal(spinning.classList.contains('st-sable-rolling'), false);
});

test('reply panel: one line per enabled pack with sliding bars whose nodes persist', t => {
  const { runtime, document, state, visual } = setup(t, { state: { world: { location: 'Gate' }, ...combat() }, chat: true,
    visual: { effects: 'full', fx: { cardGlow: { on: true } } } });
  const panel = () => document.querySelector('#chat .st-sable-panel');
  assert.ok(panel());
  assert.equal(panel().querySelector('.st-sable-panel-pack'), null, 'no pack on, no line');
  runtime.setPack('combat', true);
  const line = panel().querySelector('.st-sable-panel-pack');
  assert.ok(line);
  assert.equal(line.getAttribute('aria-label'), 'Combat');
  assert.deepEqual([...line.children].map(item => item.textContent), ['Guard · HP40/100', 'Guard · stamina70/100', 'rounds3 r']);
  const hp = line.children[0], fill = hp.querySelector('.st-sable-bar-fill');
  assert.equal(hp.querySelector('[role="meter"]').getAttribute('aria-valuenow'), '40');
  assert.equal(fill.style.transform, 'scaleX(0.4)');
  assert.equal(line.children[2].querySelector('[role="meter"]'), null, 'a counter has no bar');
  assert.deepEqual({ ...panel().dataset }, { stSableEffects: 'full', stSableFx: 'cardGlow' }, 'the panel carries the level and fx');
  const node = panel();
  state().combat_stats[0].value = 25;
  runtime.publish();
  assert.equal(panel(), node, 'the panel node persists');
  assert.equal(panel().querySelector('.st-sable-panel-pack .st-sable-bar-fill'), fill, 'the bar node persists');
  assert.equal(fill.style.transform, 'scaleX(0.25)');
  assert.equal(hp.textContent, 'Guard · HP25/100');
  assert.deepEqual([...panel().querySelectorAll('[data-st-sable-changed]')].map(item => item.dataset.key), ['combat_stats:Guard · HP']);
  runtime.publish();
  assert.equal(panel().querySelector('[data-st-sable-changed]'), null);
  runtime.updateSettings({ visual: { ...visual(), effects: 'off' } });
  assert.equal(panel().dataset.stSableEffects, 'off');
  assert.equal(panel().dataset.stSableFx, undefined);
  runtime.setPack('combat', false);
  assert.equal(panel().querySelector('.st-sable-panel-pack'), null);
  assert.ok(panel().querySelector('.st-sable-panel-world'), 'the text lines stay');
});

test('CSS: every transition and animation is covered by the off selectors and the reduced-motion block; full-only rules are scoped', () => {
  const start = css.indexOf('/* Live cards (SPEC §16)');
  assert.ok(start > 0);
  const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
  const live = css.slice(start), fullStart = live.indexOf('/* Full: every rule below'), bare = strip(css);
  assert.ok(fullStart > 0);
  // The stop rules: the drawer, the tab and the reply panel, their descendants and every pseudo-element.
  const roots = ['.st-sable-drawer', '.st-sable-tab', '.st-sable-panel'];
  const stop = /\{\s*animation:\s*none !important;\s*transition:\s*none !important;\s*\}/;
  const offRule = css.match(/\.st-sable-drawer\[data-st-sable-effects="off"\][^{]*\{[^}]*\}/)[0];
  assert.match(offRule, stop);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n'));
  const reducedRule = reduced.slice(0, reduced.indexOf('}') + 1);
  assert.match(reducedRule, stop);
  for (const root of roots) {
    const offRoot = `${root}[data-st-sable-effects="off"]`;
    for (const suffix of root === '.st-sable-tab' ? ['', '::before', '::after'] : ['', ' *', ' *::before', ' *::after']) {
      assert.ok(offRule.includes(`${offRoot}${suffix},`) || offRule.includes(`${offRoot}${suffix} {`), `off covers ${root}${suffix}`);
      assert.ok(reducedRule.includes(`${root}${suffix},`) || reducedRule.includes(`${root}${suffix} {`), `reduced motion covers ${root}${suffix}`);
    }
  }
  assert.ok(offRule.includes('.st-sable-drawer[data-st-sable-effects="off"]::before,') && offRule.includes('.st-sable-drawer[data-st-sable-effects="off"]::after,'));
  // Classes the drawer and the panel generate: a bare selector made of them sits under a covered root.
  const generated = new Set();
  for (const source of [drawerSource, panelSource]) {
    for (const [, name] of source.matchAll(/'([a-z][a-z-]*)'/g)) generated.add(`st-sable-${name}`);
    for (const [, name] of source.matchAll(/'(st-sable-[a-z-]+)'/g)) generated.add(name);
  }
  const animated = [...bare.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].filter(([, , body]) => /(?:^|;)\s*(?:animation|transition):\s*(?!none)/.test(body));
  assert.ok(animated.length >= 12, `found ${animated.length} animated rules`);
  for (const [, selectors] of animated) {
    for (const selector of selectors.split(',').map(item => item.trim()).filter(Boolean)) {
      if (roots.some(root => selector.startsWith(root))) continue;
      const name = selector.match(/^\.(st-sable-[a-z-]+)/)?.[1];
      assert.ok(name && generated.has(name), `${selector} is not under the drawer, the tab or the panel`);
      assert.doesNotMatch(selector, /st-sable-(settings|group|custom|fx|prompt|log|danger|dump|section-moves|card-colors)/, `${selector} is a settings selector`);
    }
  }
  // Keyframes used are defined; nothing animates layout.
  const keyframes = new Set([...css.matchAll(/@keyframes ([a-z-]+)/g)].map(([, name]) => name));
  for (const [, , body] of animated) for (const [, name] of body.matchAll(/animation:\s*(st-sable-[a-z-]+)/g)) assert.ok(keyframes.has(name), name);
  for (const [, body] of live.matchAll(/\{([^{}]*)\}/g)) assert.doesNotMatch(body, /(?:^|;)\s*(?:width|height|margin[a-z-]*|padding[a-z-]*|top|left|font-size)\s*:\s*[^;]*\b(?:ms|s)\b/);
  assert.doesNotMatch(live, /transition:\s*(?:width|height|margin|padding|all)\b/);
  // Full-only rules are scoped to the level; every data-st-sable-fx rule is too; subtle rules carry no level selector.
  const fullPart = strip(live.slice(fullStart));
  for (const [, selectors] of fullPart.matchAll(/([^{}@;]+)\{[^{}]*\}/g)) {
    for (const selector of selectors.split(',').map(item => item.trim()).filter(Boolean)) {
      if (/^(?:from|to|\d+%)$/.test(selector)) continue;
      assert.ok(selector.includes('[data-st-sable-effects="full"]'), `${selector} is not scoped to full`);
      assert.match(selector, /\[data-st-sable-fx~="(glow|shimmer|rain|valueColor|dice|cardGlow)"\]/, `${selector} names no effect`);
    }
  }
  for (const [, selectors] of bare.matchAll(/([^{}@;]*data-st-sable-fx[^{}@;]*)\{/g)) assert.ok(selectors.includes('[data-st-sable-effects="full"]'), selectors.trim());
  assert.equal(/data-st-sable-motion/.test(css), false, 'the old attribute is gone');
  // Durations: the bar slides in 180 ms, flashes take 300 ms, one-shot effects stay under 700 ms, and only the listed effects run continuously.
  assert.match(live, /\.st-sable-bar-fill \{ transition: transform 180ms ease-out; \}/);
  assert.match(live, /\[data-st-sable-changed\] \.st-sable-badge \{ animation: st-sable-badge-in 300ms/);
  assert.match(live, /\.st-sable-card\[data-st-sable-changed\]::after \{ animation: st-sable-accent-flash 300ms/);
  const continuous = new Set(['st-sable-shimmer', 'st-sable-shimmer-edge', 'st-sable-rain', 'st-sable-low']);
  for (const [, value] of live.matchAll(/(?:animation|transition):([^;}]*)/g)) {
    if (value.includes('none')) continue;
    const name = value.match(/st-sable-[a-z-]+/)?.[0];
    if (value.includes('infinite')) { assert.ok(continuous.has(name), `${name} may not run continuously`); continue; }
    for (const [, amount, unit] of value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) assert.ok(Number(amount) * (unit === 's' ? 1000 : 1) <= 700, value);
  }
  assert.match(live, /\.st-sable-dice\.st-sable-rolling > \* \{ animation: st-sable-spin 400ms/);
  assert.match(live, /\.st-sable-rain \{ display: none; \}/);
  assert.match(live, /background-size: 13px 90px, 21px 140px, 34px 210px/);
  assert.equal((live.match(/box-shadow/g) ?? []).length <= 8, true);
  for (const name of ['glow-pulse', 'crit']) assert.match(live, new RegExp(`@keyframes st-sable-${name} \\{[^}]*box-shadow`));
  for (const name of ['badge-in', 'accent-flash', 'rolled', 'low', 'spin', 'shimmer', 'rain']) assert.doesNotMatch(live, new RegExp(`@keyframes st-sable-${name} \\{[^}]*box-shadow`));
});

test('settings UI: the level select writes visual.effects; fx rows show only at full; switches, sliders and auto buttons write through updateSettings', t => {
  const { query, fire, change, patches, visual, drawer } = setup(t);
  const block = query('.st-sable-fx');
  assert.equal(block.hidden, true, 'fx rows are hidden below full');
  assert.deepEqual([...block.querySelectorAll('.st-sable-fx-row')].map(row => row.dataset.fx), Object.keys(FX_DEFAULTS));
  assert.deepEqual([...block.querySelectorAll('.st-sable-fx-row > label > span')].map(span => span.textContent),
    ['Glow', 'Shimmer', 'Rain', 'Numbers tick', 'Bar colour follows the value', 'Dice animation', 'Glow pulse on change']);
  change('[name="effects"]', 'full');
  assert.deepEqual(patches.at(-1), { visual: { ...VISUAL_DEFAULTS, effects: 'full' } });
  assert.equal(block.hidden, false);
  assert.equal(drawer.dataset.stSableEffects, 'full');
  const glow = block.querySelector('[data-fx="glow"]');
  assert.equal(glow.querySelector('.st-sable-fx-knobs').hidden, true, 'knobs appear once the effect is on');
  change('[name="fx.glow.on"]', true);
  assert.equal(visual().fx.glow.on, true);
  assert.equal(glow.querySelector('.st-sable-fx-knobs').hidden, false);
  assert.equal(drawer.dataset.stSableFx, 'glow');
  const before = patches.length;
  fire('[name="fx.glow.intensity"]', 'input', '0.8');
  assert.equal(patches.length, before, 'dragging previews without writing');
  assert.equal(drawer.style.getPropertyValue('--st-sable-glow'), '0.8');
  assert.equal(glow.querySelector('output').textContent, '80%');
  change('[name="fx.glow.intensity"]', '0.8');
  assert.equal(visual().fx.glow.intensity, 0.8);
  assert.deepEqual(patches.at(-1).visual.fx.glow, { on: true, color: null, intensity: 0.8 });
  assert.equal(query('[name="fx.glow.colorAuto"]').getAttribute('aria-pressed'), 'true');
  assert.equal(query('[name="fx.glow.color"]').value, VISUAL_DEFAULTS.accent, 'an automatic colour shows the accent');
  change('[name="fx.glow.color"]', '#ff0000');
  assert.equal(visual().fx.glow.color, '#ff0000');
  assert.equal(drawer.style.getPropertyValue('--st-sable-glow-rgb'), '255,0,0');
  assert.equal(query('[name="fx.glow.colorAuto"]').getAttribute('aria-pressed'), 'false');
  query('[name="fx.glow.colorAuto"]').click();
  assert.equal(visual().fx.glow.color, null, '«auto» stores null');
  assert.equal(drawer.style.getPropertyValue('--st-sable-glow-rgb'), '');
  const count = patches.length;
  query('[name="fx.glow.colorAuto"]').click();
  assert.equal(patches.length, count, 'auto on an automatic colour writes nothing');
  change('[name="fx.shimmer.speed"]', 'fast');
  assert.equal(visual().fx.shimmer.speed, 'fast');
  change('[name="fx.rain.on"]', true);
  change('[name="fx.rain.angle"]', '-45');
  assert.equal(visual().fx.rain.angle, -30, 'clamped on the way in');
  assert.equal(query('[name="fx.rain.angle"]').closest('label').querySelector('output').textContent, '-30°');
  assert.equal(drawer.style.getPropertyValue('--st-sable-rain-angle'), '-30deg');
  assert.equal(query('[name="fx.rain.color"]').value, '#ffffff', 'rain shows the ink as its automatic colour');
  assert.equal(drawer.dataset.stSableFx, 'glow shimmer rain'.replace('shimmer ', ''), 'speed alone does not switch shimmer on');
  change('[name="effects"]', 'subtle');
  assert.equal(block.hidden, true);
  assert.deepEqual(visual().fx.glow, { on: true, color: null, intensity: 0.8 }, 'the fx set survives a level change');
  assert.equal(drawer.dataset.stSableFx, undefined);
});
