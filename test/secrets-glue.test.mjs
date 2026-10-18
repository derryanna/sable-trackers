import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeST } from './fakes/st.mjs';
import { createRuntime, SECRETS_REGEX_NAME } from '../src/run.js';
import { saveSettings, loadSettings } from '../src/settings.js';
import { buildSecretsPrompt } from '../src/digest.js';
import { buildPrompt } from '../src/prompt.js';
import { SECTIONS } from '../src/sections.js';
import { cleanMessage } from '../src/clean.js';

// SPEC §36: the story model's notebook arrives as a tail block, is cut from the reply on arrival, kept in the ring entry
// and sent back as its own prompt. Synthetic lighthouse story: Maren, Tomas, the visitor.
function setup(t, patch = {}) {
  const fake = createFakeST();
  saveSettings(fake.ctx, { sections: { secrets: { mode: 'inject' } }, ...patch });
  const runtime = createRuntime(fake.getContext);
  runtime.start();
  t.after(() => runtime.dispose());
  return { ...fake, runtime };
}
const secretsPrompt = fake => fake.calls.prompts.filter(call => call[0] === 'sable_trackers_secrets').at(-1)?.[1];
const digestPrompt = fake => fake.calls.prompts.filter(call => call[0] === 'sable_trackers').at(-1)?.[1];
const PROSE = 'Maren wiped the wet knife and set it on the shelf.';
const BLOCK = [
  '<sable_secrets>',
  "+ T1: Maren cut the boat's rope herself | hidden from: Tomas, the visitor | comes out when: the logbook page is found | changes: Tomas stops trusting her",
  'clue T1: the knife on the shelf is wet',
  '</sable_secrets>',
].join('\n');
const reply = `${PROSE}\n\n${BLOCK}`;
async function receive(fake, mes, type = 'normal', extra = {}) {
  const id = fake.add(mes, { swipe_id: 0, swipes: [mes], ...extra });
  await fake.emit('MESSAGE_RECEIVED', id, type);
  await fake.runtime.idle();
  return id;
}

