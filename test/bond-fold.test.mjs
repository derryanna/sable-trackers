import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { normalizeSettings } from '../src/settings.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
// Maren is here and her trust moved; Tomas is away; Stranger has no NPC row.
function bonds() {
  const state = structuredClone(fixture);
  state.bonds.push({ id: 'tomas', name: 'Tomas', toward: '{{user}}', stats: { trust: 40 }, changes: { trust: { delta: -5, reason: 'lied' } } },
    { id: 'stranger', name: 'Stranger', toward: 'Maren', stats: { fear: 20 } });
  return state;
}
function setup(t, settings = {}, state = bonds()) {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, settings);
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document }); ui.open();
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const group = id => ui.element.querySelector(`.st-sable-card[data-section="bonds"] .st-sable-bond[data-key="bonds:${id}"]`);
  const rows = id => [...group(id).querySelectorAll(':scope > details')];
  const fold = id => group(id).querySelector('[data-control="bond-fold"]');
  const dot = id => group(id).querySelector('.st-sable-bond-name > .st-sable-change-dot');
  return { runtime, ui, group, rows, fold, dot };
}

test('bond fold keys are kept by normalizeSettings', () => {
  assert.deepEqual(normalizeSettings({ folded: { 'bond:maren': true, 'bond:': true, 'bond:x': 'yes' } }).folded, { 'bond:maren': true });
});

test('present and unknown characters start open, an away NPC starts folded', t => {
  const { group, rows, fold, dot } = setup(t);
  assert.equal(group('maren').dataset.folded, '0');
  assert.ok(rows('maren').length > 1 && rows('maren').every(row => !row.hidden));
  assert.equal(fold('maren').getAttribute('aria-expanded'), 'true');
  assert.equal(fold('maren').getAttribute('aria-label'), 'Свернуть / развернуть персонажа');
  assert.equal(group('stranger').dataset.folded, '0');
  assert.equal(group('tomas').dataset.folded, '1');
  assert.ok(rows('tomas').every(row => row.hidden));
  assert.equal(fold('tomas').getAttribute('aria-expanded'), 'false');
  // The folded group keeps a dot for the change it hides; an open group needs none.
  assert.equal(dot('tomas').hidden, false);
  assert.equal(dot('maren').hidden, true);
});

test('tapping the name line or the chevron folds and unfolds, saved per character', t => {
  const { runtime, group, rows, fold } = setup(t);
  group('maren').querySelector('.st-sable-name').click();
  assert.equal(runtime.snapshot().settings.folded['bond:maren'], true);
  assert.equal(group('maren').dataset.folded, '1');
  assert.ok(rows('maren').every(row => row.hidden));
  fold('maren').click();
  assert.equal(runtime.snapshot().settings.folded['bond:maren'], false);
  assert.ok(rows('maren').every(row => !row.hidden));
  fold('tomas').click();
  assert.equal(runtime.snapshot().settings.folded['bond:tomas'], false);
  assert.ok(rows('tomas').every(row => !row.hidden));
  assert.equal(group('stranger').dataset.folded, '0');
});

test('person cards keep their own fold and get no bond toggle', t => {
  const { ui } = setup(t, { layout: 'people' });
  const bond = ui.element.querySelector('[data-person] .st-sable-bond');
  assert.ok(bond);
  assert.equal(bond.querySelector('[data-control="bond-fold"]'), null);
  assert.ok([...bond.querySelectorAll(':scope > details')].every(row => !row.hidden));
});
