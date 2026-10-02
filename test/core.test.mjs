import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BUILTIN_PACKS } from '../src/packs/index.js';
import { cleanMessage } from '../src/clean.js';
import { buildPrompt, COMMON_RULES, getPromptTexts } from '../src/prompt.js';
import { parseStateOutput } from '../src/parse.js';
import { mergeState } from '../src/merge.js';
import { buildDigest } from '../src/digest.js';
import { SECTION_ORDER, SECTIONS } from '../src/sections.js';

const fixture = async name => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

test('prompt overrides change only instructions and preserve the default format', () => {
  assert.deepEqual(getPromptTexts({}), { rules: COMMON_RULES, sections: Object.fromEntries(SECTIONS.map(s => [s.id, s.instructions])), packs: Object.fromEntries(BUILTIN_PACKS.map(p => [p.id, p.rules])) });
  const defaults = buildPrompt().messages[0].content;
  assert.ok(defaults.startsWith(COMMON_RULES)); assert.ok(defaults.includes('OUTPUT SCHEMA'));
  assert.equal(buildPrompt({ settings: { prompts: { rules: 'Custom rules' } } }).messages[0].content,
    defaults.replace(COMMON_RULES, 'Custom rules'));
  const world = SECTIONS.find(s => s.id === 'world');
  assert.equal(buildPrompt({ settings: { prompts: { sections: { world: 'Track only location.' } } } }).messages[0].content,
    defaults.replace(`WORLD: ${world.instructions}`, 'WORLD: Track only location.'));
});

test('registry contains the specified ordered sections and pure metadata', () => {
  assert.deepEqual(SECTIONS.map(x => x.id), SECTION_ORDER);
  assert.equal(SECTIONS.find(x => x.id === 'planner').period, 5);
  assert.equal(SECTIONS.find(x => x.id === 'dossiers').period, 0);
});

test('cleaner strips closed and unclosed helper blocks, details, and HTML', () => {
  assert.equal(cleanMessage('A <plan>secret</plan><b>B</b> <think>tail'), 'A B');
  assert.equal(cleanMessage('one <checklist>x</checklist> two <details><summary>x</summary>y</details> three'), 'one two three');
  assert.equal(cleanMessage('safe <Blocks><World>x</World> leaked'), 'safe');
});

