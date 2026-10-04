import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));

function setup(t, { settings = {}, state = structuredClone(fixture) } = {}) {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, settings);
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document }); ui.open();
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const query = selector => ui.element.querySelector(selector);
  const card = id => query(`.st-sable-card[data-section="${id}"]`);
  const control = (element, name) => element.querySelector(`[data-control="${name}"]`);
  const menuItem = text => [...ui.element.querySelectorAll('.st-sable-mode-menu [role="menuitem"]')].find(item => item.textContent === text);
  const person = id => [...ui.element.querySelectorAll('[data-person]')].find(item => item.dataset.person === id);
  const current = () => runtime.snapshot().entry?.state;
  // Another chat: SillyTavern swaps the metadata object and the chat id before CHAT_CHANGED.
  const switchTo = async (chatId, location) => {
    const other = structuredClone(fixture); other.world.location = location;
    fake.ctx.chatId = chatId;
    fake.ctx.chatMetadata = { sableTrackers: { ring: [{ mesId: 0, swipeId: 0, turn: 1, state: other }] } };
    await fake.emit('CHAT_CHANGED');
  };
  return { dom, document, fake, runtime, ui, query, card, control, menuItem, person, current, switchTo };
}

test('a section editor opened in one chat is closed by a chat switch and its Save never writes into the next chat', async t => {
  const { card, control, current, switchTo, fake, query } = setup(t);
  control(card('world'), 'edit').click();
  const editor = query('[data-editor="world"]');
  assert.ok(editor, 'the world editor is open');
  for (const input of editor.querySelectorAll('input, textarea')) input.value = 'A-draft';
  const save = editor.querySelector('.st-sable-editor-save');
  await switchTo('chat-b', 'B-place');
  assert.equal(query('[data-editor="world"]'), null, 'the editor is gone');
  assert.equal(current().world.location, 'B-place');
  const before = JSON.stringify(current());
  save.click();
  assert.equal(JSON.stringify(current()), before, 'the old draft did not land in chat B');
  assert.equal(fake.ctx.chatMetadata.sableTrackers.ring.at(-1).state.world.location, 'B-place');
  assert.doesNotMatch(JSON.stringify(fake.ctx.chatMetadata), /A-draft/);
});

test('the undo pill of a deleted person is hidden by a chat switch and cannot restore into the next chat', async t => {
  const { person, control, menuItem, query, switchTo, current } = setup(t, { settings: { layout: 'people' } });
  control(person('maren'), 'person-menu').click(); menuItem('Удалить').click();
  const pill = query('.st-sable-undo'), restore = query('[data-control="undo"]');
  assert.equal(pill.hidden, false);
  assert.equal(person('maren'), undefined);
  await switchTo('chat-b', 'B-place');
  assert.equal(pill.hidden, true, 'the pill is hidden by the switch');
  const before = JSON.stringify(current());
  restore.click();
  assert.equal(JSON.stringify(current()), before, 'chat B is untouched');
});

test('the topic editor keeps a negative signed score on Save', t => {
  const state = structuredClone(fixture);
  state.bonds[0].stats.trust = -40;
  const { card, control, query, current } = setup(t, { settings: { bondScales: { off: [], signed: ['trust'], custom: [] } }, state });
  control(card('bonds'), 'edit').click();
  const editor = query('[data-editor="bonds"]');
  assert.ok(editor, 'the bonds editor is open');
  const trust = [...editor.querySelectorAll('input[type="number"]')].find(input => input.value === '-40');
  assert.ok(trust, 'the negative value is shown');
  assert.equal(trust.min, '-100');
  editor.querySelector('.st-sable-editor-save').click();
  assert.equal(current().bonds[0].stats.trust, -40, 'Save without a change keeps the value');
});
