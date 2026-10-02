import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeST, deferred } from './fakes/st.mjs';
import { createRuntime } from '../src/run.js';
import { loadSettings, saveSettings, effectiveModes, normalizeSettings } from '../src/settings.js';
import { COMMON_RULES } from '../src/prompt.js';
import { SECTIONS } from '../src/sections.js';
import { SWIPES_PER_MESSAGE, loadStore, saveStore, putEntry, findEntry, currentEntry, pruneEntries } from '../src/store.js';
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

test('prompt settings trim, clamp, drop defaults and merge partial overrides idempotently', () => {
  const value = normalizeSettings({ prompts: { rules: ' x '.repeat(2000), sections: {
    world: ' y '.repeat(1000), threads: '  ', offscreen: SECTIONS.find(s => s.id === 'offscreen').instructions,
    unknown: 'ignore', npcs: ' Keep names ',
  } } });
  assert.ok(value.prompts.rules.length <= 4000); assert.ok(value.prompts.sections.world.length <= 2000);
  assert.equal(value.prompts.sections.npcs, 'Keep names');
  assert.deepEqual(Object.keys(value.prompts.sections), ['world', 'npcs']);
  assert.equal(JSON.stringify(normalizeSettings(value)), JSON.stringify(value));
  assert.deepEqual(normalizeSettings({ prompts: { rules: ` ${COMMON_RULES} ` } }).prompts, { rules: null, sections: {}, packs: {} });
  assert.equal(normalizeSettings({ prompts: { rules: '  ' } }).prompts.rules, null);
  const { ctx } = createFakeST();
  saveSettings(ctx, { prompts: { rules: 'Rules', sections: { world: 'World' } } });
  saveSettings(ctx, { prompts: { sections: { threads: 'Threads' } } });
  assert.deepEqual(loadSettings(ctx).prompts, { rules: 'Rules', sections: { world: 'World', threads: 'Threads' }, packs: {} });
  saveSettings(ctx, { prompts: { sections: { world: null } } });
  assert.deepEqual(loadSettings(ctx).prompts.sections, { threads: 'Threads' });
});

test('preview matches refresh exactly without requests, metadata writes or publishes', async t => {
  const fake = setup(t); const { runtime, calls, ctx } = fake;
  assert.equal(runtime.preview(), null); fake.add('A reply'); fake.add('A system note', { is_system: true });
  await fake.emit('WORLD_INFO_ACTIVATED', [{ content: 'Activated lore' }]);
  runtime.updateSettings({ language: 'en', prompts: { rules: 'Custom rules' } });
  const metadata = JSON.stringify(ctx.chatMetadata), saves = calls.metadata.length, publishes = calls.prompts.length;
  const preview = runtime.preview();
  assert.equal(preview.mesId, 0); assert.equal(calls.requests.length, 0); assert.equal(calls.metadata.length, saves);
  assert.equal(calls.prompts.length, publishes); assert.equal(JSON.stringify(ctx.chatMetadata), metadata);
  assert.equal(preview.chars, preview.messages.reduce((sum, m) => sum + m.content.length, 0));
  await runtime.refresh();
  assert.deepEqual(preview.messages, calls.requests[0][1]);
  const entry = runtime.snapshot().log[0];
  assert.equal(entry.status, 'ok'); assert.deepEqual(entry.request, calls.requests[0][1]);
  assert.equal(entry.response, answer('Observatory')); assert.equal(entry.outChars, entry.response.length);
  assert.deepEqual(entry.validSections, ['world']); assert.equal(entry.chatId, 'chat-a');
  assert.equal(Object.hasOwn(ctx.chatMetadata.sableTrackers, 'log'), false);
  assert.equal(Object.hasOwn(ctx.extensionSettings.sableTrackers, 'log'), false);
  ctx.groupId = 'group'; assert.equal(runtime.preview(), null); ctx.groupId = null;
  runtime.updateSettings({ enabled: false }); assert.equal(runtime.preview(), null);
});

test('preview before runtime start does not initialize chat metadata', () => {
  const fake = createFakeST(); fake.add();
  const runtime = createRuntime(fake.getContext);
  assert.ok(runtime.preview()); assert.deepEqual(fake.ctx.chatMetadata, {});
  assert.equal(fake.calls.requests.length, 0); assert.equal(fake.calls.metadata.length, 0); assert.equal(fake.calls.prompts.length, 0);
});

