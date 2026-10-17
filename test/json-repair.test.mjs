import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, outputProblem, parseStateOutput, repairJson, salvageSections } from '../src/parse.js';
import { createFakeST } from './fakes/st.mjs';
import { createRuntime } from '../src/run.js';
import { t as label } from '../src/i18n.js';

const wrap = body => `<sable_state>${body}</sable_state>`;
const ALL = ['world', 'offscreen', 'threads', 'npcs'];
const parse = body => parseStateOutput(wrap(body), ALL);

test('a stray quote before an array item is repaired and the whole state is kept', () => {
  const body = '{"world":{"location":"Pier"},"npcs":[{"id":"a","name":"A","present":true},"{"id":"b","name":"B","present":false}]}';
  const parsed = parse(body);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.validSections, ['world', 'npcs']);
  assert.equal(parsed.sections.npcs.length, 2);
  assert.equal(parsed.sections.npcs[1].id, 'b');
  assert.ok(parsed.warnings.some(w => /Repaired JSON/.test(w)), parsed.warnings.join('; '));
  assert.equal(outputProblem(wrap(body), parsed), null);
});

test('a string value missing its closing quote before the item bracket is repaired', () => {
  const body = '{"world":{"location":"Pier"},"offscreen":[{"name":"A","doing":"Lab (recurring)},{"name":"B","doing":"Home"}]}';
  const parsed = parse(body);
  assert.ok(parsed.ok, parsed.warnings.join('; '));
  assert.equal(parsed.sections.offscreen.length, 2);
  assert.equal(parsed.sections.offscreen[0].doing, 'Lab (recurring)');
});

test('brackets left open at the end of a complete reply are closed', () => {
  const body = '{"world":{"location":"Pier"},"threads":[{"text":"Who sent the letter","priority":"high"}]';
  const parsed = parse(body);
  assert.ok(parsed.ok, parsed.warnings.join('; '));
  assert.equal(parsed.sections.threads[0].priority, 'high');
});

test('sections are salvaged one by one when the object as a whole cannot be repaired', () => {
  // offscreen never closes its array; npcs lacks a comma between two keys and is beyond repair.
  const body = '{"world":{"location":"Pier"},"offscreen":[{"name":"A","doing":"x"},"threads":[{"text":"y","priority":"low"}],'
    + '"npcs":[{"id":"a" "name":"A"}]}';
  const parsed = parse(body);
  assert.ok(parsed.ok, parsed.warnings.join('; '));
  assert.deepEqual(parsed.validSections, ['world', 'offscreen', 'threads']);
  assert.equal(parsed.sections.offscreen[0].name, 'A');
  assert.equal(parsed.sections.threads[0].text, 'y');
  assert.ok(parsed.warnings.some(w => /Salvaged sections: world, offscreen, threads; dropped: npcs/.test(w)), parsed.warnings.join('; '));
  const direct = salvageSections(body, ALL);
  assert.deepEqual(Object.keys(direct.sections), ['world', 'offscreen', 'threads']);
  assert.deepEqual(direct.dropped, ['npcs']);
});

test('more slips seen in the wild: doubled openers, typographic quotes, a lost brace, control characters, empty keys', () => {
  const cases = {
    'doubled opener {"{"': '{"npcs":[{"id":"a","name":"A"},{"{"id":"b","name":"B"}]}',
    'doubled quote {""': '{"npcs":[{"id":"a","name":"A"},{""id":"b","name":"B"}]}',
    'typographic quote before item': '{"npcs":[{"id":"a","name":"A"},’{"id":"b","name":"B"}]}',
    'lone quote between items': '{"npcs":[{"id":"a","name":"A"},’,{"id":"b","name":"B"}]}',
    'single-quoted key': '{"npcs":[{"id":"a","name":"A"},{"id":"b",\'name":"B"}]}',
    'item without its opening brace': '{"npcs":[{"id":"a","name":"A"},"id":"b","name":"B"}]}',
    'tab inside a string': '{"npcs":[{"id":"a","name":"A"},{"id":"b","name":"B\tB"}]}',
    'empty key before the bracket': '{"npcs":[{"id":"a","name":"A"},{"id":"b","name":"B",""}]}',
    'wrong closing bracket': '{"npcs":[{"id":"a","name":"A"},{"id":"b","name":"B"}}}',
    'bare word with a full-width colon': '{"npcs":[{"id":"a","name":"A"},{"id":"b",mood："","name":"B"}]}',
  };
  for (const [name, body] of Object.entries(cases)) {
    const parsed = parseStateOutput(wrap(body), ['npcs']);
    assert.ok(parsed.ok, `${name}: ${parsed.warnings.join('; ')}`);
    assert.equal(parsed.sections.npcs.length, 2, name);
    assert.equal(parsed.sections.npcs[1].id, 'b', name);
  }
});

test('salvage takes the balanced value, so unknown keys and prose after a section do not sink it', () => {
  const body = '{"world":{"location":"Pier"},"offscreen":[{"name":"A"}],"offscreen_note":null,"threads":[{"text":"y","priority":"low"}]} Veteran mode: keep fields verbatim';
  // The tail makes the whole text unparseable; each section still comes back.
  const parsed = parseStateOutput(wrap(body + '}'), ALL);
  assert.ok(parsed.ok, parsed.warnings.join('; '));
  assert.deepEqual(parsed.validSections, ['world', 'offscreen', 'threads']);
});

test('a truncated reply (no closing tag) is not repaired and still reads as cut', () => {
  const text = '<sable_state>{"world":{"location":"A"},"threads":[{"text":"t","priority":"mid"}';
  const parsed = parseStateOutput(text, ALL);
  assert.ok(!parsed.ok);
  assert.equal(outputProblem(text, parsed), 'cut');
});

test('a complete reply whose JSON cannot be recovered reads as broken, not cut', () => {
  const text = wrap('{"world": nope, "threads": nope}');
  const parsed = parseStateOutput(text, ALL);
  assert.ok(!parsed.ok);
  assert.equal(outputProblem(text, parsed), 'broken');
  assert.equal(repairJson('{"a" "b"}'), null);
});

test('valid JSON is never touched, even when it contains the repair patterns inside strings', () => {
  const body = '{"world":{"summary":"he wrote ,\\"{\\" and (x)}, then ] , } end"}}';
  assert.equal(extractJson(wrap(body)), body);
  const parsed = parse(body);
  assert.ok(parsed.ok);
  assert.equal(parsed.sections.world.summary, 'he wrote ,"{" and (x)}, then ] , } end');
  assert.deepEqual(parsed.warnings, []);
});

test('the runtime stores a repaired reply and reports a broken one with its own message', async t => {
  const fake = createFakeST();
  const runtime = createRuntime(fake.getContext);
  runtime.start();
  t.after(() => runtime.dispose());
  t.mock.method(console, 'warn', () => {});
  const data = () => fake.ctx.chatMetadata.sableTrackers;
  fake.respond(wrap('{"world":{"location":"Pier"},"npcs":[{"id":"a","name":"A","present":true},"{"id":"b","name":"B"}]}'));
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await runtime.idle();
  assert.equal(data().lastRun.ok, true);
  assert.equal(data().ring.at(-1).state.npcs.length, 2);
  fake.respond(wrap('{"world": nope}'));
  await fake.emit('MESSAGE_RECEIVED', fake.add(), 'normal'); await runtime.idle();
  assert.equal(data().lastRun.ok, false);
  assert.equal(data().lastRun.error, label('brokenOutput', 'ru'));
  assert.ok(!/Макс. токенов/.test(data().lastRun.error));
});
