import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { SECTIONS, getSections } from '../src/sections.js';
import { normalizeSettings, loadSettings } from '../src/settings.js';
import { buildPrompt } from '../src/prompt.js';
import { parseStateOutput } from '../src/parse.js';
import { mergeState } from '../src/merge.js';
import { buildDigest } from '../src/digest.js';
import { createRuntime } from '../src/run.js';
import { createDrawer } from '../src/ui/drawer.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/custom-sections.json', import.meta.url), 'utf8'));
const [clues, clock] = fixture.customSections.map(item => item.id);
const settings = normalizeSettings(fixture);
const sections = getSections(settings);
const textId = 'c_00000001';

test('custom settings normalize safely, retain stable unique ids, order, folds and unknown keys', () => {
  const value = normalizeSettings({ visual: { opacity: 0.8 }, future: true,
    customSections: [...fixture.customSections, { title: ' Text ', instructions: ' Track ', icon: ' X ', max: 99, mode: 'bad', shape: 'bad', period: -1 },
      { id: clues, max: 0, period: 0 }, null], order: [clock, 'removed', 'world'], folded: { [clues]: true } });
  assert.equal(value.customSections.length, 4);
  assert.equal(new Set(value.customSections.map(s => s.id)).size, 4);
  for (const item of value.customSections) assert.match(item.id, /^c_[0-9a-f]{8}$/);
  assert.deepEqual(value.customSections[2], { id: value.customSections[2].id, title: 'Text', instructions: 'Track', icon: 'X', max: 20, mode: 'inject', shape: 'text', period: 1 });
  assert.equal(value.customSections[3].max, 1);
  assert.equal(value.customSections[3].period, 0);
  assert.equal(value.order[0], clock);
  assert.equal(value.order.includes('removed'), false);
  assert.ok(value.order.indexOf(clues) > value.order.indexOf('banlist'));
  assert.equal(value.folded[clues], true);
  // visual is normalized by the §12 side: the given key survives, the others are filled from defaults.
  assert.equal(value.visual.opacity, 0.8);
  assert.equal(value.visual.icons, 'fa');
  assert.equal(value.future, true);
  assert.deepEqual(normalizeSettings(value), value);
  const fake = createFakeST(); fake.ctx.extensionSettings.sableTrackers = { customSections: [{}] };
  assert.equal(loadSettings(fake.ctx).customSections[0].id, loadSettings(fake.ctx).customSections[0].id);
});

test('prompt includes custom instructions/schema only when enabled and due; removed data is omitted', () => {
  const first = buildPrompt({ settings, sections, previousState: fixture.state });
  assert.ok(first.requestedSections.includes(clues));
  assert.ok(!first.requestedSections.includes(clock));
  assert.ok(first.messages[0].content.includes(fixture.customSections[0].instructions));
  const due = buildPrompt({ settings, sections, turnsSince: { [clock]: 2 } });
  assert.ok(due.requestedSections.includes(clock));
  const off = buildPrompt({ sections, modes: { [clues]: 'off' }, previousState: fixture.state });
  assert.ok(!JSON.stringify(off).includes(clues));
  const removed = buildPrompt({ sections: getSections({}), previousState: fixture.state });
  assert.ok(!JSON.stringify(removed).includes(clues));
  assert.ok(!JSON.stringify(removed).includes(clock));
});

test('all custom shapes validate caps, trim strings and reject invalid sections; merge fully replaces', () => {
  const registry = getSections({ customSections: [...fixture.customSections, { id: textId, shape: 'text' }] });
  const raw = { [clues]: [' a ', 'x'.repeat(250), 42, 'excess'],
    [clock]: [{ key: 'k'.repeat(80), value: 'v'.repeat(250), extra: true }, { key: 'missing value' }],
    [textId]: ' ' + 't'.repeat(700), unknown: 'ignored' };
  const parsed = parseStateOutput(JSON.stringify(raw), undefined, registry);
  assert.deepEqual(parsed.sections[clues], ['a', 'x'.repeat(200)]);
  assert.deepEqual(parsed.sections[clock], [{ key: 'k'.repeat(60), value: 'v'.repeat(200) }]);
  assert.equal(parsed.sections[textId].length, 600);
  assert.equal(parsed.sections.unknown, undefined);
  const invalid = parseStateOutput(JSON.stringify({ [clues]: 'bad', [clock]: {}, [textId]: [] }), undefined, registry);
  assert.equal(invalid.warnings.length, 3);
  assert.deepEqual(mergeState(fixture.state, invalid, { sections: registry }), fixture.state);
  const merged = mergeState(fixture.state, parsed, { sections: registry, requestedSections: [clues] });
  assert.deepEqual(merged[clues], parsed.sections[clues]);
  assert.deepEqual(merged[clock], fixture.state[clock]);
  const empty = parseStateOutput(JSON.stringify({ [clues]: [] }), [clues], registry);
  assert.deepEqual(mergeState(fixture.state, empty, { sections: registry })[clues], []);
  assert.deepEqual(fixture.state[clues], ['След у двери', 'Пустой конверт']);
});

