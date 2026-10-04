import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeKey, RESERVED_KEYS } from '../src/sections.js';
import { parseStateOutput, sanitizeSection } from '../src/parse.js';
import { loadStore, recordHistory, recordStatHistory } from '../src/store.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

const wrap = state => `<sable_state>${JSON.stringify(state)}</sable_state>`;
// Nothing may leak onto the shared prototype: neither as an own property nor through a reserved setter.
const pristine = () => ['trust', 'affection'].every(key => ({})[key] === undefined && !(key in {}) && !Object.hasOwn(Object.prototype, key))
  && Object.trust === undefined;

test('reserved names: parse drops bond rows, stat rows and change keys named after prototype accessors', () => {
  assert.deepEqual([...RESERVED_KEYS], ['__proto__', 'constructor', 'prototype']);
  assert.ok(isSafeKey('maren') && !isSafeKey('__proto__') && !isSafeKey('') && !isSafeKey(5));
  const parsed = parseStateOutput(wrap({ bonds: [
    { id: '__proto__', name: 'probe', stats: { trust: 25 } },
    { name: '__proto__', stats: { trust: 25 } },
    { id: 'constructor', name: 'C', stats: { trust: 1 } },
    { id: 'maren', name: 'Maren', stats: { trust: 40 }, changes: { ['__proto__']: { delta: 5, reason: 'x' }, trust: { delta: 5, reason: 'ok' } } },
  ] }), ['bonds']);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.sections.bonds.map(bond => bond.id), ['maren'], 'the derived id from the name is checked too');
  assert.deepEqual(Object.keys(parsed.sections.bonds[0].changes), ['trust']);
  const stats = { type: 'array', max: 10, unique: 'key', item: { type: 'object', fields: { key: { type: 'string', max: 60 }, value: { type: 'integer' } }, required: ['key'] } };
  assert.deepEqual(sanitizeSection({ schema: stats }, [{ key: 'prototype', value: 1 }, { key: 'hp', value: 2 }]), [{ key: 'hp', value: 2 }]);
  assert.ok(pristine());
});

test('reserved names: the history map never writes to Object.prototype and never throws on them', () => {
  const data = loadStore({ chatMetadata: {} });
  assert.doesNotThrow(() => recordHistory(data, [{ id: '__proto__', stats: { trust: 25 } }, { id: 'constructor', stats: { trust: 1 } },
    { id: 'maren', stats: { trust: 40, constructor: 3 } }], 3, ['trust', 'constructor']));
  assert.ok(pristine(), 'nothing on Object.prototype');
  assert.deepEqual(Object.keys(data.history), ['maren']);
  assert.deepEqual(Object.keys(data.history.maren), ['trust'], 'a reserved scale name is skipped, not stored');
  assert.doesNotThrow(() => recordStatHistory(data, 'combat', [{ key: 'constructor', value: 3, max: 10 }, { key: '__proto__', value: 1, max: 10 },
    { key: 'hp', value: 7, max: 10 }], 3));
  assert.deepEqual(Object.keys(data.history.combat), ['hp']);
  assert.ok(pristine());
});

test('reserved names: a side-model reply with id "__proto__" leaves Object.prototype untouched end to end', async t => {
  const fake = createFakeST(); const runtime = createRuntime(fake.getContext); runtime.start();
  t.after(() => runtime.dispose());
  t.mock.method(console, 'warn', () => {});
  fake.respond(wrap({ bonds: [{ id: '__proto__', name: 'probe', stats: { trust: 25, affection: 50 } }, { id: 'maren', name: 'Maren', stats: { trust: 40 } }],
    world: { location: 'Pier' } }));
  fake.add();
  await runtime.refresh(); await runtime.idle();
  assert.ok(pristine(), 'nothing leaked onto Object.prototype');
  const store = fake.ctx.chatMetadata.sableTrackers;
  assert.equal(store.ring.at(-1).state.world.location, 'Pier', 'the run itself succeeded');
  assert.deepEqual(store.ring.at(-1).state.bonds.map(bond => bond.id), ['maren']);
  assert.deepEqual(Object.keys(store.history ?? {}), ['maren']);
});
