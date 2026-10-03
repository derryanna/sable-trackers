import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createFakeST } from './fakes/st.mjs';
import { createRuntime, MAX_INJECT_LAG } from '../src/run.js';
import { lagOf } from '../src/store.js';
import { buildDigest } from '../src/digest.js';
import { createDrawer } from '../src/ui/drawer.js';
import { createPanel } from '../src/ui/panel.js';

// SPEC §32: which entry is injected during swipes / regenerations, and how far behind it may be.
function setup(t) {
  const fake = createFakeST();
  const runtime = createRuntime(fake.getContext);
  runtime.start();
  t.after(() => runtime.dispose());
  return { ...fake, runtime };
}
const injection = fake => fake.calls.prompts.at(-1)[1];
const state = location => ({ world: { location }, meta: { turn: 1 } });
// A chat of alternating user / character messages; `states` maps character message ids to a stored location.
function chat(fake, replies, states = {}) {
  for (let i = 0; i < replies; i++) { fake.add('Ask', { is_user: true }); fake.add(`Reply ${i}`); }
  for (const [mesId, location] of Object.entries(states)) fake.runtime.snapshot().store.ring.push({ mesId: Number(mesId), swipeId: 0, turn: 1, state: state(location) });
  fake.runtime.publish();
}

test('lagOf counts character replies after the entry, up to an optional end', () => {
  const messages = [{ is_user: true }, {}, { is_user: true }, {}, { is_system: true }, { is_user: true }, {}];
  assert.equal(lagOf(undefined, messages), 0);
  assert.equal(lagOf({ mesId: 6 }, messages), 0);
  assert.equal(lagOf({ mesId: 3 }, messages), 1);
  assert.equal(lagOf({ mesId: 1 }, messages), 2);
  // The swipe override measures against the message before the rewritten one (id 6 here).
  assert.equal(lagOf({ mesId: 3 }, messages, 6), 0);
  assert.equal(lagOf({ mesId: 1 }, messages, 6), 1);
  assert.equal(MAX_INJECT_LAG, 1);
});