test('request log retains invalid raw output, failures, skipped runs and a five-entry history', async t => {
  const fake = setup(t), { runtime } = fake; fake.add();
  fake.respond('nonsense'); await runtime.refresh();
  assert.equal(runtime.snapshot().log[0].status, 'invalid');
  assert.equal(runtime.snapshot().log[0].response, 'nonsense'); assert.ok(runtime.snapshot().log[0].warnings.length);
  fake.respond(() => { throw new Error('Network failed'); }); await runtime.refresh();
  assert.equal(runtime.snapshot().log[0].status, 'failed'); assert.equal(runtime.snapshot().log[0].error, 'Network failed');
  runtime.updateSettings({ sections: Object.fromEntries(SECTION_ORDER.map(id => [id, { mode: 'off' }])) });
  await runtime.refresh(); const skipped = runtime.snapshot().log[0];
  assert.equal(skipped.status, 'skipped'); assert.equal(skipped.request, null); assert.equal(skipped.response, null);
  for (let i = 0; i < 3; i++) await runtime.refresh();
  const log = runtime.snapshot().log; assert.equal(log.length, 5);
  assert.ok(log.every((entry, i) => !i || log[i - 1].at > entry.at));
  fake.ctx.chatId = 'chat-b'; await fake.emit('CHAT_CHANGED'); assert.deepEqual(runtime.snapshot().log, log);
  let published; const unsubscribe = runtime.subscribe(view => { published = view.log; });
  runtime.clearLog(); assert.deepEqual(published, []); assert.deepEqual(runtime.snapshot().log, []); unsubscribe();
});

test('cancel logs dropped before publishing, including AbortError and late raw responses', async t => {
  const fake = setup(t), { runtime } = fake; fake.add();
  fake.respond((id, messages, tokens, custom) => new Promise((resolve, reject) => {
    custom.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const pending = runtime.refresh(); runtime.updateSettings({ enabled: false });
  assert.equal(runtime.snapshot().log[0].status, 'dropped'); await pending;
  assert.equal(runtime.snapshot().log.length, 1);
  runtime.updateSettings({ enabled: true }); const response = deferred(); fake.respond(() => response.promise);
  const late = runtime.refresh(); runtime.updateSettings({ enabled: false }); response.resolve({ content: 'Late raw output' }); await late;
  assert.equal(runtime.snapshot().log.length, 2); assert.equal(runtime.snapshot().log[0].response, 'Late raw output');
  assert.equal(runtime.snapshot().log[0].status, 'dropped');
  runtime.updateSettings({ enabled: true }); const next = deferred(); fake.respond(() => next.promise);
  const cleared = runtime.refresh(); runtime.updateSettings({ enabled: false }); runtime.clearLog();
  next.resolve('Ignored after clearing'); await cleared; assert.deepEqual(runtime.snapshot().log, []);
});

test('unannounced message changes keep raw discarded responses in the log', async t => {
  const fake = setup(t), response = deferred(); fake.add(); fake.respond(() => response.promise);
  const pending = fake.runtime.refresh(); fake.ctx.chat[0].mes = 'A different reply'; response.resolve(answer('Old location')); await pending;
  const entry = fake.runtime.snapshot().log[0]; assert.equal(entry.status, 'dropped'); assert.equal(entry.response, answer('Old location'));
});

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
  // Two messages with saved state stay under keep = 3, every swipe included.
  assert.equal(store.ring.length, 4);
  pruneEntries(store, 1);
  assert.deepEqual(store.ring.map(e => e.mesId), [0]);
  pruneEntries(store, 0);
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
  await fake.emit('MESSAGE_RECEIVED', id, 'normal'); await fake.runtime.idle();
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
  await fake.emit('MESSAGE_RECEIVED', id, 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 1);
});

test('new swipe uses the state before the message; cached swipe restores without a request', async t => {
  const fake = setup(t);
  fake.respond(answer('Base')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  fake.respond(answer('Original')); const id = fake.add(); await fake.emit('MESSAGE_RECEIVED', id, 'normal'); await fake.runtime.idle();
  fake.ctx.chat[id].swipe_id = 1; fake.ctx.chat[id].mes = 'An alternative.';
  await fake.emit('MESSAGE_SWIPED', id);
  assert.match(injection(fake), /Base/);
  fake.respond(answer('Alternative')); await fake.emit('MESSAGE_RECEIVED', id, 'swipe'); await fake.runtime.idle();
  assert.match(fake.calls.requests.at(-1)[1][2].content, /Base/);
  assert.doesNotMatch(fake.calls.requests.at(-1)[1][2].content, /Original/);
  assert.equal(data(fake).ring.at(-1).turn, 2);
  fake.ctx.chat[id].swipe_id = 0; fake.ctx.chat[id].mes = 'The guide opens the dome.';
  await fake.emit('MESSAGE_SWIPED', id); await fake.emit('MESSAGE_RECEIVED', id, 'swipe'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 3);
  assert.match(injection(fake), /Original/);
  assert.equal(data(fake).turnsSince.planner, 2);
});

test('delete prunes ring and injection; edit marks stale without rerunning; refresh replaces state', async t => {
  const fake = setup(t);
  const id = fake.add(); await fake.emit('MESSAGE_RECEIVED', id, 'normal'); await fake.runtime.idle();
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
    await fake.emit('MESSAGE_RECEIVED', fake.add(type), type); await fake.runtime.idle();
  }
  assert.equal(fake.calls.requests.length, 4);
  for (const type of ['impersonate', 'first_message', 'command', 'extension']) await fake.emit('MESSAGE_RECEIVED', fake.add(type), type); await fake.runtime.idle();
  await fake.emit('MESSAGE_RECEIVED', fake.add('User', { is_user: true }), 'normal'); await fake.runtime.idle();
  await fake.emit('MESSAGE_RECEIVED', fake.add('System', { is_system: true }), 'normal'); await fake.runtime.idle();
  fake.ctx.groupId = 'group'; await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  fake.ctx.groupId = null; fake.runtime.updateSettings({ enabled: false });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 4);
  assert.equal(injection(fake), '');
});

