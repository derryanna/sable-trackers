import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeST, deferred } from './fakes/st.mjs';
import { createRuntime } from '../src/run.js';
import { loadSettings, saveSettings, effectiveModes } from '../src/settings.js';
import { loadStore, saveStore, putEntry, currentEntry, pruneEntries } from '../src/store.js';
import { SECTION_ORDER } from '../src/sections.js';

function setup(t) {
  const fake = createFakeST();
  const runtime = createRuntime(fake.getContext);
  runtime.start();
  t.after(() => runtime.dispose());
  return { ...fake, runtime };
}
const data = fake => fake.ctx.chatMetadata.sableTrackers;
const injection = fake => fake.calls.prompts.at(-1)[1];
const answer = location => `<sable_state>${JSON.stringify({ world: { location } })}</sable_state>`;

test('settings fill defaults, preserve other extensions, normalize and resolve overrides', () => {
  const { ctx } = createFakeST();
  const other = ctx.extensionSettings.otherExtension;
  const settings = loadSettings(ctx);
  assert.equal(settings.language, 'ru');
  assert.equal(settings.keep, 3);
  assert.equal(settings.sections.planner.period, 5);
  saveSettings(ctx, { messages: -1, keep: 'bad', order: ['world', 'world', 'invalid'], sections: { world: { mode: 'show' } } });
  const saved = loadSettings(ctx);
  assert.equal(saved.messages, 1);
  assert.equal(saved.keep, 3);
  assert.deepEqual(saved.order, SECTION_ORDER);
  assert.equal(saved.sections.world.period, 1);
  assert.equal(effectiveModes(saved, { modeOverride: { world: 'off' } }).world, 'off');
  assert.equal(ctx.extensionSettings.otherExtension, other);
});

test('store caps and clones entries, restores active swipe, prunes, and coalesces saves', async () => {
  const fake = createFakeST(), store = loadStore(fake.ctx);
  const state = { world: { location: 'Dome' } };
  fake.add(); fake.add();
  putEntry(store, { mesId: 0, swipeId: 0, turn: 1, state }, 3);
  putEntry(store, { mesId: 1, swipeId: 0, turn: 2, state }, 3);
  putEntry(store, { mesId: 1, swipeId: 1, turn: 2, state }, 3);
  state.world.location = 'Changed';
  assert.equal(currentEntry(store, fake.ctx.chat).swipeId, 0);
  assert.equal(currentEntry(store, fake.ctx.chat).state.world.location, 'Dome');
  fake.ctx.chat[1].swipe_id = 1;
  assert.equal(currentEntry(store, fake.ctx.chat).swipeId, 1);
  putEntry(store, { mesId: 1, swipeId: 2, turn: 2, state }, 3);
  assert.equal(store.ring.length, 3);
  pruneEntries(store, 1);
  assert.equal(store.ring.length, 0);
  await Promise.all([saveStore(fake.ctx), saveStore(fake.ctx)]);
  assert.equal(fake.calls.metadata.length, 1);
});