test('the block is cut from mes and swipes, kept in the entry, injected as its own prompt and absent from the digest', async t => {
  const fake = setup(t), { runtime, ctx } = fake;
  const id = await receive(fake, reply);
  assert.equal(ctx.chat[id].mes, PROSE);
  assert.equal(ctx.chat[id].swipes[0], PROSE);
  const entry = runtime.snapshot().entry;
  assert.equal(entry.mesId, id);
  assert.equal(entry.state.secrets.truths.length, 1);
  const [truth] = entry.state.secrets.truths;
  assert.equal(truth.id, 'T1');
  assert.deepEqual(truth.hiddenFrom, ['Tomas', 'the visitor']);
  assert.equal(truth.clues[0].found, true);
  assert.equal(truth.clues[0].mesId, id);
  // The side model ran for the other sections and the merge kept the notebook.
  assert.equal(fake.calls.requests.length, 1);
  assert.equal(entry.state.world.location, 'Observatory');
  assert.doesNotMatch(fake.calls.requests[0][1].map(m => m.content).join('\n'), /secrets|SECRETS|sable_secrets/);
  const prompt = secretsPrompt(fake);
  assert.match(prompt, /^\[Тайны сюжета — только для автора\. Живые: T1 «Maren cut the boat's rope herself» \(скрыто от: Tomas, the visitor; выйдет: the logbook page is found; меняет: Tomas stops trusting her\)\n/);
  assert.match(prompt, /<sable_secrets>…<\/sable_secrets>/);
  assert.doesNotMatch(digestPrompt(fake), /rope herself/);
  // The notebook prompt is set before the digest, so the digest stays the last call.
  assert.equal(fake.calls.prompts.at(-1)[0], 'sable_trackers');
});

test('show and off cut and keep the block too, but send no notebook prompt', async t => {
  for (const mode of ['show', 'off']) {
    const fake = setup(t, { sections: { secrets: { mode } } });
    const id = await receive(fake, reply);
    assert.equal(fake.ctx.chat[id].mes, PROSE);
    assert.equal(fake.runtime.snapshot().entry.state.secrets.truths[0].text, "Maren cut the boat's rope herself");
    assert.equal(secretsPrompt(fake), '');
  }
});

test('without a side-model profile the notebook is still kept and sent', async t => {
  const fake = setup(t, { profileId: '' });
  const id = await receive(fake, reply);
  assert.equal(fake.calls.requests.length, 0);
  assert.equal(fake.ctx.chat[id].mes, PROSE);
  assert.equal(fake.runtime.snapshot().entry.state.secrets.truths.length, 1);
  assert.match(secretsPrompt(fake), /T1 «Maren cut the boat's rope herself»/);
});

test('a swipe starts from the notebook before the reply; swiping back shows that swipe\'s own notebook', async t => {
  const fake = setup(t), { runtime, ctx } = fake;
  await receive(fake, reply);
  fake.add('What about the key?', { is_user: true });
  const second = `Tomas pockets the key.\n<sable_secrets>\n+ T2: Tomas hid the chapel key | hidden from: Maren\n</sable_secrets>`;
  const id = await receive(fake, second);
  assert.match(secretsPrompt(fake), /T1 «Maren cut/);
  assert.match(secretsPrompt(fake), /T2 «Tomas hid the chapel key»/);
  // The user swipes: the new reply is based on the state before this message, so T2 is gone and a new T2 appears.
  const swiped = `Tomas burns a letter.\n<sable_secrets>\n+ T2: Tomas forged the will | hidden from: Maren\n</sable_secrets>`;
  ctx.chat[id].swipe_id = 1; ctx.chat[id].swipes.push(swiped); ctx.chat[id].mes = swiped;
  await fake.emit('MESSAGE_SWIPED', id);
  await fake.emit('MESSAGE_RECEIVED', id, 'swipe'); await runtime.idle();
  assert.equal(ctx.chat[id].mes, 'Tomas burns a letter.');
  assert.equal(ctx.chat[id].swipes[1], 'Tomas burns a letter.');
  const prompt = secretsPrompt(fake);
  assert.match(prompt, /T2 «Tomas forged the will»/);
  assert.doesNotMatch(prompt, /hid the chapel key/);
  // Back to the first swipe: its own notebook returns.
  ctx.chat[id].swipe_id = 0; ctx.chat[id].mes = ctx.chat[id].swipes[0];
  await fake.emit('MESSAGE_SWIPED', id);
  assert.match(secretsPrompt(fake), /hid the chapel key/);
  assert.doesNotMatch(secretsPrompt(fake), /forged the will/);
});

test('while the last reply is being regenerated the notebook from before it is sent', async t => {
  const fake = setup(t);
  await receive(fake, reply);
  fake.add('Go on.', { is_user: true });
  await receive(fake, `Tomas pockets the key.\n<sable_secrets>\n+ T2: Tomas hid the chapel key | hidden from: Maren\n</sable_secrets>`);
  await fake.emit('GENERATION_STARTED', 'regenerate');
  assert.match(secretsPrompt(fake), /T1 «Maren cut/);
  assert.doesNotMatch(secretsPrompt(fake), /hid the chapel key/);
  await fake.emit('GENERATION_STARTED', 'normal');
  assert.match(secretsPrompt(fake), /hid the chapel key/);
});

test('a continue re-cuts the block and applies only the lines that are new', async t => {
  const fake = setup(t), { runtime, ctx } = fake;
  const id = await receive(fake, reply);
  const more = `${ctx.chat[id].mes}\nShe did not look up.\n${BLOCK.replace('</sable_secrets>', 'clue T1: she will not say the word rope\n</sable_secrets>')}`;
  ctx.chat[id].mes = more; ctx.chat[id].swipes[0] = more;
  await fake.emit('MESSAGE_RECEIVED', id, 'continue'); await runtime.idle();
  assert.equal(ctx.chat[id].mes, `${PROSE}\nShe did not look up.`);
  const { truths } = runtime.snapshot().entry.state.secrets;
  assert.equal(truths.length, 1);
  assert.deepEqual(truths[0].clues.map(clue => clue.text), ['the knife on the shelf is wet', 'she will not say the word rope']);
});

test('a notebook two replies behind the chat is not sent; one reply behind still is', async t => {
  const fake = setup(t, { profileId: '' }), { runtime } = fake;
  const id = await receive(fake, reply);
  fake.add('Hm.', { is_user: true }); fake.add('Maren says nothing.');
  runtime.publish();
  assert.match(secretsPrompt(fake), /T1 «Maren cut/);
  fake.add('And?', { is_user: true }); fake.add('The lamp goes out.');
  runtime.publish();
  assert.equal(secretsPrompt(fake), '');
  assert.equal(runtime.snapshot().entry.mesId, id);
});

test('the side-model request is byte-identical with the secrets section on or off', () => {
  const chat = [{ is_user: true, mes: 'Hello' }, { mes: 'The lamp is lit.' }];
  const on = buildPrompt({ modes: { secrets: 'inject' }, chat, previousState: { secrets: { next: 2, truths: [{ id: 'T1', text: 'x', hiddenFrom: ['a'] }] } } });
  const off = buildPrompt({ modes: { secrets: 'off' }, chat, previousState: {} });
  assert.deepEqual(on.messages, off.messages);
  assert.ok(!on.requestedSections.includes('secrets'));
  assert.ok(SECTIONS.some(section => section.id === 'secrets' && section.source === 'main'));
  assert.equal(cleanMessage('prose <sable_secrets>+ T1: x | hidden from: a</sable_secrets> tail'), 'prose tail');
});

test('buildSecretsPrompt: no truths, one truth in English, a rules override; revealed truths are left out', () => {
  const none = buildSecretsPrompt(undefined, { language: 'ru' });
  assert.match(none, /^\[Тайны сюжета — только для автора\. Живых тайн пока нет\.\nДержи историю согласной с ними\./);
  assert.match(none, /Читатель этот блок не видит\.\]$/);
  const secrets = { next: 3, truths: [
    { id: 'T1', text: 'the key opens the lamp room', hiddenFrom: ['Tomas'], when: '', changes: '', clues: [], createdMesId: 1, revealedMesId: null },
    { id: 'T2', text: 'old news', hiddenFrom: [], when: '', changes: '', clues: [], createdMesId: 1, revealedMesId: 4, revealedHow: 'out' },
  ] };
  const en = buildSecretsPrompt(secrets, { language: 'en' });
  assert.match(en, /^\[Story secrets — for the author only\. Live: T1 «the key opens the lamp room» \(hidden from: Tomas\)\nKeep the story consistent with them\./);
  assert.doesNotMatch(en, /old news/);
  assert.equal(buildSecretsPrompt(secrets, { language: 'en', rules: 'Custom rules.' }), '[Story secrets — for the author only. Live: T1 «the key opens the lamp room» (hidden from: Tomas)\nCustom rules.]');
});

test('switching the section to inject installs the display regex once; the button adds it again', t => {
  const fake = setup(t, { sections: { secrets: { mode: 'off' } } }), { runtime, ctx } = fake;
  runtime.setMode('secrets', 'inject', false);
  const scripts = ctx.extensionSettings.regex;
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].scriptName, SECRETS_REGEX_NAME);
  assert.equal(scripts[0].markdownOnly, true);
  assert.equal(scripts[0].promptOnly, false);
  assert.deepEqual(scripts[0].placement, [2]);
  assert.ok(scripts[0].findRegex.startsWith('/<sable_secrets>') && scripts[0].findRegex.endsWith('/i'));
  assert.equal(loadSettings(ctx).secretsRegexInstalled, true);
  runtime.setMode('secrets', 'off', false); runtime.setMode('secrets', 'inject', false);
  assert.equal(scripts.length, 1);
  // Deleted by the user: never re-added on its own, only through the button.
  scripts.length = 0;
  runtime.setMode('secrets', 'off', false); runtime.setMode('secrets', 'inject', false);
  assert.equal(scripts.length, 0);
  assert.equal(runtime.installSecretsRegex({ force: true }), 'added');
  assert.equal(runtime.installSecretsRegex({ force: true }), 'exists');
  assert.equal(scripts.length, 1);
  assert.deepEqual(ctx.extensionSettings.otherExtension, { untouched: true });
});