test('missing or unsupported profile produces one warning and no request without browser globals', async t => {
  const fake = setup(t), warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  fake.runtime.updateSettings({ profileId: '' });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
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
  await fake.emit('MESSAGE_RECEIVED', fake.add('First'), 'normal');
  const old = fake.runtime.idle();
  const signal = fake.calls.requests[0][3].signal;
  fake.respond(answer('Newest')); await fake.emit('MESSAGE_RECEIVED', fake.add('Second'), 'normal'); await fake.runtime.idle();
  assert.equal(signal.aborted, true);
  first.resolve(answer('Obsolete')); await old;
  assert.equal(data(fake).ring.length, 1);
  assert.match(injection(fake), /Newest/);
});

test('chat change cancels work, clears lore and injection, and reloads saved state', async t => {
  const fake = setup(t), pending = deferred();
  await fake.emit('WORLD_INFO_ACTIVATED', [{ content: 'Old chat lore' }]);
  fake.respond(() => pending.promise);
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal');
  const old = fake.runtime.idle();
  const oldMetadata = fake.ctx.chatMetadata;
  fake.ctx.chatMetadata = {}; fake.ctx.chat = []; fake.ctx.chatId = 'chat-b';
  await fake.emit('CHAT_CHANGED', 'chat-b');
  pending.resolve(answer('Late')); await old;
  assert.equal(oldMetadata.sableTrackers.ring.length, 0);
  assert.equal(data(fake).ring.length, 0); assert.equal(injection(fake), '');
  fake.respond(answer('New chat')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.doesNotMatch(fake.calls.requests.at(-1)[1][1].content, /Old chat lore/);
  await fake.emit('CHAT_CHANGED', 'chat-b');
  assert.match(injection(fake), /New chat/);
});

test('invalid output and rejected requests retain state and report failure without throwing', async t => {
  const fake = setup(t);
  t.mock.method(console, 'warn', () => {});
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  fake.respond('garbage'); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(data(fake).ring.length, 1); assert.equal(data(fake).lastRun.ok, false);
  assert.match(injection(fake), /Observatory/);
  fake.respond(() => { throw new Error('offline'); }); await fake.runtime.refresh();
  assert.equal(data(fake).lastRun.ok, false); assert.equal(data(fake).ring.length, 1);
});

test('section modes, custom periods and output language control requests and injection', async t => {
  const fake = setup(t);
  fake.runtime.updateSettings({ language: 'en', sections: { planner: { period: 2 }, thoughts: { mode: 'off' } } });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.doesNotMatch(fake.calls.requests[0][1][0].content, /PLANNER:|THOUGHTS:/);
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
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
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await entry.runtime.idle();
  assert.equal(fake.calls.requests.length, 1);
});

test('slow-only settings advance cadence without requests and reset only valid sections', async t => {
  const fake = setup(t);
  const sections = Object.fromEntries(SECTION_ORDER.map(id => [id, { mode: 'off' }]));
  sections.planner = { mode: 'inject', period: 2 };
  fake.runtime.updateSettings({ sections });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 0);
  assert.equal(data(fake).turnsSince.planner, 1);
  assert.equal(injection(fake), '');
  fake.respond('<sable_state>{"planner":{"beats":[],"remember":"Close the dome"}}</sable_state>');
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 1);
  assert.equal(data(fake).turnsSince.planner, 0);
  assert.match(injection(fake), /Close the dome/);
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 1);
  assert.equal(data(fake).ring.length, 3);
  assert.match(injection(fake), /Close the dome/);
});