test('digest formats custom shapes, uses their titles and modes, and appends omitted ids', () => {
  const registry = getSections({ customSections: [...fixture.customSections, { id: textId, title: 'Note', shape: 'text' }] });
  const digest = buildDigest({ ...fixture.state, [textId]: 'One line' }, {}, { sections: registry, order: [clock] });
  assert.ok(digest.includes('УЛИКИ: След у двери | Пустой конверт'));
  assert.ok(digest.includes('ЧАСЫ: До рассвета: Два часа'));
  assert.ok(digest.includes('NOTE: One line'));
  assert.ok(buildDigest({ [clock]: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }] }, {}, { sections }).includes('ЧАСЫ: A: 1 · B: 2'));
  assert.doesNotThrow(() => buildDigest({ [clues]: 'old text shape' }, {}, { sections }));
  assert.ok(digest.indexOf('ЧАСЫ:') < digest.indexOf('УЛИКИ:'));
  assert.ok(!buildDigest(fixture.state, { [clues]: 'show' }, { sections }).includes('УЛИКИ:'));
  assert.ok(!buildDigest(fixture.state).includes('УЛИКИ:'));
});

test('runtime tracks custom cadence, global modes and chat overrides', async () => {
  const fake = createFakeST();
  fake.ctx.extensionSettings.sableTrackers = { ...settings, profileId: 'side', sections: Object.fromEntries(SECTIONS.map(s => [s.id, { mode: 'off' }])) };
  fake.respond(JSON.stringify(fixture.state));
  const runtime = createRuntime(fake.getContext);
  await runtime.run(fake.add());
  assert.deepEqual(runtime.snapshot().entry.state[clues], fixture.state[clues]);
  assert.equal(runtime.snapshot().entry.state[clock], undefined);
  assert.equal(runtime.snapshot().entry.turnsSince[clock], 1);
  await runtime.run(fake.add());
  assert.deepEqual(runtime.snapshot().entry.state[clock], fixture.state[clock]);
  assert.equal(runtime.snapshot().entry.turnsSince[clock], 0);
  runtime.setMode(clues, 'show');
  assert.equal(runtime.snapshot().settings.customSections[0].mode, 'show');
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('УЛИКИ:'));
  runtime.setMode(clues, 'off', true);
  assert.equal(runtime.snapshot().modes[clues], 'off');
  runtime.setMode(clues, null, true);
  assert.equal(runtime.snapshot().modes[clues], 'show');
  runtime.dispose();
});

test('drawer safely renders shapes and icons, cycles/folds/reorders, and removes deleted cards', t => {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div></body>');
  const fake = createFakeST(); fake.add();
  const xss = '<img src=x onerror=alert(1)>';
  const customSections = [...fixture.customSections, { id: textId, title: xss, shape: 'text', mode: 'inject' }];
  fake.ctx.extensionSettings.sableTrackers = { customSections };
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 1, state: { ...fixture.state, [textId]: xss } }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document: dom.window.document });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const card = id => ui.element.querySelector('[data-section="' + id + '"]');
  assert.equal(card(clues).querySelectorAll('li').length, 2);
  assert.equal(card(clues).querySelector('.st-sable-glyph').textContent, '•');
  assert.equal(card(clues).querySelector('.st-sable-card-icon').textContent, '🔍');
  assert.ok(card(clock).querySelector('.fa-clock'));
  assert.equal(card(clock).querySelector('dt').textContent, 'До рассвета');
  assert.equal(card(textId).querySelector('p').textContent, xss);
  assert.equal(ui.element.querySelector('img'), null);
  card(clues).querySelector('.st-sable-fold').click();
  assert.equal(card(clues).querySelector('.st-sable-card-body').hidden, true);
  card(clues).querySelector('.st-sable-mode').click();
  assert.equal(runtime.snapshot().modes[clues], 'show');
  card(clues).querySelector('.st-sable-mode').click();
  assert.equal(runtime.snapshot().modes[clues], 'off');
  card(clues).querySelector('.st-sable-mode').click();
  assert.equal(runtime.snapshot().modes[clues], 'inject');
  card(clues).querySelector('.st-sable-handle').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  assert.ok(runtime.snapshot().settings.order.indexOf(clues) < runtime.snapshot().settings.order.indexOf('banlist'));
  runtime.updateSettings({ customSections: customSections.filter(item => item.id !== clues) });
  assert.equal(card(clues), null);
  assert.deepEqual(runtime.snapshot().entry.state[clues], fixture.state[clues]);
  const view = runtime.snapshot();
  assert.ok(!JSON.stringify(buildPrompt({ settings: view.settings, sections: getSections(view.settings), previousState: view.entry.state })).includes(clues));
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('УЛИКИ:'));
});
