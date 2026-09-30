import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createPanel } from '../src/ui/panel.js';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/legacy-message.json', import.meta.url), 'utf8'));

test('panel follows newest character, survives ST replacement, opens drawer and hides', async t => {
  const dom = new JSDOM('<body><div id="chat"></div></body>');
  const document = dom.window.document, fake = createFakeST();
  const runtime = createRuntime(fake.getContext); runtime.start();
  const drawer = createDrawer(runtime, { document });
  const panel = createPanel(runtime, drawer, { document, getContext: fake.getContext });
  t.after(() => { panel.dispose(); drawer.dispose(); runtime.dispose(); dom.window.close(); });
  function add(user = false) {
    const id = fake.add('Untouched', { is_user: user });
    const mes = document.createElement('div'); mes.className = 'mes';
    mes.setAttribute('mesid', id); mes.setAttribute('is_user', String(user));
    mes.innerHTML = '<div class="mes_text">Untouched</div>';
    document.querySelector('#chat').append(mes); return mes;
  }
  add(); const newest = add(); add(true);
  const state = { world: { location: '{{user}} <img src=x>' }, npcs: [{ id: 'guide', name: 'Guide', present: true, mood: 'wary' }], bonds: [{ id: 'guide', changes: { trust: { delta: 5 } } }] };
  runtime.snapshot().store.ring.push({ mesId: 1, swipeId: 0, state });
  const before = structuredClone(fake.ctx.chat);
  runtime.publish();
  const query = () => document.querySelector('.st-sable-panel');
  assert.equal(query().previousElementSibling, newest.querySelector('.mes_text'));
  assert.match(query().textContent, /Player <img src=x>/);
  assert.match(query().textContent, /Guide.*wary/);
  assert.match(query().textContent, /\+5/);
  assert.equal(query().querySelector('img'), null);
  query().click(); assert.equal(drawer.element.hidden, false);
  for (const event of ['MESSAGE_EDITED', 'MESSAGE_SWIPED', 'CHARACTER_MESSAGE_RENDERED']) {
    newest.innerHTML = '<div class="mes_text">Untouched</div>';
    await fake.emit(event, 1);
    assert.equal(query().previousElementSibling, newest.querySelector('.mes_text'));
  }
  assert.deepEqual(fake.ctx.chat, before);
  const next = add(); await fake.emit('CHARACTER_MESSAGE_RENDERED', 3);
  assert.equal(query().parentElement, next);
  assert.equal(document.querySelectorAll('.st-sable-panel').length, 1);
  assert.equal(query().querySelector('.st-sable-panel-badge'), null);
  runtime.updateSettings({ showPanel: false }); assert.equal(query(), null);
  runtime.updateSettings({ showPanel: true }); assert.ok(query());
  fake.ctx.chatMetadata = {}; await fake.emit('CHAT_CHANGED'); assert.equal(query(), null);
});

test('drawer import is visible only with legacy and empty ring; opening never seeds', async t => {
  const dom = new JSDOM('<body></body>'), fake = createFakeST();
  fake.ctx.chat.push(structuredClone(fixture));
  const runtime = createRuntime(fake.getContext); runtime.start();
  const drawer = createDrawer(runtime, { document: dom.window.document });
  t.after(() => { drawer.dispose(); runtime.dispose(); dom.window.close(); });
  const button = drawer.element.querySelector('.st-sable-legacy-button');
  assert.equal(button.hidden, false);
  drawer.open(); assert.equal(runtime.snapshot().store.ring.length, 0);
  button.click(); await Promise.resolve();
  assert.equal(runtime.snapshot().store.ring.length, 1);
  assert.equal(button.hidden, true);
  fake.ctx.chat = []; fake.ctx.chatMetadata = {}; await fake.emit('CHAT_CHANGED');
  assert.equal(button.hidden, true);
});