test('reply builds bounded cleaned request, stores parsed state and injects without message mutations', async t => {
  const fake = setup(t);
  fake.add('Old message', { is_user: true });
  fake.add('Hidden secret', { is_system: true });
  const id = fake.add('Visible <think>private</think><b>reply</b>', { extra: { untouched: true } });
  const original = structuredClone(fake.ctx.chat);
  await fake.emit('WORLD_INFO_ACTIVATED', [{ content: 'The dome is brass.', comment: 'Dome', key: ['dome'] }]);
  fake.respond({ content: answer('Dome') });
  await fake.emit('MESSAGE_RECEIVED', id, 'normal');
  const [profile, messages, maxTokens, custom] = fake.calls.requests[0];
  assert.equal(profile, 'side'); assert.equal(maxTokens, 3000);
  assert.deepEqual({ ...custom, signal: undefined }, { stream: false, extractData: true, includePreset: false, signal: undefined });
  assert.ok(custom.signal instanceof AbortSignal);
  assert.match(messages[0].content, /string values in Russian/);
  assert.match(messages[1].content, /The dome is brass/);
  assert.match(messages[1].content, /A curious visitor/);
  assert.doesNotMatch(messages[3].content, /Hidden secret|private|<b>/);
  assert.match(messages[3].content, /\[Guide\] Visible reply/);
  assert.deepEqual(fake.calls.substitutions, ['{{description}}\n{{personality}}\n{{scenario}}', '{{persona}}']);
  assert.equal(data(fake).ring[0].state.world.location, 'Dome');
  assert.equal(data(fake).ring[0].state.meta.forSwipeId, 0);
  assert.equal(data(fake).lastRun.ok, true);
  assert.ok(data(fake).lastRun.inTok > 0);
  assert.match(injection(fake), /Dome/);
  assert.deepEqual(fake.calls.prompts.at(-1).slice(2), [1, 2, false, 0]);
  assert.deepEqual(fake.ctx.chat, original);
  assert.equal(fake.calls.metadata.length, 1);
  await fake.emit('MESSAGE_RECEIVED', id, 'normal');
  assert.equal(fake.calls.requests.length, 1);
});

