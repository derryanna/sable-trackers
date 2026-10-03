import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { BOND_SCALES, SECTION_MAP, SIGNED_HINT, bondScales, bondsSection, getSections, normalizeBondScales } from '../src/sections.js';
import { VISUAL_DEFAULTS, normalizeSettings, normalizeVisual } from '../src/settings.js';
import { parseStateOutput, sanitizeSection } from '../src/parse.js';
import { HISTORY_POINTS, loadStore, pruneHistory, recordHistory } from '../src/store.js';
import { createDrawer, signedNumber } from '../src/ui/drawer.js';
import { createPanel } from '../src/ui/panel.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

const bond = (id, stats) => ({ id, name: id, stats, changes: {} });

test('history: append per bond and active key, replace on the same mesId, cap at 12, prune by message', () => {
  const data = loadStore({ chatMetadata: {} });
  assert.deepEqual(data.history, {});
  recordHistory(data, [bond('maren', { trust: 30, fear: null, grudge: 'x', jealousy: 5 })], 1, ['trust', 'fear', 'grudge']);
  assert.deepEqual(data.history, { maren: { trust: [{ mesId: 1, value: 30 }] } }, 'only finite values of active keys');
  recordHistory(data, [bond('maren', { trust: 35 })], 1, ['trust']);
  assert.deepEqual(data.history.maren.trust, [{ mesId: 1, value: 35 }], 'the same mesId replaces the last point');
  recordHistory(data, [bond('maren', { trust: 40 }), bond('ilse', { trust: -20 })], 3, ['trust']);
  assert.deepEqual(data.history.maren.trust.map(p => p.mesId), [1, 3]);
  assert.deepEqual(data.history.ilse.trust, [{ mesId: 3, value: -20 }]);
  for (let id = 4; id < 24; id++) recordHistory(data, [bond('maren', { trust: id })], id, ['trust']);
  assert.equal(HISTORY_POINTS, 12);
  assert.deepEqual(data.history.maren.trust.map(p => p.mesId), Array.from({ length: 12 }, (_, i) => 12 + i));
  // A bond missing from the state keeps its history until its messages are deleted.
  recordHistory(data, [bond('maren', { trust: 1 })], 24, ['trust']);
  assert.ok(data.history.ilse);
  pruneHistory(data, 20);
  assert.deepEqual(data.history.maren.trust.map(p => p.mesId), [13, 14, 15, 16, 17, 18, 19]);
  assert.ok(data.history.ilse, 'mesId 3 still exists');
  pruneHistory(data, new Set([13]));
  assert.deepEqual(data.history, { maren: { trust: [{ mesId: 13, value: 13 }] } }, 'empty scales and bonds go');
});

const answer = (trust, extra = {}) => `<sable_state>${JSON.stringify({ bonds: [{ id: 'maren', name: 'Maren', stats: { trust, ...extra }, changes: {} }] })}</sable_state>`;
function runtimeSetup(t, settings = {}) {
  const fake = createFakeST();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, settings);
  const runtime = createRuntime(fake.getContext); runtime.start();
  t.after(() => runtime.dispose());
  return { ...fake, runtime, history: () => fake.ctx.chatMetadata.sableTrackers.history };
}

test('runtime: a stored run result and editState("bonds") write points; a swipe of the same reply replaces; delete prunes', async t => {
  const fake = runtimeSetup(t);
  fake.respond(answer(30)); const first = fake.add(); await fake.runtime.run(first);
  assert.deepEqual(fake.history().maren.trust, [{ mesId: 0, value: 30 }]);
  fake.respond(answer(36)); await fake.runtime.refresh();
  assert.deepEqual(fake.history().maren.trust, [{ mesId: 0, value: 36 }]);
  fake.ctx.chat.push({ mes: 'hi', is_user: true });
  fake.respond(answer(40)); const second = fake.add(); await fake.runtime.run(second);
  assert.deepEqual(fake.history().maren.trust, [{ mesId: 0, value: 36 }, { mesId: 2, value: 40 }]);
  assert.equal(fake.runtime.editState('bonds', [{ id: 'maren', name: 'Maren', stats: { trust: 50, fear: 10 } }]), true);
  assert.deepEqual(fake.history().maren.trust.at(-1), { mesId: 2, value: 50 });
  assert.deepEqual(fake.history().maren.fear, [{ mesId: 2, value: 10 }]);
  assert.equal(fake.runtime.snapshot().store.history, fake.history(), 'the drawer reads it from the snapshot');
  fake.ctx.chat.length = 2; await fake.emit('MESSAGE_DELETED', 2);
  assert.deepEqual(fake.history(), { maren: { trust: [{ mesId: 0, value: 36 }] } });
});

