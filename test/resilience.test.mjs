import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeST } from './fakes/st.mjs';
import { createRuntime, isParameterRejection } from '../src/run.js';
import { DEFAULTS, normalizeSettings } from '../src/settings.js';
import { outputProblem, parseStateOutput } from '../src/parse.js';
import { t as label } from '../src/i18n.js';

function setup(t) {
  const fake = createFakeST();
  const runtime = createRuntime(fake.getContext);
  runtime.start();
  t.after(() => runtime.dispose());
  t.mock.method(console, 'warn', () => {});
  return { ...fake, runtime };
}
const data = fake => fake.ctx.chatMetadata.sableTrackers;
const answer = location => `<sable_state>${JSON.stringify({ world: { location } })}</sable_state>`;
// An endpoint that refuses the reasoning parameters with HTTP 400 and accepts the request without them.
const picky = location => (profile, messages, maxTokens, custom, override) => {
  if (override?.reasoning_effort) throw Object.assign(new Error('Invalid request for this model. Please remove unsupported parameters'), { status: 400 });
  return answer(location);
};

test('a reasoning rejection retries once without the payload, stores state and flags the log entry', async t => {
  const fake = setup(t);
  fake.respond(picky('Harbour'));
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 2);
  assert.equal(fake.calls.requests[0][4].reasoning_effort, 'low');
  assert.deepEqual(fake.calls.requests[1][4], {});
  // The retried run is otherwise identical.
  assert.deepEqual(fake.calls.requests[1].slice(0, 3), fake.calls.requests[0].slice(0, 3));
  assert.equal(data(fake).lastRun.ok, true);
  assert.equal(data(fake).ring.at(-1).state.world.location, 'Harbour');
  const [entry] = fake.runtime.snapshot().log;
  assert.equal(entry.status, 'ok'); assert.equal(entry.retried, 'no-reasoning');
  assert.ok(entry.warnings.includes(label('reasoningRejected', 'ru')));
  assert.equal(label('reasoningRejected', 'en'), 'The model rejected the reasoning parameters; retried without them');

  // The profile is remembered: the next run sends no payload from the start.
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 3);
  assert.deepEqual(fake.calls.requests[2][4], {});
  assert.equal(fake.runtime.snapshot().log[0].retried, undefined);
  assert.equal(fake.runtime.snapshot().log[0].status, 'ok');
});

test('the memory is per runtime, "as the model decides" never retries, and a second failure is reported', async t => {
  const fake = setup(t);
  fake.runtime.updateSettings({ reasoning: 'auto' });
  fake.respond(() => { throw Object.assign(new Error('Bad request'), { status: 400 }); });
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(fake.calls.requests.length, 1); assert.deepEqual(fake.calls.requests[0][4], {});
  assert.equal(fake.runtime.snapshot().log[0].status, 'failed');

  fake.runtime.updateSettings({ reasoning: 'low' });
  await fake.runtime.refresh();
  assert.equal(fake.calls.requests.length, 3);
  const [entry] = fake.runtime.snapshot().log;
  assert.equal(entry.status, 'failed'); assert.equal(entry.retried, 'no-reasoning'); assert.equal(entry.error, 'Bad request');
  assert.equal(data(fake).lastRun.ok, false); assert.equal(data(fake).lastRun.error, label('runFailed', 'ru'));

  // Other errors are not retried.
  const other = createFakeST(), runtime = createRuntime(other.getContext);
  runtime.start(); t.after(() => runtime.dispose());
  other.respond(() => { throw new Error('offline'); });
  other.add(); await runtime.refresh();
  assert.equal(other.calls.requests.length, 1);
});

test('a cut reply names the current max tokens in the status and the log', async t => {
  const fake = setup(t);
  fake.runtime.updateSettings({ maxTokens: 6000 });
  fake.respond('<sable_state>{"world":{"location":"Har');
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  const expected = 'Ответ обрезан: модель не дописала JSON. Увеличьте «Макс. токенов» (сейчас 6000) или уменьшите размышления';
  assert.equal(data(fake).lastRun.ok, false); assert.equal(data(fake).lastRun.error, expected);
  assert.equal(fake.runtime.snapshot().log[0].status, 'invalid'); assert.equal(fake.runtime.snapshot().log[0].error, expected);
  fake.runtime.updateSettings({ language: 'en' });
  fake.respond({ content: '<sable_state>{"world":{"location":"Harbour"}' });
  await fake.runtime.refresh();
  assert.match(data(fake).lastRun.error, /^The reply was cut: .*Raise Max tokens \(now 6000\)/);
});

test('an empty reply reports a possible content filter', async t => {
  const fake = setup(t);
  fake.respond('');
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await fake.runtime.idle();
  assert.equal(data(fake).lastRun.error, 'Модель вернула пустой ответ (фильтр содержимого?)');
  assert.equal(fake.runtime.snapshot().log[0].error, 'Модель вернула пустой ответ (фильтр содержимого?)');
  fake.runtime.updateSettings({ language: 'en' });
  fake.respond({ content: null }); await fake.runtime.refresh();
  assert.equal(data(fake).lastRun.error, 'The model returned nothing (content filter?)');
  // Plain garbage keeps the generic message.
  fake.respond('no state here'); await fake.runtime.refresh();
  assert.equal(data(fake).lastRun.error, label('runFailed', 'en'));
});

test('helpers: rejection detection, output problems and the max tokens default', () => {
  assert.ok(isParameterRejection(Object.assign(new Error('x'), { status: 400 })));
  assert.ok(isParameterRejection(new Error('Unsupported parameter: reasoning_effort')));
  assert.ok(isParameterRejection(new Error('Invalid request for this model')));
  assert.ok(isParameterRejection(new Error('REASONING is not allowed')));
  assert.ok(!isParameterRejection(new Error('offline')));
  assert.ok(!isParameterRejection(Object.assign(new Error('reasoning'), { name: 'AbortError' })));
  const parse = text => outputProblem(text, parseStateOutput(text, ['world']));
  assert.equal(parse(''), 'empty'); assert.equal(parse('  \n'), 'empty'); assert.equal(parse(null), 'empty');
  assert.equal(parse('<sable_state>{"world":{"location":"A"'), 'cut');
  assert.equal(parse('<sable_state>{"world": nope}</sable_state>'), 'cut');
  assert.equal(parse(answer('A')), null); assert.equal(parse('garbage'), null);
  assert.equal(DEFAULTS.maxTokens, 8000);
  assert.equal(normalizeSettings({}).maxTokens, 8000);
  assert.equal(normalizeSettings({ maxTokens: 3000 }).maxTokens, 3000);
  assert.match(label('hint.maxTokens', 'en'), /Reasoning tokens count against it/);
});