test('new swipe uses the state before the message; cached swipe restores without a request', async t => {
  const fake = setup(t);
  fake.respond(answer('Base')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  fake.respond(answer('Original')); const id = fake.add(); await fake.emit('MESSAGE_RECEIVED', id, 'normal');
  fake.ctx.chat[id].swipe_id = 1; fake.ctx.chat[id].mes = 'An alternative.';
  await fake.emit('MESSAGE_SWIPED', id);
  assert.match(injection(fake), /Base/);
  fake.respond(answer('Alternative')); await fake.emit('MESSAGE_RECEIVED', id, 'swipe');
  assert.match(fake.calls.requests.at(-1)[1][2].content, /Base/);
  assert.doesNotMatch(fake.calls.requests.at(-1)[1][2].content, /Original/);
  assert.equal(data(fake).ring.at(-1).turn, 2);
  fake.ctx.chat[id].swipe_id = 0; fake.ctx.chat[id].mes = 'The guide opens the dome.';
  await fake.emit('MESSAGE_SWIPED', id); await fake.emit('MESSAGE_RECEIVED', id, 'swipe');
  assert.equal(fake.calls.requests.length, 3);
  assert.match(injection(fake), /Original/);
  assert.equal(data(fake).turnsSince.planner, 2);
});

test('delete prunes ring and injection; edit marks stale without rerunning; refresh replaces state', async t => {
  const fake = setup(t);
  const id = fake.add(); await fake.emit('MESSAGE_RECEIVED', id, 'normal');
  fake.ctx.chat[id].mes = 'Edited'; await fake.emit('MESSAGE_EDITED', id);
  assert.equal(data(fake).ring[0].stale, true);
  assert.equal(fake.calls.requests.length, 1);
  fake.respond(answer('Refreshed')); await fake.runtime.refresh();
  assert.equal(data(fake).ring.length, 1);
  assert.equal(data(fake).ring[0].stale, undefined);
  assert.match(injection(fake), /Refreshed/);
  fake.ctx.chat.length = 0; await fake.emit('MESSAGE_DELETED', 0);
  assert.equal(data(fake).ring.length, 0);
  assert.equal(injection(fake), '');
});

test('eligible message types run; user/system, group, disabled and other types do not', async t => {
  const fake = setup(t);
  for (const type of ['normal', 'swipe', 'regenerate', 'continue']) {
    await fake.emit('MESSAGE_RECEIVED', fake.add(type), type);
  }
  assert.equal(fake.calls.requests.length, 4);
  for (const type of ['impersonate', 'first_message', 'command', 'extension']) await fake.emit('MESSAGE_RECEIVED', fake.add(type), type);
  await fake.emit('MESSAGE_RECEIVED', fake.add('User', { is_user: true }), 'normal');
  await fake.emit('MESSAGE_RECEIVED', fake.add('System', { is_system: true }), 'normal');
  fake.ctx.groupId = 'group'; await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  fake.ctx.groupId = null; fake.runtime.updateSettings({ enabled: false });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(fake.calls.requests.length, 4);
  assert.equal(injection(fake), '');
});

test('missing or unsupported profile produces one warning and no request without browser globals', async t => {
  const fake = setup(t), warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  fake.runtime.updateSettings({ profileId: '' });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(warnings.length, 1);
  fake.ctx.extensionSettings.connectionManager.profiles[0].mode = 'tc';
  fake.runtime.updateSettings({ profileId: 'side' });
  await fake.runtime.refresh(); await fake.runtime.refresh();
  assert.equal(warnings.length, 2);
  assert.equal(fake.calls.requests.length, 0);
});

test('newer reply aborts older request and ignores its late response', async t => {
  const fake = setup(t), first = deferred();
  fake.respond(() => first.promise);
  const old = fake.emit('MESSAGE_RECEIVED', fake.add('First'), 'normal');
  const signal = fake.calls.requests[0][3].signal;
  fake.respond(answer('Newest')); await fake.emit('MESSAGE_RECEIVED', fake.add('Second'), 'normal');
  assert.equal(signal.aborted, true);
  first.resolve(answer('Obsolete')); await old;
  assert.equal(data(fake).ring.length, 1);
  assert.match(injection(fake), /Newest/);
});

test('chat change cancels work, clears lore and injection, and reloads saved state', async t => {
  const fake = setup(t), pending = deferred();
  await fake.emit('WORLD_INFO_ACTIVATED', [{ content: 'Old chat lore' }]);
  fake.respond(() => pending.promise);
  const old = fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  const oldMetadata = fake.ctx.chatMetadata;
  fake.ctx.chatMetadata = {}; fake.ctx.chat = []; fake.ctx.chatId = 'chat-b';
  await fake.emit('CHAT_CHANGED', 'chat-b');
  pending.resolve(answer('Late')); await old;
  assert.equal(oldMetadata.sableTrackers.ring.length, 0);
  assert.equal(data(fake).ring.length, 0); assert.equal(injection(fake), '');
  fake.respond(answer('New chat')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.doesNotMatch(fake.calls.requests.at(-1)[1][1].content, /Old chat lore/);
  await fake.emit('CHAT_CHANGED', 'chat-b');
  assert.match(injection(fake), /New chat/);
});

test('invalid output and rejected requests retain state and report failure without throwing', async t => {
  const fake = setup(t);
  t.mock.method(console, 'warn', () => {});
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  fake.respond('garbage'); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(data(fake).ring.length, 1); assert.equal(data(fake).lastRun.ok, false);
  assert.match(injection(fake), /Observatory/);
  fake.respond(() => { throw new Error('offline'); }); await fake.runtime.refresh();
  assert.equal(data(fake).lastRun.ok, false); assert.equal(data(fake).ring.length, 1);
});

test('section modes, custom periods and output language control requests and injection', async t => {
  const fake = setup(t);
  fake.runtime.updateSettings({ language: 'en', sections: { planner: { period: 2 }, thoughts: { mode: 'off' } } });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.doesNotMatch(fake.calls.requests[0][1][0].content, /PLANNER:|THOUGHTS:/);
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.match(fake.calls.requests[1][1][0].content, /PLANNER:/);
  assert.match(fake.calls.requests[1][1][0].content, /string values in English/);
  assert.match(injection(fake), /WORLD: Observatory/);
  let updates = 0; const unsubscribe = fake.runtime.subscribe(() => updates++);
  fake.runtime.setMode('world', 'off', true);
  assert.doesNotMatch(injection(fake), /Observatory/);
  assert.equal(data(fake).modeOverride.world, 'off');
  assert.equal(fake.ctx.extensionSettings.sableTrackers.sections.world.mode, 'inject');
  assert.equal(updates, 1); unsubscribe();
  fake.runtime.updateSettings({ enabled: false }); assert.equal(injection(fake), '');
});

test('entry point initializes once using the global fake without jQuery or toastr', async t => {
  const fake = createFakeST(), restore = fake.install();
  t.after(restore);
  const entry = await import('../index.js');
  t.after(() => entry.runtime.dispose());
  assert.equal(entry.initialize(), entry.runtime);
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(fake.calls.requests.length, 1);
});

test('slow-only settings advance cadence without requests and reset only valid sections', async t => {
  const fake = setup(t);
  const sections = Object.fromEntries(SECTION_ORDER.map(id => [id, { mode: 'off' }]));
  sections.planner = { mode: 'inject', period: 2 };
  fake.runtime.updateSettings({ sections });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(fake.calls.requests.length, 0);
  assert.equal(data(fake).turnsSince.planner, 1);
  assert.equal(injection(fake), '');
  fake.respond('<sable_state>{"planner":{"beats":[],"remember":"Close the dome"}}</sable_state>');
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(fake.calls.requests.length, 1);
  assert.equal(data(fake).turnsSince.planner, 0);
  assert.match(injection(fake), /Close the dome/);
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(fake.calls.requests.length, 1);
  assert.equal(data(fake).ring.length, 3);
  assert.match(injection(fake), /Close the dome/);
});

test('duplicate in-flight events debounce while continue on changed text recomputes from base', async t => {
  const fake = setup(t), pending = deferred();
  fake.respond(answer('Base')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  fake.respond(() => pending.promise);
  const id = fake.add('Start'), first = fake.emit('MESSAGE_RECEIVED', id, 'normal');
  await fake.emit('MESSAGE_RECEIVED', id, 'normal');
  assert.equal(fake.calls.requests.length, 2);
  assert.equal(fake.calls.requests[1][3].signal.aborted, false);
  pending.resolve(answer('Start')); await first;
  fake.ctx.chat[id].mes += ' continued'; fake.respond(answer('Continued'));
  await fake.emit('MESSAGE_RECEIVED', id, 'continue');
  assert.equal(fake.calls.requests.length, 3);
  assert.match(fake.calls.requests[2][1][2].content, /Base/);
  assert.doesNotMatch(fake.calls.requests[2][1][2].content, /Start/);
  assert.equal(data(fake).ring.at(-1).turn, 2);
});

test('edit, deletion and disabling abort pending requests without committing late results', async t => {
  for (const action of ['edit', 'delete', 'disable']) {
    const fake = setup(t), pending = deferred();
    fake.respond(() => pending.promise);
    const id = fake.add(), running = fake.emit('MESSAGE_RECEIVED', id, 'normal');
    if (action === 'edit') { fake.ctx.chat[id].mes = 'Edited'; await fake.emit('MESSAGE_EDITED', id); }
    if (action === 'delete') { fake.ctx.chat.length = 0; await fake.emit('MESSAGE_DELETED', 0); }
    if (action === 'disable') fake.runtime.updateSettings({ enabled: false });
    assert.equal(fake.calls.requests[0][3].signal.aborted, true);
    pending.resolve(answer('Obsolete')); await running;
    assert.equal(data(fake).ring.length, 0);
    assert.equal(injection(fake), '');
  }
});

test('invalid section preserves previous data while valid sections merge and only their counters reset', async t => {
  const fake = setup(t);
  t.mock.method(console, 'warn', () => {});
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  fake.respond('<sable_state>{"world":false,"threads":[{"text":"Find the key","priority":"high"}]}</sable_state>');
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.equal(data(fake).ring.at(-1).state.world.location, 'Observatory');
  assert.equal(data(fake).turnsSince.world, 1);
  assert.equal(data(fake).turnsSince.threads, 0);
  assert.match(injection(fake), /Find the key/);
});

test('failed replies still advance slow-section cadence on the next successful request', async t => {
  const fake = setup(t);
  t.mock.method(console, 'warn', () => {});
  fake.runtime.updateSettings({ sections: { planner: { period: 3 } } });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  fake.respond('invalid'); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  fake.respond(answer('Recovered')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  assert.match(fake.calls.requests.at(-1)[1][0].content, /PLANNER:/);
  assert.equal(data(fake).ring.at(-1).turn, 3);
});