test('signed scales: settings, schema, parsing clamps to −100…100 and the generated definition', () => {
  assert.equal(VISUAL_DEFAULTS.sparklines, true);
  assert.equal(normalizeVisual({ sparklines: 'no' }).sparklines, true);
  assert.equal(normalizeVisual({ sparklines: false }).sparklines, false);
  assert.deepEqual(normalizeBondScales({ signed: ['trust', 'trust', 'bogus', 3, 'fear'] }).signed, ['trust', 'fear']);
  assert.equal(normalizeBondScales({ custom: [{ key: 'envy', title: 'Envy', signed: 1 }] }).custom[0].signed, true);
  const settings = normalizeSettings({ bondScales: { off: ['trust'], signed: ['trust', 'affection'], custom: [{ key: 'envy', title: 'Envy', hint: 'envy of toward', signed: true }] } });
  assert.deepEqual(settings.bondScales.signed, ['trust', 'affection'], 'a switched-off scale keeps its flag');
  const scales = bondScales(settings);
  assert.equal(scales.find(s => s.key === 'affection').signed, true);
  assert.equal(scales.find(s => s.key === 'fear').signed, false);
  assert.equal(scales.find(s => s.key === 'envy').signed, true);
  const section = bondsSection(settings), fields = section.schema.item.fields.stats.fields;
  assert.deepEqual(fields.affection, { type: 'score', min: -100 });
  assert.deepEqual(fields.fear, { type: 'score' });
  assert.deepEqual(fields.envy, { type: 'score', min: -100 });
  assert.equal(SIGNED_HINT, ' (−100…+100, negative = the opposite feeling)');
  assert.match(section.instructions, /affection = emotional attachment, not necessarily romance \(−100…\+100, negative = the opposite feeling\); desire = /);
  assert.match(section.instructions, /envy = envy of toward \(−100…\+100, negative = the opposite feeling\)\. Known/);
  assert.doesNotMatch(section.instructions, /fear = fear of toward \(/);
  // A signed flag alone rebuilds the section; no flag keeps the frozen default.
  assert.notEqual(bondsSection({ bondScales: { signed: ['fear'] } }), SECTION_MAP.bonds);
  assert.equal(bondsSection({ bondScales: { signed: [] } }), SECTION_MAP.bonds);
  const [cleaned] = sanitizeSection(section, [{ id: 'maren', stats: { affection: -40.4, fear: -30, envy: -250, respect: 130 } }]);
  assert.deepEqual(cleaned.stats, { affection: -40, fear: 0, envy: -100, respect: 100 });
  const parsed = parseStateOutput(`<sable_state>${JSON.stringify({ bonds: [{ id: 'm', stats: { affection: -65 } }] })}</sable_state>`, ['bonds'], getSections(settings));
  assert.equal(parsed.sections.bonds[0].stats.affection, -65);
  assert.equal(sanitizeSection({ schema: { type: 'score' } }, -5), 0, 'unsigned scores stay 0–100');
  assert.deepEqual([signedNumber(65), signedNumber(-40), signedNumber(0)], ['+65', '−40', '0']);
});

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
function drawerSetup(t, settings = {}, history = {}) {
  const dom = new JSDOM('<body><div id="chat"></div><div id="extensions-settings-button"><button class="drawer-toggle"></button></div><div id="extensionsMenu"></div></body>', { pretendToBeVisual: true });
  const fake = createFakeST(); fake.add();
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 1, state: structuredClone(fixture) }], history };
  Object.assign(fake.ctx.extensionSettings.sableTrackers, settings);
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document: dom.window.document });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  return { dom, fake, runtime, ui, document: dom.window.document };
}
const points = values => values.map((value, mesId) => ({ mesId, value }));

