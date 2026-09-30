import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { seedFromLegacy } from '../src/legacy.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';
const fixture = JSON.parse(await readFile(new URL('../fixtures/legacy-message.json', import.meta.url), 'utf8'));

test('legacy fixture maps world, threads, NPCs, thoughts and bonds without mutation', () => {
  const chat = [structuredClone(fixture)];
  const before = structuredClone(chat);
  const { state, mesId } = seedFromLegacy(chat);
  assert.equal(mesId, 0);
  assert.equal(state.world.weather, 'rain');
  assert.equal(state.world.pc.visible_condition, 'soaked');
  assert.equal(state.threads[0].priority, 'mid');
  assert.equal(state.npcs[0].mood, 'wary');
  assert.equal(state.npcs[1].present, false);
  assert.match(state.thoughts[0].thought, /stranger/);
  assert.equal(state.bonds[0].stats.desire, null);
  assert.equal(state.bonds[0].changes.trust.delta, 4);
  assert.equal(state.usage, undefined);
  assert.equal(state.world.threads, undefined);
  assert.deepEqual(chat, before);
});

test('extblocks fallback, tolerant JSON and legacy stats', () => {
  const message = structuredClone(fixture);
  delete message.swipe_info;
  delete message.extra.sable_scene_v2;
  assert.equal(seedFromLegacy([message]).state.bonds[0].stats.trust, 29);
  message.extra.extblocks = '<sable_state>```json\n{"version":2,"npcs":[{"name":"Guide","legacy_stats":{"friendship":12},}],}\n```</sable_state>';
  assert.deepEqual(seedFromLegacy([message]).state.bonds[0].legacy_stats, { friendship: 12 });
});

test('active swipe wins; empty active extras do not import another swipe; garbage is ignored', () => {
  const message = structuredClone(fixture);
  message.swipe_id = 1;
  message.swipe_info.push({ extra: {} });
  assert.equal(seedFromLegacy([message]), null);
  message.swipe_info[1].extra = { extblocks: '<sable_state>{"version":2,"world":{"location":"Active"},"npcs":[]}</sable_state>' };
  assert.equal(seedFromLegacy([fixture, message]).state.world.location, 'Active');
  for (const input of [null, {}, [], [null, {}, { extra: { extblocks: '<sable_state>garbage</sable_state>' } }]]) assert.equal(seedFromLegacy(input), null);
  assert.equal(seedFromLegacy([fixture, { ...message, is_user: true }, { ...message, is_system: true }]).mesId, 0);
});

test('runtime seeds only on request, publishes, saves once and refuses replacement', async () => {
  const fake = createFakeST(); fake.ctx.chat.push(structuredClone(fixture));
  const before = structuredClone(fake.ctx.chat);
  const runtime = createRuntime(fake.getContext); runtime.start();
  assert.equal(runtime.snapshot().store.ring.length, 0);
  assert.equal(runtime.snapshot().canSeedLegacy, true);
  let notifications = 0; runtime.subscribe(() => notifications++);
  assert.equal(await runtime.seedLegacy(), true);
  const entry = runtime.snapshot().store.ring[0];
  assert.equal(entry.mesId, 0); assert.equal(entry.swipeId, 0);
  assert.equal(entry.state.bonds[0].stats.trust, 29);
  assert.equal(notifications, 1); assert.equal(fake.calls.metadata.length, 1);
  assert.equal(await runtime.seedLegacy(), false);
  assert.equal(fake.calls.metadata.length, 1);
  assert.deepEqual(fake.ctx.chat, before);
  runtime.dispose();
});
