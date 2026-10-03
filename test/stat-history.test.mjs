import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { HISTORY_POINTS, loadStore, pruneHistory, recordHistory, recordStatHistory } from '../src/store.js';
import { buildDigest } from '../src/digest.js';
import { getSections } from '../src/sections.js';
import { createDrawer } from '../src/ui/drawer.js';
import { createPanel } from '../src/ui/panel.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

const stat = (key, value, max = 100) => ({ key, value, max });

test('stat history: items with a numeric max, trimmed keys, absent lines dropped, same mesId replaces, cap, prune', () => {
  const data = loadStore({ chatMetadata: {} });
  recordStatHistory(data, 'combat_stats', [stat(' Maren · HP ', 40), stat('Maren · climaxes', 2, null), stat('Tomas · HP', 90)], 1);
  assert.deepEqual(data.history, { combat_stats: { 'Maren · HP': [{ mesId: 1, value: 40 }], 'Tomas · HP': [{ mesId: 1, value: 90 }] } },
    'a counter without max is ignored; the key is trimmed');
  recordStatHistory(data, 'combat_stats', [stat('Maren · HP', 35), stat('Tomas · HP', 80)], 1);
  assert.deepEqual(data.history.combat_stats['Maren · HP'], [{ mesId: 1, value: 35 }], 'a swipe of the same reply replaces');
  recordStatHistory(data, 'combat_stats', [stat('Maren · HP', 30), stat('Maren · climaxes', 3, null)], 3);
  assert.deepEqual(Object.keys(data.history.combat_stats), ['Maren · HP'], 'Tomas left the value and takes his line along');
  assert.deepEqual(data.history.combat_stats['Maren · HP'].map(p => p.mesId), [1, 3]);
  for (let id = 4; id < 24; id++) recordStatHistory(data, 'combat_stats', [stat('Maren · HP', id)], id);
  assert.equal(data.history.combat_stats['Maren · HP'].length, HISTORY_POINTS);
  // Bonds and stats share the map; a bond keeps its history when absent, a stats section does not.
  recordHistory(data, [{ id: 'ilse', stats: { trust: 20 } }], 23, ['trust']);
  recordStatHistory(data, 'c_0000000a', [stat('Old Ilse · luck', 7, 10)], 23);
  pruneHistory(data, 20);
  assert.deepEqual(data.history.combat_stats['Maren · HP'].map(p => p.mesId), [12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal(data.history.ilse, undefined);
  assert.equal(data.history.c_0000000a, undefined, 'pruned like bonds');
  recordStatHistory(data, 'combat_stats', [], 30);
  assert.deepEqual(data.history, {}, 'an empty value drops the section');
  recordStatHistory(data, 'combat_stats', undefined, 31);
  recordStatHistory(data, 'combat_stats', [stat('Maren · HP', 5)], 'x');
  assert.deepEqual(data.history, {}, 'no value or no message id writes nothing');
});

const custom = { id: 'c_0000000a', title: 'Vitals', shape: 'stats' };
function runtimeSetup(t) {
  const fake = createFakeST();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { packDefaults: ['combat'], customSections: [custom] });
  const runtime = createRuntime(fake.getContext); runtime.start();
  t.after(() => runtime.dispose());
  return { ...fake, runtime, history: () => fake.ctx.chatMetadata.sableTrackers.history };
}
const answer = (hp, extra = {}) => `<sable_state>${JSON.stringify({ combat_stats: [stat('Maren · HP', hp), stat('Maren · wounds', 1, null)],
  c_0000000a: [stat('Tomas · luck', 4, 10)], ...extra })}</sable_state>`;

test('runtime: a run records pack and custom stats; a refresh replaces; editState on a stats section writes; delete prunes', async t => {
  const fake = runtimeSetup(t);
  fake.respond(answer(40)); const first = fake.add(); await fake.runtime.run(first);
  assert.deepEqual(fake.history(), { combat_stats: { 'Maren · HP': [{ mesId: 0, value: 40 }] }, c_0000000a: { 'Tomas · luck': [{ mesId: 0, value: 4 }] } });
  fake.respond(answer(30)); await fake.runtime.refresh();
  assert.deepEqual(fake.history().combat_stats['Maren · HP'], [{ mesId: 0, value: 30 }]);
  fake.ctx.chat.push({ mes: 'hi', is_user: true });
  fake.respond(answer(20)); const second = fake.add(); await fake.runtime.run(second);
  assert.deepEqual(fake.history().combat_stats['Maren · HP'].map(p => p.value), [30, 20]);
  assert.equal(fake.runtime.editState('combat_stats', [stat('Maren · HP', 25), stat('Old Ilse · HP', 60)]), true);
  assert.deepEqual(fake.history().combat_stats, { 'Maren · HP': [{ mesId: 0, value: 30 }, { mesId: 2, value: 25 }],
    'Old Ilse · HP': [{ mesId: 2, value: 60 }] });
  assert.equal(fake.runtime.editState('combat_stats', [stat('Old Ilse · HP', 55)]), true);
  assert.deepEqual(Object.keys(fake.history().combat_stats), ['Old Ilse · HP'], 'an edit that removes a stat drops its line');
  // Switching the pack off in this chat leaves its history alone.
  fake.ctx.chatMetadata.sableTrackers.packs = [];
  fake.respond(answer(10)); fake.ctx.chat.push({ mes: 'hi', is_user: true }); await fake.runtime.run(fake.add());
  assert.deepEqual(Object.keys(fake.history().combat_stats), ['Old Ilse · HP']);
  fake.ctx.chat.length = 2; await fake.emit('MESSAGE_DELETED', 2);
  assert.equal(fake.history().combat_stats, undefined);
  assert.deepEqual(fake.history().c_0000000a['Tomas · luck'].map(p => p.mesId), [0]);
});

const points = values => values.map((value, index) => ({ mesId: index * 2, value }));
const state = {
  bonds: [{ id: 'maren', name: 'Maren', toward: 'Tomas', stats: { trust: -40 }, changes: {} }],
  combat_stats: [stat('Maren · HP', 40), stat('Maren · wounds', 2, null)],
};
function drawerSetup(t, settings = {}) {
  const dom = new JSDOM('<body><div id="chat"><div class="mes" mesid="2"></div></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, scrolls = [];
  document.querySelector('.mes').scrollIntoView = options => scrolls.push(options);
  const fake = createFakeST(); for (let i = 0; i < 7; i++) fake.add();
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 6, swipeId: 0, turn: 7, state: structuredClone(state) }],
    history: { maren: { trust: points([10, -20, -40]) }, combat_stats: { 'Maren · HP': points([100, 70, 40]), 'Maren · wounds': points([1, 2]) } } };
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { packDefaults: ['combat'], bondScales: { signed: ['trust'] } }, settings);
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const row = key => document.querySelector(`[data-key="${key}"]`);
  const spark = key => row(key)?.querySelector('.st-sable-spark');
  const labelOf = key => row(key).querySelector('.st-sable-spark-label');
  const tap = (element, x) => {
    element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 30, height: 36, right: 30, bottom: 36 });
    element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x }));
  };
  const key = (element, name) => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  return { dom, document, fake, runtime, ui, scrolls, row, spark, labelOf, tap, key };
}
const active = element => [...element.children].map(span => span.classList.contains('st-sable-spark-active'));