test('drawer sparklines: absent under 2 points, bar count and heights, friction tint, the toggle, kept node', t => {
  const history = { maren: { trust: points([0, 50, 100, 25]), tension: points([60]), suspicion: points([10, 45]) } };
  const { document, runtime } = drawerSetup(t, {}, history);
  const row = scale => document.querySelector(`[data-key="bonds:maren:${scale}"]`);
  const spark = scale => row(scale).querySelector('.st-sable-spark');
  assert.equal(spark('tension'), null, 'one point is not a line');
  assert.equal(spark('affection'), null, 'no history');
  const trust = spark('trust');
  assert.equal(trust.getAttribute('role'), 'button', 'a button since SPEC §26');
  assert.equal(trust.textContent, '');
  assert.equal(trust.parentElement, row('trust').querySelector('summary'), 'inside the summary, so a closed row shows it');
  assert.deepEqual([...trust.children].map(bar => bar.style.height), ['8%', '50%', '100%', '25%']);
  assert.ok(trust.classList.contains('st-sable-affinity'));
  assert.ok(spark('suspicion').classList.contains('st-sable-friction'));
  // Keyed: a new point resizes the same node in place.
  const store = runtime.snapshot().store;
  store.history.maren.trust.push({ mesId: 9, value: 75 });
  runtime.publish();
  assert.equal(spark('trust'), trust);
  assert.deepEqual([...trust.children].map(bar => bar.style.height), ['8%', '50%', '100%', '25%', '75%']);
  store.history.maren.trust.splice(0, 3);
  runtime.publish();
  assert.equal(spark('trust'), trust);
  assert.equal(trust.children.length, 2);
  runtime.updateSettings({ visual: { ...runtime.snapshot().settings.visual, sparklines: false } });
  assert.equal(spark('trust'), null, 'hidden when the visual toggle is off');
  runtime.updateSettings({ visual: { ...runtime.snapshot().settings.visual, sparklines: true } });
  assert.equal(spark('trust').children.length, 2);
});

test('drawer: a signed scale draws a centred bar with a signed number; person cards share the row', t => {
  const { document, runtime } = drawerSetup(t, { bondScales: { signed: ['trust', 'affection', 'fear'] } },
    { maren: { trust: points([-100, 0, 100]) } });
  const bar = scale => document.querySelector(`[data-key="bonds:maren:${scale}"] .st-sable-bar`);
  const score = scale => document.querySelector(`[data-key="bonds:maren:${scale}"] .st-sable-score`).textContent;
  const trust = bar('trust'), fill = trust.firstElementChild;
  assert.ok(trust.classList.contains('st-sable-signed'));
  assert.equal(trust.getAttribute('aria-valuemin'), '-100');
  assert.equal(fill.style.left, '50%'); assert.equal(fill.style.right, '');
  assert.equal(fill.style.transform, 'scaleX(0.34)');
  assert.equal(score('trust'), '+34');
  assert.ok(trust.classList.contains('st-sable-affinity'));
  assert.ok(!bar('suspicion').classList.contains('st-sable-signed'), 'unsigned unless flagged');
  assert.equal(score('suspicion'), '45');
  assert.deepEqual([...document.querySelectorAll('[data-key="bonds:maren:trust"] .st-sable-spark > span')].map(s => [s.style.height, s.classList.contains('st-sable-negative')]),
    [['8%', true], ['50%', false], ['100%', false]], 'signed heights span −100…+100');
  // A negative value fills leftwards from the centre in the warm tint, updated in place.
  runtime.editState('bonds', [{ ...fixture.bonds[0], stats: { ...fixture.bonds[0].stats, trust: -40, fear: 0 } }]);
  assert.equal(bar('trust'), trust);
  assert.equal(fill.style.left, ''); assert.equal(fill.style.right, '50%');
  assert.equal(fill.style.transform, 'scaleX(0.4)');
  assert.ok(trust.classList.contains('st-sable-negative') && trust.classList.contains('st-sable-friction'));
  assert.equal(score('trust'), '−40');
  assert.equal(score('fear'), '0');
  // A friction scale's negative side takes the other tint.
  runtime.editState('bonds', [{ ...fixture.bonds[0], stats: { ...fixture.bonds[0].stats, fear: -20 } }]);
  assert.ok(bar('fear').classList.contains('st-sable-affinity'));
  // Turning the flag off keeps the stored value and draws a normal bar again.
  runtime.updateSettings({ bondScales: { signed: [] } });
  assert.ok(!bar('trust').classList.contains('st-sable-signed'));
  assert.equal(bar('trust').firstElementChild.style.left, '');
  assert.equal(score('trust'), '34');
  runtime.updateSettings({ layout: 'people', bondScales: { signed: ['trust'] } });
  const person = document.querySelector('[data-key="person:maren:trust"]');
  assert.ok(person.querySelector('.st-sable-bar').classList.contains('st-sable-signed'));
  assert.equal(person.querySelector('.st-sable-score').textContent, '+34');
  assert.ok(person.querySelector('.st-sable-spark'), 'person cards pass the history too');
});