test('duplicate in-flight events debounce while continue on changed text recomputes from base', async t => {
  const fake = setup(t), pending = deferred();
  fake.respond(answer('Base')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  fake.respond(() => pending.promise);
  const id = fake.add('Start'), first = fake.emit('MESSAGE_RECEIVED', id, 'normal');
  await fake.emit('MESSAGE_RECEIVED', id, 'normal');
  assert.equal(fake.calls.requests.length, 2);
  assert.equal(fake.calls.requests[1][3].signal.aborted, false);
  pending.resolve(answer('Start')); await first; await fake.runtime.idle();
  fake.ctx.chat[id].mes += ' continued'; fake.respond(answer('Continued'));
  await fake.emit('MESSAGE_RECEIVED', id, 'continue'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 3);
  assert.match(fake.calls.requests[2][1][2].content, /Base/);
  assert.doesNotMatch(fake.calls.requests[2][1][2].content, /Start/);
  assert.equal(data(fake).ring.at(-1).turn, 2);
});

test('edit, deletion and disabling abort pending requests without committing late results', async t => {
  for (const action of ['edit', 'delete', 'disable']) {
    const fake = setup(t), pending = deferred();
    fake.respond(() => pending.promise);
    const id = fake.add(); await fake.emit('MESSAGE_RECEIVED', id, 'normal');
    const running = fake.runtime.idle();
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
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  fake.respond('<sable_state>{"world":false,"threads":[{"text":"Find the key","priority":"high"}]}</sable_state>');
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(data(fake).ring.at(-1).state.world.location, 'Observatory');
  assert.equal(data(fake).turnsSince.world, 1);
  assert.equal(data(fake).turnsSince.threads, 0);
  assert.match(injection(fake), /Find the key/);
});

test('failed replies still advance slow-section cadence on the next successful request', async t => {
  const fake = setup(t);
  t.mock.method(console, 'warn', () => {});
  fake.runtime.updateSettings({ sections: { planner: { period: 3 } } });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  fake.respond('invalid'); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  fake.respond(answer('Recovered')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.match(fake.calls.requests.at(-1)[1][0].content, /PLANNER:/);
  assert.equal(data(fake).ring.at(-1).turn, 3);
});

test('editState sanitizes, replaces one section in the current entry, clears stale, re-injects and saves', async t => {
  const fake = setup(t);
  fake.add('The guide opens the dome.');
  loadStore(fake.ctx).ring.push({ mesId: 0, swipeId: 0, turn: 1, stale: true,
    state: { world: { location: 'Dome' }, threads: [{ text: 'Old', priority: 'low' }], meta: { turn: 1 } } });
  const before = Date.now();
  assert.equal(fake.runtime.editState('threads', [{ text: '  Who cut the rope?  ', priority: 'high', extra: 'x' },
    { text: 'Missing page', priority: 'nonsense' }, { priority: 'low' }]), true);
  const entry = data(fake).ring[0];
  assert.deepEqual(entry.state.threads, [{ text: 'Who cut the rope?', priority: 'high' }, { text: 'Missing page', priority: 'mid' }]);
  assert.deepEqual(entry.state.world, { location: 'Dome' }, 'other sections untouched');
  assert.ok(entry.state.meta.editedAt >= before);
  assert.equal(entry.state.meta.turn, 1);
  assert.equal(entry.stale, undefined);
  assert.ok(injection(fake).includes('Who cut the rope?'));
  assert.equal(injection(fake).includes('Old'), false);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(fake.calls.metadata.length >= 1, 'metadata saved');
  assert.equal(fake.runtime.editState('bonds', [{ id: 'maren', stats: { trust: 250, fear: -3, desire: null } }]), true);
  assert.deepEqual(data(fake).ring[0].state.bonds[0].stats, { trust: 100, fear: 0, desire: null }, 'scores clamp');
  assert.equal(fake.runtime.editState('nope', {}), false);
  assert.equal(fake.runtime.editState('world', 'not an object'), false);
});

test('editState creates an entry for the last character reply when the chat has no state; custom kv sections work', t => {
  const fake = setup(t);
  assert.equal(fake.runtime.editState('world', { location: 'Dome' }), false, 'no character reply to attach to');
  fake.add('Hello', { is_user: true }); fake.add('The guide bows.'); fake.add('Thanks', { is_user: true });
  fake.ctx.extensionSettings.sableTrackers.customSections = [{ id: 'c_0123abcd', title: 'Clues', shape: 'kv', max: 2, mode: 'inject' }];
  assert.equal(fake.runtime.editState('c_0123abcd', [{ key: 'Knife', value: 'under the stove' }, { key: 'Rope', value: 'cut' },
    { key: 'Third', value: 'over the cap' }, { key: '', value: 'no key' }]), true);
  const [entry] = data(fake).ring;
  assert.deepEqual([entry.mesId, entry.swipeId, entry.turn], [1, 0, 1]);
  assert.deepEqual(entry.state.c_0123abcd, [{ key: 'Knife', value: 'under the stove' }, { key: 'Rope', value: 'cut' }]);
  assert.ok(injection(fake).includes('CLUES: Knife: under the stove · Rope: cut'));
});

test('presentation settings and modes preserve pending data; semantic settings cancel silently', async t => {
  for (const semantic of [false, true]) {
    const fake = setup(t), pending = deferred(), views = [];
    fake.runtime.subscribe(view => views.push(view.running));
    fake.respond(() => pending.promise);
    const id = fake.add(), running = fake.runtime.run(id);
    assert.deepEqual(fake.runtime.snapshot().running, { mesId: id, swipeId: 0, startedAt: views.at(-1).startedAt });
    if (semantic) fake.runtime.updateSettings({ language: 'en' });
    else {
      fake.runtime.updateSettings({ folded: { world: true }, visual: { opacity: .7 }, pinned: true,
        floatingPosition: .3, order: [...SECTION_ORDER].reverse(), showPanel: false, showFloatingButton: false,
        hideOff: false, perChatOverrides: true, depth: 4, keep: 2, messages: 2, cardChars: 1000,
        loreChars: 1000, maxTokens: 1000, sections: { planner: { period: 2 } } });
      fake.runtime.setMode('world', 'off');
      fake.runtime.setMode('threads', 'off', false);
    }
    assert.equal(fake.calls.requests[0][3].signal.aborted, semantic);
    if (semantic) assert.equal(fake.runtime.snapshot().running, null);
    pending.resolve(answer('Dome')); await running;
    assert.equal(data(fake).ring.length, semantic ? 0 : 1);
    assert.equal(data(fake).lastRun?.error, undefined);
    if (!semantic) {
      assert.equal(data(fake).ring[0].state.world.location, 'Dome');
      assert.doesNotMatch(injection(fake), /Dome/);
      await fake.runtime.run(id);
      assert.equal(fake.calls.requests.length, 1, 'cosmetic changes do not reset the fingerprint');
    }
    assert.equal(views.at(-1), null);
  }
});

test('refresh shares the active promise for the same message and replaces a run for an older reply', async t => {
  const fake = setup(t), pending = deferred();
  fake.respond(() => pending.promise);
  const id = fake.add(), first = fake.runtime.run(id);
  assert.equal(fake.runtime.refresh(), first);
  assert.equal(fake.runtime.idle(), first);
  assert.equal(fake.calls.requests.length, 1);
  const signal = fake.calls.requests[0][3].signal;
  fake.add('New reply'); fake.respond(answer('New'));
  await fake.runtime.refresh();
  assert.equal(signal.aborted, true);
  assert.equal(fake.calls.requests.length, 2);
  pending.resolve(answer('Old')); await first;
  assert.equal(data(fake).ring.length, 1);
  assert.equal(data(fake).ring[0].state.world.location, 'New');
  assert.equal(fake.runtime.snapshot().running, null);
});

test('metadata replacement keeps results and writes to the current store', async t => {
  for (const replaceStore of [false, true]) {
    const fake = setup(t), pending = deferred();
    fake.respond(() => pending.promise);
    const running = fake.runtime.run(fake.add()), old = data(fake);
    fake.ctx.chatMetadata = { ...fake.ctx.chatMetadata };
    if (replaceStore) fake.ctx.chatMetadata.sableTrackers = structuredClone(old);
    pending.resolve(answer('Current')); await running;
    assert.equal(data(fake).ring[0].state.world.location, 'Current');
    assert.equal(fake.calls.metadata.at(-1), fake.ctx.chatMetadata);
    if (replaceStore) assert.equal(old.ring.length, 0);
  }
});

test('unannounced text, swipe and message replacements report discarded results', async t => {
  for (const change of ['text', 'swipe', 'identity']) {
    const fake = setup(t), pending = deferred();
    fake.respond(() => pending.promise);
    const id = fake.add(), running = fake.runtime.run(id);
    if (change === 'text') fake.ctx.chat[id].mes += ' changed';
    if (change === 'swipe') fake.ctx.chat[id].swipe_id = 1;
    if (change === 'identity') fake.ctx.chat[id] = { ...fake.ctx.chat[id] };
    pending.resolve(answer('Old')); await running;
    assert.equal(data(fake).ring.length, 0);
    assert.equal(data(fake).lastRun.ok, false);
    assert.equal(data(fake).lastRun.error, 'ответ устарел: сообщение изменилось');
    assert.equal(fake.runtime.snapshot().running, null);
  }
});

test('MESSAGE_RECEIVED returns undefined and later listeners run before the request completes', async t => {
  const fake = setup(t), pending = deferred();
  fake.respond(() => pending.promise);
  const id = fake.add(), handler = [...fake.handlers.get('MESSAGE_RECEIVED')][0];
  assert.equal(handler(id, 'normal'), undefined);
  let observed = false;
  fake.ctx.eventSource.on('MESSAGE_RECEIVED', () => { observed = true; });
  await fake.emit('MESSAGE_RECEIVED', id, 'normal');
  assert.equal(observed, true);
  assert.equal(data(fake).ring.length, 0);
  pending.resolve(answer('Done')); await fake.runtime.idle();
  assert.equal(data(fake).lastRun.ok, true);
});

test('force includes slow enabled sections on the first reply and only resets valid counters', async t => {
  const fake = setup(t);
  fake.add();
  fake.runtime.setMode('thoughts', 'off');
  fake.respond('<sable_state>{"planner":{"beats":[],"remember":"Close the dome"}}</sable_state>');
  await fake.runtime.refresh();
  assert.match(fake.calls.requests[0][1][0].content, /PLANNER:/);
  assert.match(fake.calls.requests[0][1][0].content, /BANLIST:/);
  assert.doesNotMatch(fake.calls.requests[0][1][0].content, /THOUGHTS:/);
  assert.equal(data(fake).ring[0].state.planner.remember, 'Close the dome');
  assert.equal(data(fake).turnsSince.planner, 0);
  assert.equal(data(fake).turnsSince.banlist, 1);
});

test('nothing due records a successful skipped run', async t => {
  const fake = setup(t);
  fake.runtime.updateSettings({ sections: Object.fromEntries(SECTION_ORDER.map(id => [id, { mode: id === 'planner' ? 'show' : 'off' }])) });
  await fake.runtime.run(fake.add());
  assert.equal(fake.calls.requests.length, 0);
  assert.equal(data(fake).lastRun.skipped, true);
  assert.equal(data(fake).lastRun.ok, true);
  assert.ok(data(fake).lastRun.at);
  assert.equal(data(fake).lastRun.ms, undefined);
});

test('prompt, persistence and warning failures never reject runs', async t => {
  const fake = setup(t);
  const id = fake.add();
  t.mock.method(console, 'warn', () => { throw new Error('logger unavailable'); });
  fake.runtime.updateSettings({ profileId: '' });
  await assert.doesNotReject(fake.runtime.refresh());
  fake.runtime.updateSettings({ profileId: 'side' });
  fake.ctx.substituteParams = () => { throw new Error('prompt failure'); };
  await assert.doesNotReject(fake.runtime.run(id));
  assert.equal(data(fake).lastRun.ok, false);
  assert.equal(fake.runtime.snapshot().running, null);
  fake.ctx.substituteParams = () => '';
  fake.ctx.saveMetadata = () => { throw new Error('save failure'); };
  await assert.doesNotReject(fake.runtime.refresh());
  assert.equal(fake.runtime.snapshot().running, null);
});

test('ring caps by message: four swipes keep the base state and swiping back restores the cached swipe', () => {
  const fake = createFakeST(), store = loadStore(fake.ctx);
  for (let i = 0; i < 6; i++) fake.add('', { is_user: i % 2 === 0 });
  putEntry(store, { mesId: 1, swipeId: 0, turn: 1, state: {} }, 3);
  putEntry(store, { mesId: 3, swipeId: 0, turn: 2, state: {} }, 3);
  for (let swipeId = 0; swipeId <= 3; swipeId++) {
    fake.ctx.chat[5].swipe_id = swipeId;
    assert.equal(currentEntry(store, fake.ctx.chat, 5).mesId, 3);
    putEntry(store, { mesId: 5, swipeId, turn: 3, state: {} }, 3);
    assert.deepEqual([currentEntry(store, fake.ctx.chat).mesId, currentEntry(store, fake.ctx.chat).swipeId], [5, swipeId]);
  }
  assert.deepEqual(store.ring.map(e => `${e.mesId}/${e.swipeId}`), ['1/0', '3/0', '5/0', '5/1', '5/2', '5/3']);
  fake.ctx.chat[5].swipe_id = 0;
  assert.equal(findEntry(store, 5, 0), currentEntry(store, fake.ctx.chat));
  assert.equal(currentEntry(store, fake.ctx.chat, 5).mesId, 3);
});

test('ring keeps six swipes per message and the newest three messages; a rewrite still drops later states', () => {
  const fake = createFakeST(), store = loadStore(fake.ctx);
  for (let i = 0; i < 8; i++) fake.add('', { is_user: i % 2 === 0 });
  for (const mesId of [1, 3]) putEntry(store, { mesId, swipeId: 0, turn: 1, state: {} }, 3);
  for (let swipeId = 0; swipeId < 7; swipeId++) putEntry(store, { mesId: 5, swipeId, turn: 3, state: {} }, 3);
  assert.equal(SWIPES_PER_MESSAGE, 6);
  assert.deepEqual(store.ring.filter(e => e.mesId === 5).map(e => e.swipeId), [1, 2, 3, 4, 5, 6]);
  assert.equal(findEntry(store, 5, 0), undefined);
  assert.ok(findEntry(store, 1, 0));
  putEntry(store, { mesId: 7, swipeId: 0, turn: 4, state: {} }, 3);
  assert.deepEqual(store.ring.map(e => `${e.mesId}/${e.swipeId}`), ['3/0', '5/1', '5/2', '5/3', '5/4', '5/5', '5/6', '7/0']);
  pruneEntries(store, 7);
  assert.deepEqual(store.ring.map(e => e.mesId), [3, 5, 5, 5, 5, 5, 5]);
  putEntry(store, { mesId: 3, swipeId: 0, turn: 2, state: { world: { location: 'Rewritten' } } }, 3);
  assert.deepEqual(store.ring.map(e => `${e.mesId}/${e.swipeId}`), ['3/0']);
  assert.equal(store.ring[0].state.world.location, 'Rewritten');
});

test('four swipes of one reply keep the base state injected and cache every swipe', async t => {
  const fake = setup(t);
  fake.respond(answer('Base')); await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  const id = fake.add();
  for (let swipeId = 0; swipeId <= 3; swipeId++) {
    fake.ctx.chat[id].swipe_id = swipeId; fake.ctx.chat[id].mes = `Swipe ${swipeId}`;
    if (swipeId) await fake.emit('MESSAGE_SWIPED', id);
    assert.match(injection(fake), /Base/);
    fake.respond(answer(`Variant ${swipeId}`));
    await fake.emit('MESSAGE_RECEIVED', id, swipeId ? 'swipe' : 'normal'); await fake.runtime.idle();
    assert.match(fake.calls.requests.at(-1)[1][2].content, /Base/);
    assert.doesNotMatch(fake.calls.requests.at(-1)[1][2].content, /Variant/);
    assert.match(injection(fake), new RegExp(`Variant ${swipeId}`));
  }
  assert.deepEqual(data(fake).ring.map(e => `${e.mesId}/${e.swipeId}`), ['0/0', '1/0', '1/1', '1/2', '1/3']);
  fake.ctx.chat[id].swipe_id = 0; fake.ctx.chat[id].mes = 'Swipe 0';
  await fake.emit('MESSAGE_SWIPED', id); await fake.emit('MESSAGE_RECEIVED', id, 'swipe'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 5);
  assert.match(injection(fake), /Variant 0/);
  fake.ctx.chat.length = 1; await fake.emit('MESSAGE_DELETED', 1);
  assert.deepEqual(data(fake).ring.map(e => e.mesId), [0]);
  assert.match(injection(fake), /Base/);
});

test('injection role follows settings.role on state and clearing calls, system by default', async t => {
  const fake = setup(t);
  assert.deepEqual(fake.calls.prompts.at(-1).slice(1), ['', 1, 2, false, 0]);
  const id = fake.add(); await fake.emit('MESSAGE_RECEIVED', id, 'normal'); await fake.runtime.idle();
  assert.deepEqual(fake.calls.prompts.at(-1).slice(2), [1, 2, false, 0]);
  fake.runtime.updateSettings({ role: 'user' });
  assert.notEqual(injection(fake), ''); assert.deepEqual(fake.calls.prompts.at(-1).slice(2), [1, 2, false, 1]);
  fake.runtime.updateSettings({ role: 'assistant' }); assert.equal(fake.calls.prompts.at(-1)[5], 2);
  fake.runtime.updateSettings({ role: 'user', enabled: false });
  assert.deepEqual(fake.calls.prompts.at(-1).slice(1), ['', 1, 2, false, 1]);
  fake.ctx.chat.length = 0; await fake.emit('CHAT_CHANGED');
  assert.deepEqual(fake.calls.prompts.at(-1).slice(1), ['', 1, 2, false, 1]);
  fake.runtime.updateSettings({ role: 'bogus' }); assert.equal(fake.calls.prompts.at(-1)[5], 0);
});

test('injection role normalizes to system, user or assistant, idempotently, and loadSettings saves only a changed form', () => {
  assert.equal(normalizeSettings({}).role, 'system');
  assert.equal(normalizeSettings({ role: 'bogus' }).role, 'system');
  assert.equal(normalizeSettings({ role: 1 }).role, 'system');
  assert.equal(normalizeSettings({ role: 'assistant' }).role, 'assistant');
  const once = normalizeSettings({ role: 'user', keep: '2' });
  assert.equal(JSON.stringify(normalizeSettings(once)), JSON.stringify(once));
  const fake = createFakeST();
  fake.ctx.extensionSettings.sableTrackers.role = 'bogus';
  assert.equal(loadSettings(fake.ctx).role, 'system'); assert.equal(fake.calls.settings, 1);
  assert.equal(loadSettings(fake.ctx).role, 'system'); assert.equal(fake.calls.settings, 1);
  assert.equal(saveSettings(fake.ctx, { role: 'user' }).role, 'user');
});