test('drawer: stats sparkline only for bars, accent tint, a button with an aria-label', t => {
  const { spark } = drawerSetup(t);
  const hp = spark('combat_stats:Maren · HP');
  assert.ok(hp, 'a stats bar with 2+ points gets the line');
  assert.ok(hp.classList.contains('st-sable-affinity'));
  assert.deepEqual([...hp.children].map(bar => bar.style.height), ['100%', '70%', '40%']);
  assert.equal(spark('combat_stats:Maren · wounds'), null, 'a counter has no line');
  assert.equal(hp.getAttribute('role'), 'button');
  assert.equal(hp.tabIndex, 0);
  assert.equal(hp.getAttribute('aria-label'), 'История');
});

test('drawer: a tap picks the bar under the pointer, labels it, scrolls to the reply; a second tap hides it', t => {
  const { document, row, spark, labelOf, tap, scrolls } = drawerSetup(t);
  const key = 'combat_stats:Maren · HP', hp = spark(key);
  tap(hp, 15);
  assert.deepEqual(active(hp), [false, true, false]);
  assert.equal(labelOf(key).textContent, 'ответ #2 · Maren · HP 70');
  assert.equal(labelOf(key).previousElementSibling, hp, 'the label row sits right under the sparkline');
  assert.deepEqual(scrolls, [{ block: 'center', behavior: 'smooth' }]);
  assert.equal(row(key).open, false, 'the tap does not unfold the row');
  // Not rendered in the chat: no scroll, the label says so.
  tap(hp, 29);
  assert.deepEqual(active(hp), [false, false, true]);
  assert.equal(labelOf(key).textContent, 'ответ #4 · Maren · HP 40 (не загружено)');
  assert.equal(scrolls.length, 1);
  tap(hp, 25);
  assert.equal(labelOf(key), null, 'a second tap on the same bar hides the label');
  assert.deepEqual(active(hp), [false, false, false]);
  // Bonds: signed title and value.
  const trust = spark('bonds:maren:trust');
  tap(trust, 15);
  assert.equal(labelOf('bonds:maren:trust').textContent, 'ответ #2 · Доверие −20');
  assert.equal(document.querySelectorAll('.st-sable-spark-label').length, 1);
});