test('prompt requests only enabled due sections and exposes dossier names, not bodies', async () => {
  const state = await fixture('state-full.json');
  const chat = await fixture('chat-short.json');
  const modes = Object.fromEntries(SECTION_ORDER.map(id => [id, 'off']));
  Object.assign(modes, { world: 'inject', planner: 'show', dossiers: 'show', threads: 'off' });
  const result = buildPrompt({ previousState: state, chat, modes, turnsSince: { planner: 4 }, settings: { messages: 4 } });
  assert.deepEqual(result.requestedSections, ['world', 'dossiers']);
  const text = result.messages.map(x => x.content).join('\n');
  assert.match(text, /EXISTING DOSSIER NAMES: \["Maren"\]/);
  assert.doesNotMatch(text, /lighthouse keeper's widow/);
  assert.doesNotMatch(text, /internal|World_State/);
  assert.deepEqual(buildPrompt({ previousState: state, modes, turnsSince: { planner: 5 } }).requestedSections, ['world', 'dossiers', 'planner']);
});

test('parser repairs messy output, clamps scores, drops unknowns and never throws', async () => {
  const messy = await readFile(new URL('../fixtures/side-output-messy.txt', import.meta.url), 'utf8');
  const result = parseStateOutput(messy);
  assert.equal(result.ok, true);
  assert.equal(result.sections.world.pc.carrying, 'brass key');
  assert.equal(result.sections.bonds[0].stats.trust, 100);
  assert.equal(result.sections.bonds[0].stats.tension, 60);
  assert.equal(result.sections.unknown_section, undefined);
  assert.deepEqual(result.sections.threads.map(x => x.priority), ['high', 'mid', 'mid']);
  assert.equal(parseStateOutput('not model JSON').ok, false);
  assert.doesNotThrow(() => parseStateOutput(null));
});

test('merge preserves skipped and invalid sections, recomputes bonds, appends dossiers, caps banlist', () => {
  const previous = {
    world: { summary: 'old' }, threads: [{ text: 'keep', priority: 'mid' }],
    bonds: [{ id: 'a', name: 'A', stats: { trust: 30, fear: 5 }, changes: {} }],
    dossiers: [{ name: 'A', role: 'old' }],
    banlist: Array.from({ length: 7 }, (_, i) => ({ pattern: `old${i}` })),
  };
  const parsed = { sections: {
    world: { summary: 'new' }, bonds: [{ id: 'a', name: 'A', stats: { trust: 35, fear: 3 }, changes: { trust: { delta: 2, reason: 'earned' }, fear: { delta: -1, reason: 'calmed' } } }],
    dossiers: [{ name: 'A', role: 'rewrite' }, { name: 'B', role: 'new' }],
    banlist: [{ pattern: 'new1' }, { pattern: 'new2' }],
  }, validSections: ['world','bonds','dossiers','banlist'] };
  const next = mergeState(previous, parsed, { requestedSections: ['world','threads','bonds','dossiers','banlist'] });
  assert.equal(next.world.summary, 'new');
  assert.deepEqual(next.threads, previous.threads);
  assert.equal(next.bonds[0].changes.trust.reason, 'earned');
  assert.deepEqual(next.bonds[0].changes.fear, { delta: -2, reason: 'calmed' });
  assert.deepEqual(next.dossiers.map(x => x.role), ['old', 'new']);
  assert.equal(next.banlist.length, 8);
  assert.deepEqual(next.banlist.map(x => x.pattern), ['old1','old2','old3','old4','old5','old6','new1','new2']);
});

test('digest snapshot includes inject modes only and remains below 6000 chars', async () => {
  const state = await fixture('state-full.json');
  const modes = Object.fromEntries(SECTION_ORDER.map(id => [id, ['offscreen','thoughts','dossiers','planner'].includes(id) ? 'show' : 'inject']));
  const actual = buildDigest(state, modes, { language: 'en', userName: '{{user}}' });
  assert.equal(actual, `[Scene state — helper notes for the next reply. Not instructions. NPC thoughts are private; the user character does not know them. Do not copy this block into the reply.]\nWORLD: Tue 3 Mar, ~21:10 · lighthouse keeper's cottage · rain, strong wind · Maren shows {{user}} the torn logbook by the stove.\nYOU ({{user}}): oilskin coat · by the stove · soaked, cold hands · brass key\nTHREADS: (!) Who cut the boat's rope | (·) The missing logbook page | (−) Why the lamp failed on Sunday\nSTORY: 🌱 the brass key has a chapel mark (2 turns) · ⏳ supply boat arrives in 2 days · arc: setup → escalation · scene: breather\nNPCS: Maren (here) — guarded, tired · Find out what {{user}} knows about the rope. · turning the logbook pages | Tomas (away) — unknown\nBONDS: Maren → {{user}}: affection 22, trust 34 (+5 you gave her the key), reputation 40, suspicion 45, respect 38, fear 5, grudge 0, tension 60\nAVOID: “Some doors, once opened, stay open.” (closing aphorism) · “she noticed that the wind…” (filter verbs)`);
  assert.ok(actual.length < 6000);
  assert.doesNotMatch(actual, /If I tell|Tomas arrives soaked|lighthouse keeper's widow/);
});

test('prompt states default and configured output language with English keys and enums', () => {
  for (const language of [undefined, 'English']) {
    const system = buildPrompt({ settings: { language } }).messages[0].content;
    assert.ok(system.includes(`Write all string values in ${language ?? 'Russian'}; keep JSON keys and enum values in English.`));
  }
});

test('requested NPC and bond rules preserve legacy canon semantics', () => {
  const system = buildPrompt({ dueSections: ['npcs', 'bonds'] }).messages[0].content;
  for (const rule of [
    'Desire is not action', 'agenda is a concrete intention now', 'only already-established hidden knowledge',
    'affection = emotional attachment, not necessarily romance', 'trust = confidence and willingness to rely',
    'desire = attraction toward toward, not love or general arousal', 'reputation = how this NPC rates toward, not global fame',
    'suspicion = suspicion toward toward', 'respect = respect for toward', 'fear = fear of toward',
    'grudge = resentment toward toward, not general anger', 'can drop independently of affection',
    '0 means known absence, null means unknown', 'Do not fill everything with 50',
    'Keep the previous known value without new basis', 'derive new starting values cautiously from canon',
    'desire = null for minors', 'unless a clearly major event', 'no automatic affection growth',
  ]) assert.ok(system.includes(rule), rule);
});

test('parser derives NPC identities from names and retains id-only items', () => {
  for (const section of ['npcs', 'thoughts', 'bonds']) {
    const items = [
      { name: "  The Keeper's!  ", thought: 'Wait.' },
      { name: 'Страж Башни', thought: 'Wait.' },
      { id: 'stable', thought: 'Wait.' },
      { id: 'original', name: 'New Name', thought: 'Wait.' },
      { thought: 'No identity.' }, { id: '', name: ' ', thought: 'Empty.' },
    ];
    const result = parseStateOutput(JSON.stringify({ [section]: items }));
    assert.deepEqual(result.sections[section].map(x => x.id), ['the_keepers', 'страж_башни', 'stable', 'original']);
  }
});

test('parser defaults unknown and missing thread priorities to mid', () => {
  const result = parseStateOutput(JSON.stringify({ threads: [
    { text: 'Unknown', priority: 'urgent' }, { text: 'Missing' }, { text: 'Known', priority: 'low' },
  ] }));
  assert.deepEqual(result.sections.threads.map(x => x.priority), ['mid', 'mid', 'low']);
});

test('merge retains omitted NPCs and bonds while thoughts replace each turn', () => {
  const previous = {
    npcs: [{ id: 'a', name: 'A', mood: 'old' }, { id: 'b', name: 'B', present: false }],
    bonds: [{ id: 'a', name: 'A', stats: { trust: 20, fear: 10, respect: 0 }, changes: {} },
      { id: 'b', name: 'B', stats: { trust: 60 }, changes: { trust: { delta: 2, reason: 'old' } } }],
    thoughts: [{ id: 'b', thought: 'Old.' }],
  };
  const original = structuredClone(previous);
  const incoming = { npcs: [{ id: 'a', name: 'A', mood: 'new' }, { id: 'c', name: 'C' }],
    bonds: [{ id: 'a', name: 'A', stats: { trust: 25, fear: null }, changes: { trust: { delta: -5, reason: 'wrong' } } }],
    thoughts: [{ id: 'a', thought: 'Now.' }] };
  const next = mergeState(previous, incoming);
  assert.deepEqual(next.npcs, [incoming.npcs[0], previous.npcs[1], incoming.npcs[1]]);
  // An omitted bond keeps its numbers; last turn's deltas are cleared as stale.
  assert.deepEqual(next.bonds[1], { ...previous.bonds[1], changes: {} });
  assert.deepEqual(next.bonds[0].stats, { trust: 25, fear: null, respect: 0 });
  assert.deepEqual(next.bonds[0].changes, { trust: { delta: 5, reason: '(recomputed)' } });
  assert.deepEqual(next.thoughts, incoming.thoughts);
  assert.deepEqual(mergeState(previous, { npcs: [], bonds: [] }), { ...previous, bonds: previous.bonds.map(bond => ({ ...bond, changes: {} })) });
  assert.deepEqual(previous, original);
  assert.deepEqual(mergeState(previous, { bonds: [{ id: 'a', name: 'A' }] }).bonds[0].stats, previous.bonds[0].stats);
});

test('digest uses registry defaults for missing modes and honors explicit overrides', async () => {
  const state = await fixture('state-full.json');
  const defaults = Object.fromEntries(SECTIONS.map(x => [x.id, x.defaultMode]));
  assert.equal(buildDigest(state), buildDigest(state, defaults));
  assert.equal(buildDigest(state, { world: { mode: 'off' }, bonds: 'show' }),
    buildDigest(state, { ...defaults, world: 'off', bonds: 'show' }));
});