test('the digest gets the lag note only for a lag of one', () => {
  const modes = { world: 'inject' };
  const plain = buildDigest(state('Pier'), modes, { language: 'en' });
  assert.equal(buildDigest(state('Pier'), modes, { language: 'en', lag: 0, asOf: 3 }), plain);
  assert.equal(buildDigest(state('Pier'), modes, { language: 'en', lag: 1, asOf: 3 }),
    `Scene state as of reply #3 (one reply behind the chat; newer messages take precedence)\n${plain}`);
  assert.match(buildDigest(state('Pier'), modes, { lag: 1, asOf: 3 }), /^Состояние сцены на момент ответа #3 \(на 1 ответ позже событий в чате; новые сообщения главнее\)\n/);
});

test('a swipe, regenerate or continue injects the state from before the rewritten reply', async t => {
  const fake = setup(t), { runtime } = fake;
  chat(fake, 2, { 1: 'Before', 3: 'Latest' });
  assert.match(injection(fake), /Latest/);
  for (const type of ['swipe', 'regenerate', 'continue']) {
    await fake.emit('GENERATION_STARTED', type, {}, false);
    assert.match(injection(fake), /Before/, type);
    assert.doesNotMatch(injection(fake), /Latest|на момент ответа/, type);
    assert.equal(runtime.snapshot().injectedEntry.mesId, 1);
    assert.equal(runtime.snapshot().lag, 0);
    await fake.emit('GENERATION_STARTED', 'normal', {}, false);
    assert.match(injection(fake), /Latest/, type);
  }
  // The dry run (prompt preview) follows the same rule.
  await fake.emit('GENERATION_STARTED', 'swipe', {}, true);
  assert.match(runtime.preview().injection, /Before/);
  await fake.emit('GENERATION_STARTED', 'quiet', {}, true);
  assert.match(runtime.preview().injection, /Latest/);
});

test('message and chat events clear the override', async t => {
  for (const [event, args] of [['MESSAGE_RECEIVED', [3, 'swipe']], ['MESSAGE_SWIPED', [3]], ['MESSAGE_DELETED', [4]], ['CHAT_CHANGED', []]]) {
    const fake = setup(t), { runtime } = fake;
    chat(fake, 2, { 1: 'Before', 3: 'Latest' });
    // MESSAGE_RECEIVED recomputes the reply; the side model keeps its location.
    fake.respond('<sable_state>{"world":{"location":"Latest"}}</sable_state>');
    await fake.emit('GENERATION_STARTED', 'swipe', {}, false);
    assert.match(injection(fake), /Before/);
    await fake.emit(event, ...args);
    await runtime.idle();
    assert.match(injection(fake), /Latest/, event);
    assert.equal(runtime.snapshot().injectedEntry.mesId, 3, event);
  }
});

test('lag 1 is injected with the note, lag 2 injects nothing and says so', async t => {
  const fake = setup(t), { runtime } = fake;
  chat(fake, 2, { 1: 'Old pier' });
  assert.equal(runtime.snapshot().lag, 1);
  assert.match(injection(fake), /^Состояние сцены на момент ответа #1 \(на 1 ответ позже событий в чате; новые сообщения главнее\)\n\[/);
  assert.match(injection(fake), /Old pier/);
  // A swipe of the latest reply measures against the message before it: lag 0, no note.
  await fake.emit('GENERATION_STARTED', 'swipe', {}, false);
  assert.equal(runtime.snapshot().lag, 0);
  assert.doesNotMatch(injection(fake), /на момент ответа/);
  await fake.emit('GENERATION_STARTED', 'normal', {}, false);

  const dom = new JSDOM('<body><div id="chat"></div></body>'), document = dom.window.document;
  const drawer = createDrawer(runtime, { document });
  const panel = createPanel(runtime, drawer, { document, getContext: fake.getContext });
  t.after(() => { panel.dispose(); drawer.dispose(); dom.window.close(); });
  const mesId = fake.add('Ask', { is_user: true }) + 1; fake.add('Reply 2');
  const mes = document.createElement('div'); mes.className = 'mes';
  mes.setAttribute('mesid', mesId); mes.setAttribute('is_user', 'false');
  mes.innerHTML = '<div class="mes_text">Reply 2</div>';
  document.querySelector('#chat').append(mes);
  runtime.publish();
  assert.equal(runtime.snapshot().lag, 2);
  assert.equal(runtime.snapshot().injectedEntry.mesId, 1);
  assert.equal(injection(fake), '');
  assert.equal(runtime.preview().injection, '');
  const status = document.querySelector('.st-sable-status-lag');
  assert.match(status.textContent, /Состояние отстаёт на 2 ответов/);
  assert.ok(status.querySelector('[data-control="lag-recompute"]'));
  const note = document.querySelector('.st-sable-drawer > .st-sable-lag');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Состояние отстаёт на 2 ответов');
  assert.equal(document.querySelector('.st-sable-panel > .st-sable-lag').textContent, 'Состояние отстаёт на 2 ответов');
  // The cards keep showing the old state.
  assert.match(document.querySelector('.st-sable-card[data-section="world"]').textContent, /Old pier/);
  runtime.updateSettings({ language: 'en' });
  assert.match(document.querySelector('.st-sable-status-lag').textContent, /State is 2 replies behind/);
  // A fresh state for the latest reply ends the lag.
  runtime.snapshot().store.ring.push({ mesId, swipeId: 0, turn: 3, state: state('New pier') });
  runtime.publish();
  assert.equal(runtime.snapshot().lag, 0);
  assert.match(injection(fake), /New pier/);
  assert.equal(document.querySelector('.st-sable-status-lag'), null);
  assert.equal(document.querySelector('.st-sable-drawer > .st-sable-lag').hidden, true);
  assert.equal(document.querySelector('.st-sable-panel > .st-sable-lag'), null);
});