test('drawer: the pick survives a re-render and a new point; ←/→ move it, Enter jumps; effects off scroll without motion', t => {
  const { document, runtime, spark, labelOf, key, scrolls } = drawerSetup(t, { language: 'en' });
  const id = 'combat_stats:Maren · HP', hp = spark(id);
  key(hp, 'ArrowLeft');
  assert.deepEqual(active(hp), [false, false, true], 'the first arrow picks the newest bar');
  assert.equal(labelOf(id).textContent, 'reply #4 · Maren · HP 40 (not loaded)');
  key(hp, 'ArrowLeft');
  assert.deepEqual(active(hp), [false, true, false]);
  assert.equal(scrolls.length, 0, 'arrows only move the pick');
  runtime.snapshot().store.history.combat_stats['Maren · HP'].push({ mesId: 6, value: 35 });
  runtime.publish();
  assert.equal(spark(id), hp);
  assert.deepEqual(active(hp), [false, true, false, false], 'kept by message id');
  assert.equal(labelOf(id).textContent, 'reply #2 · Maren · HP 70');
  key(hp, 'ArrowRight'); key(hp, 'ArrowRight'); key(hp, 'ArrowRight');
  assert.deepEqual(active(hp), [false, false, false, true], 'clamped at the end');
  key(hp, 'ArrowLeft'); key(hp, 'ArrowLeft');
  runtime.updateSettings({ visual: { ...runtime.snapshot().settings.visual, effects: 'off' } });
  key(hp, 'Enter');
  assert.deepEqual(scrolls, [{ block: 'center', behavior: 'auto' }]);
  // A pruned point takes the pick with it.
  runtime.snapshot().store.history.combat_stats['Maren · HP'].splice(1, 1);
  runtime.publish();
  assert.equal(labelOf(id), null);
  assert.ok(!document.querySelector('.st-sable-spark-active'));
  runtime.updateSettings({ visual: { ...runtime.snapshot().settings.visual, sparklines: false } });
  assert.equal(spark(id), null);
});

test('reply panel and digest ignore history', t => {
  const { document, fake, runtime, ui } = drawerSetup(t, { language: 'en' });
  const mes = document.querySelector('.mes'); mes.setAttribute('mesid', '6'); mes.setAttribute('is_user', 'false');
  mes.innerHTML = '<div class="mes_text">x</div>';
  const panel = createPanel(runtime, ui, { document, getContext: fake.getContext });
  t.after(() => panel.dispose());
  const before = document.querySelector('.st-sable-panel')?.outerHTML, prompt = fake.calls.prompts.at(-1);
  assert.ok(before && prompt);
  fake.ctx.chatMetadata.sableTrackers.history = {};
  runtime.publish();
  assert.equal(document.querySelector('.st-sable-panel').outerHTML, before);
  assert.equal(document.querySelector('.st-sable-panel .st-sable-spark'), null);
  assert.deepEqual(fake.calls.prompts.at(-1), prompt, 'the injected digest does not change');
  const sections = getSections(runtime.snapshot().settings, ['combat']);
  const digest = buildDigest(state, Object.fromEntries(sections.map(s => [s.id, 'inject'])), { sections, language: 'en' });
  assert.match(digest, /Maren · HP 40/);
  assert.doesNotMatch(digest, /\b70\b/, 'no history values');
});

test('settings: the sparkline checkbox is renamed and its hint names bonds and pack stats', t => {
  for (const [language, text, hint] of [['ru', 'Мини-графики под полосками', /шкалами отношений и статами паков/],
    ['en', 'History sparklines under bars', /bond scales and pack stats/]]) {
    const dom = new JSDOM('<body><div id="extensions_settings"></div></body>', { pretendToBeVisual: true });
    const fake = createFakeST(); fake.ctx.extensionSettings.sableTrackers.language = language;
    const runtime = createRuntime(fake.getContext); runtime.start();
    const ui = createSettings(runtime, { document: dom.window.document, getContext: fake.getContext });
    t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
    const box = ui.element.querySelector('input[name="sparklines"]');
    assert.equal(box.parentElement.textContent, text);
    assert.match(box.parentElement.title, hint);
    assert.match(ui.element.querySelector('[data-hint="sparklines"]').textContent, hint);
  }
});

test('CSS: the sparkline button has a 36 px hit area; the T24 block sits at the end', async () => {
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /\.st-sable-spark\[role="button"\] \{[^}]*height: 36px; padding: 10px 0;/);
  assert.match(css, /\.st-sable-spark > span\.st-sable-spark-active \{/);
  assert.match(css, /\.st-sable-spark-label \{[^}]*grid-column: 2 \/ -1;/);
  assert.ok(css.indexOf('/* T24 */') > css.indexOf('/* Full: every rule below'));
});