test('reply panel prints a signed scale with its sign', t => {
  const { document, fake, runtime, ui } = drawerSetup(t, { language: 'en', bondScales: { signed: ['trust'] } });
  const mes = document.createElement('div'); mes.className = 'mes'; mes.setAttribute('mesid', '0'); mes.setAttribute('is_user', 'false');
  mes.innerHTML = '<div class="mes_text">x</div>'; document.querySelector('#chat').append(mes);
  const panel = createPanel(runtime, ui, { document, getContext: fake.getContext });
  t.after(() => panel.dispose());
  const badges = () => [...document.querySelectorAll('.st-sable-panel-badge')].map(badge => badge.textContent);
  assert.deepEqual(badges(), ['Maren: +5 Trust → +34']);
  runtime.updateSettings({ bondScales: { signed: [] } });
  assert.deepEqual(badges(), ['Maren: +5 Trust']);
});

test('settings: sparklines checkbox, built-in signed checkboxes and the custom scale signed flag', t => {
  const dom = new JSDOM('<body><div id="extensions_settings"></div></body>', { pretendToBeVisual: true });
  const fake = createFakeST();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { language: 'ru', bondScales: { custom: [{ key: 'envy', title: 'Envy' }] } });
  const runtime = createRuntime(fake.getContext); runtime.start();
  const patches = [];
  const ui = createSettings({ ...runtime, updateSettings(patch) { patches.push(patch); runtime.updateSettings(patch); } },
    { document: dom.window.document, getContext: fake.getContext });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const fire = element => element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const spark = ui.element.querySelector('input[name="sparklines"]');
  assert.ok(spark.checked);
  assert.equal(spark.parentElement.textContent, 'Мини-графики под полосками');
  spark.checked = false; fire(spark);
  assert.equal(runtime.snapshot().settings.visual.sparklines, false);
  const group = ui.element.querySelector('[data-group="scales"]');
  const signed = [...group.querySelectorAll('input[data-signed]')];
  assert.deepEqual(signed.map(box => box.dataset.signed), BOND_SCALES);
  assert.ok(signed.every(box => !box.checked && box.parentElement.textContent === '−100…+100'));
  signed[1].checked = true; fire(signed[1]);
  signed[0].checked = true; fire(signed[0]);
  assert.deepEqual(patches.at(-1).bondScales.signed, ['affection', 'trust'], 'the whole array in canonical order');
  // Switching a scale off keeps its signed flag.
  const trustOn = group.querySelector('input[data-scale="trust"]'); trustOn.checked = false; fire(trustOn);
  assert.deepEqual(runtime.snapshot().settings.bondScales, { off: ['trust'], signed: ['affection', 'trust'], custom: [{ key: 'envy', title: 'Envy', hint: '', friction: false, signed: false }] });
  signed[0].checked = false; fire(signed[0]);
  assert.deepEqual(runtime.snapshot().settings.bondScales.signed, ['trust']);
  const row = group.querySelector('.st-sable-scale-custom'), custom = row.querySelector('input[name="signed"]');
  assert.equal(custom.parentElement.textContent, '−100…+100');
  assert.equal(custom.closest('.st-sable-scale-checks'), row.querySelector('[name="friction"]').closest('.st-sable-scale-checks'), 'next to friction');
  custom.checked = true; fire(custom);
  assert.equal(runtime.snapshot().settings.bondScales.custom[0].signed, true);
  runtime.updateSettings({ spoilers: false });
  assert.ok(row.querySelector('input[name="signed"]').checked, 'rendered from the settings');
  assert.ok(signed[1].checked && !signed[0].checked);
});

test('CSS: sparkline and signed bar rules; the custom scale row has no flex-basis height', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.st-sable-spark \{[^}]*display: flex; align-items: flex-end; gap: 2px; height: 16px; margin-top: 3px;/);
  assert.match(css, /\.st-sable-spark > span \{[^}]*flex: 1; min-width: 2px; border-radius: 1px; opacity: \.75;/);
  assert.match(css, /\.st-sable-bar\.st-sable-signed::before \{[^}]*left: calc\(50% - \.5px\)/);
  assert.doesNotMatch(css, /\.st-sable-scale-custom [^{]*\[data-field="hint"\][^{]*\{[^}]*flex: 1 1/);
  assert.match(css, /\.st-sable-scale-custom \{[^}]*gap: 8px;/);
});
