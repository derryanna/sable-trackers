import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SECTIONS, getSections, getAllSections, isPackSectionId } from '../src/sections.js';
import { BUILTIN_PACKS, getPacks, normalizePacks, packSections, packScopeOf } from '../src/packs/index.js';
import { copyPack, exportPack, importPack } from '../src/packs/io.js';
import { roll, formatRoll } from '../src/packs/dice.js';
import { sanitizeSection, parseStateOutput } from '../src/parse.js';
import { mergeState } from '../src/merge.js';
import { buildDigest } from '../src/digest.js';
import { buildPrompt, getPromptTexts, COMMON_RULES } from '../src/prompt.js';
import { normalizeSettings, saveSettings, loadSettings } from '../src/settings.js';
import { loadStore, enabledPacks } from '../src/store.js';
import { createRuntime } from '../src/run.js';
import { t, STRINGS } from '../src/i18n.js';
import { createFakeST } from './fakes/st.mjs';

const userPack = () => ({ id: 'p_0123abcd', title: 'Resources', icon: '📦', description: 'Supplies', scope: true,
  rules: 'Resource rules. {{scope}}', sections: [{ key: 'stock', title: 'Stock', icon: 'fa-box', shape: 'stats', instructions: 'Stock instructions. {{scope}}' }] });
const all = getAllSections({ language: 'en' });
const stats = all.find(s => s.id === 'combat_stats');
const tags = all.find(s => s.id === 'combat_effects');

test('final built-in content is bounded, localized and keeps the adult and scope guards', () => {
  const scoped = new Set(['combat_stats', 'combat_effects', 'combat_odds', 'intimacy_arousal', 'intimacy_counters', 'intimacy_marks']);
  const guard = 'Every participant must be an established adult; otherwise return empty values. Invent nothing.';
  for (const pack of BUILTIN_PACKS) {
    for (const text of [pack.rules, ...pack.sections.map(s => s.instructions)]) {
      assert.ok(text.length > 0 && text.length <= 2000);
      if (pack.id === 'intimacy') assert.ok(text.includes(guard));
    }
    assert.ok(pack.rules.includes('{{scope}}'));
    for (const s of pack.sections) assert.equal(s.instructions.includes('{{scope}}'), scoped.has(`${pack.id}_${s.key}`));
    for (const lang of ['ru', 'en']) {
      for (const key of [pack.title, pack.description, ...pack.sections.map(s => s.title)]) {
        assert.ok(Object.hasOwn(STRINGS[lang], key), `${lang}: ${key}`);
        assert.ok(STRINGS[lang][key].trim());
      }
      assert.ok(STRINGS[lang][pack.description].length <= 300);
    }
  }
});

test('final pack prompts expand every scope and place due rules after common rules', () => {
  for (const choice of ['all', 'user', 'others']) {
    const settings = { language: 'en', packScope: { combat: choice, intimacy: choice } };
    const sections = getSections(settings, ['combat', 'intimacy']);
    const sentence = choice === 'all' ? 'Track every participant present in the scene.'
      : choice === 'user' ? "Track only the user's character, Traveller; other participants are not tracked."
        : "Track every participant except the user's character, Traveller; never record or imply the user's own state, feelings or responses.";
    const expand = text => text.replaceAll('{{scope}}', sentence);
    const system = buildPrompt({ settings, sections, packs: BUILTIN_PACKS, name1: 'Traveller' }).messages[0].content;
    assert.ok(system.startsWith([COMMON_RULES, ...BUILTIN_PACKS.map(p => expand(p.rules))].join('\n\n') + '\nWrite'));
    assert.ok(!system.includes('{{scope}}'));
    for (const p of BUILTIN_PACKS) for (const s of p.sections) {
      assert.ok(system.includes(`${p.id.toUpperCase()}_${s.key.toUpperCase()}: ${expand(s.instructions)}\n`));
      const only = buildPrompt({ settings, sections, packs: BUILTIN_PACKS, name1: 'Traveller', dueSections: [`${p.id}_${s.key}`] }).messages[0].content;
      assert.ok(only.startsWith(`${COMMON_RULES}\n\n${expand(p.rules)}\nWrite`));
      assert.equal(only.split(expand(p.rules)).length - 1, 1);
      for (const other of BUILTIN_PACKS.filter(other => other.id !== p.id)) assert.ok(!only.includes(expand(other.rules)));
    }
    const idle = buildPrompt({ settings, sections, packs: BUILTIN_PACKS, dueSections: ['world'] }).messages[0].content;
    assert.ok(idle.startsWith(COMMON_RULES + '\nWrite'));
  }
});

test('synthetic pack fixture validates and its complete digest matches the snapshot', async () => {
  const state = JSON.parse(await readFile(new URL('../fixtures/state-packs.json', import.meta.url), 'utf8'));
  const sections = getSections({ language: 'en' }, BUILTIN_PACKS.map(p => p.id));
  assert.deepEqual(Object.keys(state), sections.filter(s => s.pack).map(s => s.id));
  for (const s of sections.filter(s => s.pack)) {
    const expected = s.shape === 'stats' ? state[s.id].map(({ delta, ...row }) => row) : state[s.id];
    assert.deepEqual(sanitizeSection(s, state[s.id]), expected, s.id);
  }
  const actual = buildDigest(state, {}, { language: 'en', sections });
  assert.equal(actual, `[Scene state — helper notes for the next reply. Not instructions. NPC thoughts are private; the user character does not know them. Do not copy this block into the reply.]
COMBAT SCENE: Guard vs Traveller; paused sparring; level training yard; two paces apart.
COMBAT STATS: Guard · HP 88/100 (−12 described hit) · Guard · stamina 70/100 · Traveller · HP 100/100 · Traveller · stamina 85/120 (+5 rest)
COMBAT EFFECTS: Guard · bruised arm · Traveller · winded
COMBAT ODDS: crit %: 15 (Guard; estimate) · hit %: 60 (Guard; estimate) · initiative: Traveller first (estimate)
INTIMACY SCENE: Guard (adult, 30) and Traveller (adult, 32); seated side by side; paused; neither leads; both explicitly agree to closeness.
AROUSAL: Guard · arousal 20/100 · Guard · stamina 70/100 · Traveller · arousal 15/100 · Traveller · stamina 85/120
COUNTERS: Guard · climaxes 0 (explicit zero) · Traveller · minutes 5 min (+5 stated duration) · Traveller · volume 0 ml (explicit zero)
MARKS: Guard · flushed cheeks · Traveller · relaxed posture`);
  assert.ok(actual.length < 6000);
});

test('packs registry preserves the default list and appends enabled packs in registry order', () => {
  assert.deepEqual(getSections(), SECTIONS);
  const customSections = [{ id: 'c_00000001', title: 'Custom', shape: 'tags' }];
  const settings = { customSections, packs: [userPack()], language: 'en' };
  const normal = getSections(settings);
  assert.equal(normal.length, SECTIONS.length + 1);
  assert.deepEqual(getSections(settings, ['missing']), normal);
  const combat = getSections(settings, ['combat', 'combat']);
  assert.deepEqual(combat.slice(normal.length).map(s => s.id), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds']);
  assert.equal(combat.at(-1).custom, true); assert.equal(combat.at(-1).pack, 'combat');
  assert.deepEqual(getSections(settings, ['intimacy', 'combat']).slice(normal.length).map(s => s.id), all.slice(SECTIONS.length).map(s => s.id));
  assert.equal(getAllSections(settings).length, normal.length + 9);
  assert.ok(isPackSectionId('p_0123abcd_stock', settings));
  assert.ok(!isPackSectionId('p_deadbeef_stock', settings));
  assert.ok(!isPackSectionId('combat_unknown', settings));
  assert.deepEqual(all.slice(SECTIONS.length).map(s => [s.id, s.shape, s.schema.max]), [
    ['combat_scene', 'text', 600], ['combat_stats', 'stats', 12], ['combat_effects', 'tags', 10], ['combat_odds', 'kv', 6],
    ['intimacy_scene', 'text', 600], ['intimacy_arousal', 'stats', 8], ['intimacy_counters', 'stats', 8], ['intimacy_marks', 'tags', 10],
  ]);
  for (const p of BUILTIN_PACKS) {
    assert.equal(p.scope, true);
    for (const lang of ['ru', 'en']) for (const key of [p.title, p.description, ...p.sections.map(s => s.title)]) assert.notEqual(t(key, lang), key);
    assert.ok(p.sections.every(s => s.mode === 'inject' && s.period === 1));
  }
  assert.ok(!all.some(s => s.id === 'combat_roll'));
  assert.match(BUILTIN_PACKS[1].rules, /established adult.*empty values/);
  assert.match(BUILTIN_PACKS[1].sections[2].instructions, /max: null/);
});

test('user pack normalization is bounded, rejects invalid identities and sections, and is idempotent', () => {
  const p = userPack();
  p.title = ' Title '; p.description = 'x'.repeat(400); p.rules = 'r'.repeat(2100); p.extra = true;
  p.sections = [null, { ...p.sections[0], key: 'Bad' }, { ...p.sections[0], shape: 'bad' },
    { ...p.sections[0], title: '  ' }, { ...p.sections[0], max: 40, period: -2, mode: 'bad', extra: true },
    { ...p.sections[0], title: 'duplicate' }, ...Array.from({ length: 10 }, (_, i) => ({ ...p.sections[0], key: `s${i}`, icon: '<img>', max: 0 }))];
  const normalized = normalizePacks([null, {}, { ...p, id: 'combat' }, { ...p, id: 'p_ABCDEF00' }, { ...p, title: '' },
    { ...p, sections: [] }, p, { ...p, title: 'duplicate pack' }]);
  assert.equal(normalized.length, 1); const [pack] = normalized;
  assert.equal(pack.title, 'Title'); assert.equal(pack.description.length, 300); assert.equal(pack.rules.length, 2000);
  assert.equal(pack.sections.length, 8); assert.equal(pack.sections[0].max, 20);
  assert.equal(pack.sections[0].mode, 'inject'); assert.equal(pack.sections[0].period, 1);
  assert.equal(pack.sections[1].max, 1); assert.equal(pack.sections[1].icon, '');
  assert.equal(pack.extra, undefined); assert.equal(pack.sections[0].extra, undefined);
  assert.equal(JSON.stringify(normalizePacks(normalized)), JSON.stringify(normalized));
  assert.equal(normalizePacks([userPack()])[0].icon, '📦');
  assert.equal(normalizePacks([{ ...userPack(), icon: '📦📦', scope: 'true' }])[0].scope, false);
  assert.equal(normalizePacks([{ ...userPack(), icon: '📦📦' }])[0].icon, '');
});

test('stats sanitization drops untrusted keys and invalid items, deduplicates and caps valid rows', () => {
  const xss = '<img src=x onerror=alert(1)>';
  const input = [null, {}, { key: ' ', value: 1 }, { key: 'bad', value: '4' }, { key: 'null', value: null },
    { key: 'nan', value: NaN }, { key: 'inf', value: Infinity },
    { key: ' HP ', value: 10000.2, max: 10000.5, unit: 'u'.repeat(12), note: xss, delta: 999, extra: 'drop' },
    { key: 'HP', value: 5 }, { key: xss, value: -4, max: 0 }, { key: 'rounded', value: 4.6 },
    ...Array.from({ length: 20 }, (_, i) => ({ key: `item${i}`, value: i, max: null }))];
  const value = sanitizeSection(stats, input);
  assert.equal(value.length, 12);
  assert.deepEqual(value.slice(0, 3), [{ key: 'HP', value: 9999, max: 9999, unit: 'uuuuuuuu', note: xss },
    { key: xss, value: 0, max: 1 }, { key: 'rounded', value: 5, max: null }]);
  assert.equal(sanitizeSection(stats, {}), undefined);
  const long = sanitizeSection(stats, [{ key: 'k'.repeat(60), value: 1, note: 'n'.repeat(140), max: 'bad' }])[0];
  assert.equal(long.key.length, 40); assert.equal(long.note.length, 120); assert.equal(long.max, null);
  const parsed = parseStateOutput(JSON.stringify({ combat_stats: input }), ['combat_stats'], all);
  assert.equal(parsed.sections.combat_stats[0].delta, undefined);
  const custom = getSections({ customSections: [{ id: 'c_00000001', shape: 'stats', max: 2 }] }).at(-1);
  assert.equal(custom.shape, 'stats'); assert.equal(sanitizeSection(custom, input).length, 2);
});

test('tags trim, keep text, deduplicate and cap valid items for packs and custom sections', () => {
  assert.deepEqual(sanitizeSection(tags, [' bleeding ', '', 3, null, 'bleeding', '<b>stunned</b>']), ['bleeding', '<b>stunned</b>']);
  assert.equal(sanitizeSection(tags, Array.from({ length: 20 }, (_, i) => `tag${i}`)).length, 10);
  assert.deepEqual(sanitizeSection(tags, ['a'.repeat(41), 'a'.repeat(40)]), ['a'.repeat(40)]);
  const custom = getSections({ customSections: [{ id: 'c_00000001', shape: 'tags', max: 1 }] }).at(-1);
  assert.deepEqual(sanitizeSection(custom, ['a', 'b']), ['a']);
});

test('stats replace rows and compute deltas by key; digest matches canonical stats and tags lines', () => {
  const previous = { combat_stats: [{ key: 'HP', value: 52 }, { key: 'stamina', value: 70 }, { key: 'removed', value: 3 }], combat_roll: 'retained' };
  const incoming = { combat_stats: [{ key: 'HP', value: 40, max: 100, note: 'blade cut' }, { key: 'stamina', value: 70, max: 100 }, { key: 'climaxes', value: 2, max: null }], combat_effects: ['bleeding', 'stunned'] };
  const merged = mergeState(previous, incoming, { sections: all });
  assert.deepEqual(merged.combat_stats.map(s => s.delta), [-12, 0, undefined]);
  assert.equal(merged.combat_roll, 'retained'); assert.equal(previous.combat_stats[0].value, 52);
  assert.ok(!Object.hasOwn(mergeState({}, incoming, { sections: all }).combat_stats[0], 'delta'));
  assert.ok(!Object.hasOwn(merged.combat_stats[2], 'delta'));
  const sections = [{ ...stats, title: 'Title' }, { ...tags, title: 'Title' }];
  assert.deepEqual(buildDigest(merged, {}, { sections, language: 'en' }).split('\n').slice(1), [
    'TITLE: HP 40/100 (−12 blade cut) · stamina 70/100 · climaxes 2', 'TITLE: bleeding · stunned',
  ]);
  assert.match(buildDigest({ combat_stats: [{ key: 'fuel', value: 4, max: null, unit: 'ml', delta: 2, note: 'added' },
    { key: 'time', value: 1, note: 'elapsed' }] }, {}, { sections }), /fuel 4 ml \(\+2 added\) · time 1 \(elapsed\)/);
  assert.ok(buildDigest(merged, {}, { sections, maxChars: 200 }).length <= 200);
  assert.ok(!buildDigest(merged, { combat_stats: 'show', combat_effects: 'off' }, { sections }).includes('TITLE:'));
});

test('settings normalize all known pack ids, overrides, scopes and partial patches idempotently', () => {
  const p = userPack(), settings = normalizeSettings({ packs: [p], packDefaults: ['missing', p.id, 'combat', p.id],
    packScope: { combat: 'user', intimacy: 'bad', [p.id]: 'all', missing: 'user' },
    sections: { combat_stats: { mode: 'show', period: 3 }, [p.id + '_stock']: { mode: 'off', period: 2 }, ghost_stats: { mode: 'inject' } },
    order: ['combat_stats', p.id + '_stock', 'ghost_stats'], folded: { combat_stats: true, [p.id + '_stock']: false, ghost_stats: true },
    visual: { cardColors: { combat_stats: '#abc', [p.id + '_stock']: '#123456', ghost_stats: '#fff' } },
    prompts: { packs: { combat: ' New rules ', intimacy: BUILTIN_PACKS[1].rules, [p.id]: 'ignore', missing: 'ignore' },
      sections: { combat_stats: ' Stats override ', intimacy_scene: BUILTIN_PACKS[1].sections[0].instructions, [p.id + '_stock']: 'ignore' } } });
  assert.equal(JSON.stringify(normalizeSettings(settings)), JSON.stringify(settings));
  assert.deepEqual(settings.packDefaults, [p.id, 'combat']);
  assert.deepEqual(settings.packScope, { combat: 'user', [p.id]: 'all' });
  assert.deepEqual(settings.prompts.packs, { combat: 'New rules' });
  assert.deepEqual(settings.prompts.sections, { combat_stats: 'Stats override' });
  assert.deepEqual(settings.sections.combat_stats, { mode: 'show', period: 3 });
  assert.deepEqual(settings.sections.intimacy_scene, { mode: 'inject', period: 1 });
  assert.equal(settings.sections.ghost_stats, undefined);
  assert.deepEqual(settings.order.slice(0, 2), ['combat_stats', p.id + '_stock']);
  assert.ok(!settings.order.includes('ghost_stats'));
  assert.deepEqual(settings.folded, { combat_stats: true, [p.id + '_stock']: false });
  assert.deepEqual(settings.visual.cardColors, { combat_stats: '#aabbcc', [p.id + '_stock']: '#123456' });
  assert.equal(packSections(BUILTIN_PACKS[0], settings)[1].instructions, 'Stats override');
  assert.equal(getPromptTexts(settings).packs[p.id], p.rules);
  const { ctx, calls } = createFakeST(); ctx.extensionSettings.sableTrackers = settings;
  loadSettings(ctx); loadSettings(ctx); assert.equal(calls.settings, 0);
  saveSettings(ctx, { packScope: { combat: 'all' }, prompts: { packs: { intimacy: 'Other rules' } }, sections: { combat_stats: { mode: 'off' } } });
  assert.deepEqual(loadSettings(ctx).packScope, { combat: 'all', [p.id]: 'all' });
  assert.deepEqual(loadSettings(ctx).prompts.packs, { combat: 'New rules', intimacy: 'Other rules' });
  assert.equal(loadSettings(ctx).sections.combat_stats.period, 3);
  saveSettings(ctx, { prompts: { packs: { combat: null }, sections: { combat_stats: null } }, packs: [], packDefaults: ['intimacy'] });
  const saved = loadSettings(ctx);
  assert.deepEqual(saved.prompts.packs, { intimacy: 'Other rules' }); assert.deepEqual(saved.prompts.sections, {});
  assert.deepEqual(saved.packs, []); assert.deepEqual(saved.packDefaults, ['intimacy']);
  assert.ok(!saved.order.includes(p.id + '_stock')); assert.equal(saved.visual.cardColors[p.id + '_stock'], undefined);
});

test('pack rules are due-only paragraphs in order; scope expands only pack text and schema excludes delta', () => {
  const settings = normalizeSettings({ packs: [userPack()], packScope: { combat: 'user' }, prompts: {
    rules: 'Common {{scope}}', packs: { combat: 'Combat rules. {{scope}}' }, sections: { combat_stats: 'Stats {{scope}}' } } });
  const sections = getAllSections(settings), packs = getPacks(settings);
  const result = buildPrompt({ settings, sections, packs: [...packs, packs[0]], name1: 'Player', dueSections: ['combat_stats', 'combat_scene', 'p_0123abcd_stock'],
    previousState: { combat_stats: [{ key: 'HP', value: 4, delta: -2 }] } });
  const system = result.messages[0].content;
  assert.ok(system.startsWith("Common {{scope}}\n\nCombat rules. Track only the user's character, Player; other participants are not tracked.\n\nResource rules. Track every participant present in the scene.\nWrite"));
  assert.equal(system.split('Combat rules.').length, 2); assert.ok(!system.includes(BUILTIN_PACKS[1].rules));
  assert.match(system, /COMBAT_STATS: Stats Track only the user's character, Player/);
  const schema = JSON.parse(system.split('OUTPUT SCHEMA:\n')[1]);
  assert.deepEqual(Object.keys(schema.combat_stats.item.fields), ['key', 'value', 'max', 'unit', 'note']);
  assert.ok(!JSON.stringify(result.messages).includes('delta'));
  assert.equal(buildPrompt({ sections, packs, dueSections: ['world'] }).messages[0].content.startsWith(COMMON_RULES + '\nWrite'), true);
  const defaultScope = buildPrompt({ sections: all, packs: BUILTIN_PACKS, dueSections: ['combat_stats'] }).messages[0].content;
  assert.match(defaultScope, /COMBAT_STATS: Track every participant present in the scene\./);
  assert.ok(buildPrompt({ settings, sections, packs, name1: '$& Player', dueSections: ['combat_stats'] }).messages[0].content.includes("character, $& Player;"));
  const off = buildPrompt({ settings, sections: getSections(settings), packs });
  assert.ok(!JSON.stringify(off).includes('combat_stats')); assert.ok(!JSON.stringify(off).includes('Combat rules.'));
});

test('store fallback and runtime pack toggles persist, publish immediately and never start a run', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext); t.after(() => runtime.dispose()); fake.add();
  runtime.updateSettings({ language: 'en', packDefaults: ['combat'] });
  const data = loadStore(fake.ctx); assert.ok(!Object.hasOwn(data, 'packs'));
  assert.deepEqual(enabledPacks(data, { packDefaults: ['intimacy', 'combat', 'combat', 'missing'] }), ['combat', 'intimacy']);
  assert.deepEqual(runtime.snapshot().packs.enabled, ['combat']);
  assert.equal(runtime.snapshot().packs.available[0].title, 'Combat');
  assert.equal(runtime.snapshot().packs.available[0].builtin, true);
  assert.equal(runtime.snapshot().packs.available[0].scope, true);
  assert.equal(runtime.editState('combat_stats', [{ key: 'HP', value: 40, max: 100 }]), true);
  assert.match(fake.calls.prompts.at(-1)[1], /COMBAT STATS: HP 40\/100/);
  assert.equal(runtime.setPack('missing', true), false);
  assert.equal(runtime.setPack('combat', false), true);
  await Promise.resolve(); assert.ok(fake.calls.metadata.length > 0);
  assert.deepEqual(data.packs, []); assert.deepEqual(runtime.snapshot().packs.enabled, []);
  assert.equal(runtime.snapshot().modes.combat_stats, undefined);
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('COMBAT'));
  assert.equal(runtime.snapshot().entry.state.combat_stats[0].value, 40);
  assert.ok(!JSON.stringify(runtime.preview()).includes('combat_stats'));
  assert.equal(runtime.editState('combat_roll', 'no'), false);
  runtime.updateSettings({ packDefaults: ['intimacy'] }); assert.deepEqual(runtime.snapshot().packs.enabled, []);
  runtime.setPack('combat', true); assert.match(fake.calls.prompts.at(-1)[1], /COMBAT STATS/);
  assert.equal(fake.calls.requests.length, 0);
  const before = JSON.stringify(fake.ctx.chatMetadata), publishes = fake.calls.prompts.length;
  const preview = runtime.preview(); assert.ok(preview.requestedSections.includes('combat_stats'));
  assert.equal(JSON.stringify(fake.ctx.chatMetadata), before); assert.equal(fake.calls.prompts.length, publishes);
  fake.respond(JSON.stringify({ combat_stats: [{ key: 'HP', value: 35, max: 100 }] }));
  await runtime.refresh(); assert.deepEqual(fake.calls.requests[0][1], preview.messages);
  runtime.setMode('combat_stats', 'show'); assert.equal(runtime.snapshot().modes.combat_stats, 'show');
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('COMBAT STATS'));
  runtime.setMode('combat_stats', 'off', true); assert.equal(runtime.snapshot().modes.combat_stats, 'off');
  assert.ok(!runtime.preview().requestedSections.includes('combat_stats'));
  runtime.setMode('combat_stats', null, true); assert.equal(runtime.snapshot().modes.combat_stats, 'show');
});

test('pack periods and modes apply to built-in and user sections, and disabled values survive runs', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext); t.after(() => runtime.dispose());
  const p = userPack(); p.sections[0].period = 2;
  runtime.updateSettings({ packs: [p], packDefaults: [p.id, 'combat'],
    sections: Object.fromEntries(getAllSections({ packs: [p] }).map(s => [s.id, { mode: ['combat_stats', p.id + '_stock'].includes(s.id) ? 'inject' : 'off', period: 2 }])) });
  fake.respond(JSON.stringify({ combat_stats: [{ key: 'HP', value: 50 }], [p.id + '_stock']: [{ key: 'stock', value: 3 }] }));
  await runtime.run(fake.add()); assert.equal(fake.calls.requests.length, 0);
  await runtime.run(fake.add()); assert.equal(fake.calls.requests.length, 1);
  assert.equal(runtime.snapshot().entry.state.combat_stats[0].value, 50);
  assert.equal(runtime.snapshot().entry.state[p.id + '_stock'][0].value, 3);
  runtime.setPack('combat', false);
  await runtime.run(fake.add()); await runtime.run(fake.add());
  assert.equal(fake.calls.requests.length, 2);
  assert.ok(!JSON.stringify(fake.calls.requests.at(-1)[1]).includes('combat_stats'));
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('HP'));
  assert.equal(runtime.snapshot().entry.state.combat_stats[0].value, 50);
  runtime.setPack('combat', true); assert.match(fake.calls.prompts.at(-1)[1], /HP 50/);
});

test('pack IO resolves copies, round-trips and regenerates colliding ids without mutating inputs', () => {
  const copy = copyPack(BUILTIN_PACKS[0], { random: () => 0, lang: 'en' });
  assert.equal(copy.id, 'p_00000000'); assert.equal(copy.title, 'Combat'); assert.equal(copy.sections[1].title, 'Combat stats');
  assert.equal(copy.rules, BUILTIN_PACKS[0].rules); assert.equal(copy.builtin, undefined);
  assert.equal(copyPack(copy, { random: () => 0 }).id, 'p_00000001');
  const exported = exportPack(copy), imported = importPack(JSON.stringify(exported), []);
  assert.deepEqual(imported, { pack: copy });
  const collision = importPack(exported, [copy], { random: () => 0 });
  assert.equal(collision.pack.id, 'p_00000001'); assert.equal(copy.id, 'p_00000000');
  assert.deepEqual(importPack({ ...exported, pack: BUILTIN_PACKS[0] }, []), { error: 'builtin-id' });
  for (const bad of ['oops', {}, { ...exported, version: 2 }]) assert.deepEqual(importPack(bad), { error: 'format' });
  assert.deepEqual(importPack({ ...exported, pack: {} }), { error: 'invalid' });
  const unknown = importPack({ ...exported, pack: { ...copy, surprise: true } }).pack;
  assert.equal(unknown.surprise, undefined);
  const builtinExport = exportPack(BUILTIN_PACKS[1]);
  assert.match(builtinExport.pack.id, /^p_[0-9a-f]{8}$/); assert.equal(builtinExport.pack.title, t(BUILTIN_PACKS[1].title));
  assert.ok(importPack(builtinExport).pack);
});

test('refresh preserves cached disabled pack values when replacing the current ring entry', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext); t.after(() => runtime.dispose()); fake.add();
  runtime.setPack('combat', true); runtime.editState('combat_scene', 'Stored scene'); runtime.setPack('combat', false);
  await runtime.refresh();
  assert.equal(runtime.snapshot().entry.state.combat_scene, 'Stored scene');
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('Stored scene'));
  runtime.setPack('combat', true); assert.ok(fake.calls.prompts.at(-1)[1].includes('Stored scene'));
});

test('local dice use injectable randomness and canonical hit/miss lines', () => {
  assert.deepEqual(roll(15, () => 0.86), { roll: 87, chance: 15, hit: false });
  assert.equal(formatRoll(roll(15, () => 0.86), 'crit'), 'ROLL: 87 vs crit 15 → miss (resolve the next action with it)');
  assert.equal(formatRoll(roll(15, () => 0.14), 'crit'), 'ROLL: 15 vs crit 15 → hit (resolve the next action with it)');
  assert.equal(roll(0, () => 0).roll, 1); assert.equal(roll(100, () => 0.99999).roll, 100);
});

test('scope defaults, overrides and normalization retain exactly the three choices', () => {
  const [combat, intimacy] = BUILTIN_PACKS;
  assert.equal(packScopeOf({}, combat), 'all'); assert.equal(packScopeOf({}, intimacy), 'others');
  for (const choice of ['all', 'user', 'others']) {
    const pack = normalizePacks([{ ...userPack(), scopeDefault: choice }])[0];
    assert.equal(packScopeOf({}, pack), choice);
    assert.equal(copyPack(pack).scopeDefault, choice);
    const settings = normalizeSettings({ packs: [pack], packScope: { combat: choice, intimacy: 'bad', [pack.id]: choice, missing: choice } });
    assert.deepEqual(settings.packScope, { combat: choice, [pack.id]: choice });
    assert.deepEqual(normalizeSettings(settings), settings);
    assert.equal(packScopeOf(settings, combat), choice);
    const prompt = buildPrompt({ settings, sections: getAllSections(settings), packs: getPacks(settings), userName: '$& Player' }).messages[0].content;
    assert.ok(prompt.includes("Track every participant except the user's character, $& Player; never record or imply the user's own state, feelings or responses."));
    assert.ok(!prompt.includes('{{scope}}'));
  }
  assert.equal(normalizePacks([userPack()])[0].scopeDefault, 'all');
  assert.equal(normalizePacks([{ ...userPack(), scopeDefault: 'bad' }])[0].scopeDefault, 'all');
  const settings = normalizeSettings({});
  const prompt = buildPrompt({ settings, sections: getAllSections(settings), packs: BUILTIN_PACKS, userName: 'Player' }).messages[0].content;
  assert.match(prompt, /COMBAT_STATS: Track every participant present in the scene\./);
  assert.match(prompt, /INTIMACY_AROUSAL: .*Track every participant except the user's character, Player;/);
});

test('rollDice validates, clamps, persists and publishes independently of section state', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext, { random: () => .86 });
  t.after(() => runtime.dispose()); runtime.start();
  runtime.setPack('combat', true);
  assert.equal(Object.hasOwn(runtime.snapshot().store, 'roll'), false);
  assert.equal(runtime.rollDice('combat_odds', 'crit %', 15), false, 'no character message');
  fake.add(); fake.add('User turn', { is_user: true });
  for (const [id, key, chance] of [['missing', 'crit %', 15], ['combat_scene', 'crit %', 15],
    ['combat_roll', 'crit %', 15], ['combat_odds', '', 15], ['combat_odds', null, 15],
    ...[NaN, Infinity, -Infinity, '15', null].map(chance => ['combat_odds', 'crit %', chance])]) {
    assert.equal(runtime.rollDice(id, key, chance), false);
  }
  let published;
  const unsubscribe = runtime.subscribe(view => { published = view.store.roll; }); t.after(unsubscribe);
  const messages = structuredClone(fake.ctx.chat), result = runtime.rollDice('combat_odds', 'crit %', 15);
  assert.deepEqual(result, { sectionId: 'combat_odds', key: 'crit %', label: 'crit', chance: 15, roll: 87, hit: false, forMesId: 0, at: result.at });
  assert.ok(Number.isFinite(result.at)); assert.equal(published, result);
  assert.equal(runtime.snapshot().entry, undefined, 'a roll creates no ring entry');
  const line = 'ROLL: 87 vs crit 15 → miss (resolve the next action with it)';
  assert.ok(fake.calls.prompts.at(-1)[1].endsWith(line), 'roll injects even before any section state exists');
  const metadata = JSON.stringify(fake.ctx.chatMetadata), publishes = fake.calls.prompts.length;
  assert.equal(runtime.preview().injection, fake.calls.prompts.at(-1)[1]);
  assert.equal(JSON.stringify(fake.ctx.chatMetadata), metadata); assert.equal(fake.calls.prompts.length, publishes);
  assert.ok(!JSON.stringify(runtime.preview().messages).includes('ROLL:'), 'side-model request contains no roll field');
  assert.deepEqual(fake.ctx.chat, messages); assert.equal(fake.calls.requests.length, 0);
  await Promise.resolve(); assert.ok(fake.calls.metadata.length > 0);
  runtime.editState('combat_scene', 'Edited scene'); await runtime.refresh();
  assert.deepEqual(runtime.snapshot().store.roll, result, 'edits and refreshes leave the pending roll alone');
  assert.equal(runtime.rollDice('combat_stats', 'chance %', 200).chance, 100);
  assert.equal(runtime.rollDice('combat_stats', 'chance %', -20).chance, 0);
  runtime.setPack('combat', false);
  assert.equal(runtime.rollDice('combat_stats', 'chance %', 50), false, 'disabled pack is outside the current section list');
  runtime.updateSettings({ customSections: [{ id: 'c_00000001', title: 'Chance', shape: 'kv' }] });
  assert.equal(runtime.rollDice('c_00000001', 'luck %', 50).sectionId, 'c_00000001');
});

test('reply consumption survives swipes, deletions and chat switches without consuming twice', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext, { random: () => .1 });
  t.after(() => runtime.dispose()); runtime.start();
  runtime.updateSettings({ enabled: false }); // Consumption must not depend on a side-model run.
  fake.add(); fake.add(); const forMesId = fake.add();
  runtime.setPack('combat', true); runtime.rollDice('combat_odds', 'crit %', 15);
  const pending = structuredClone(runtime.snapshot().store.roll);
  await fake.emit('MESSAGE_RECEIVED', forMesId, 'continue');
  await fake.emit('MESSAGE_RECEIVED', fake.add('User', { is_user: true }));
  await fake.emit('MESSAGE_RECEIVED', fake.add('System', { is_system: true }));
  assert.deepEqual(runtime.snapshot().store.roll, pending);
  runtime.updateSettings({ enabled: true });
  const reply = fake.add();
  await fake.emit('MESSAGE_RECEIVED', reply, 'normal');
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('ROLL:'));
  await runtime.idle();
  const consumed = structuredClone(runtime.snapshot().store.roll);
  assert.deepEqual(consumed, { ...pending, consumedAt: consumed.consumedAt, consumedBy: reply });
  assert.ok(Number.isFinite(consumed.consumedAt));
  fake.ctx.chat[reply].swipe_id = 1;
  await fake.emit('MESSAGE_SWIPED', reply); await fake.emit('MESSAGE_RECEIVED', reply, 'swipe'); await runtime.idle();
  fake.ctx.chat[reply].swipe_id = 0;
  await fake.emit('MESSAGE_SWIPED', reply); await fake.emit('MESSAGE_RECEIVED', reply, 'swipe'); await runtime.idle();
  assert.deepEqual(runtime.snapshot().store.roll, consumed);
  assert.ok(!runtime.preview().injection.includes('ROLL:'));
  fake.ctx.chat.length = reply; await fake.emit('MESSAGE_DELETED', reply);
  assert.deepEqual(runtime.snapshot().store.roll, consumed, 'deleting only the consuming reply does not rearm it');
  const chatA = fake.ctx.chatMetadata;
  fake.ctx.chatMetadata = {}; fake.ctx.chatId = 'chat-b'; await fake.emit('CHAT_CHANGED');
  assert.equal(Object.hasOwn(runtime.snapshot().store, 'roll'), false);
  runtime.setPack('combat', true); runtime.rollDice('combat_odds', 'hit %', 80);
  const chatB = fake.ctx.chatMetadata;
  fake.ctx.chatMetadata = chatA; fake.ctx.chatId = 'chat-a'; await fake.emit('CHAT_CHANGED');
  assert.deepEqual(runtime.snapshot().store.roll, consumed);
  fake.ctx.chat.length = forMesId - 1; await fake.emit('MESSAGE_DELETED', fake.ctx.chat.length);
  assert.equal(Object.hasOwn(runtime.snapshot().store, 'roll'), false);
  fake.ctx.chatMetadata = chatB; fake.ctx.chatId = 'chat-b'; await fake.emit('CHAT_CHANGED');
  assert.equal(runtime.snapshot().store.roll.label, 'hit');
  assert.ok(fake.calls.prompts.at(-1)[1].includes('ROLL:'));
});

test('digest ignores legacy roll sections and budgets the pending roll as its last line', () => {
  const result = { ...roll(15, () => .86), label: 'crit' };
  const state = { combat_scene: 'x'.repeat(6000), combat_roll: 'LEGACY ROLL MUST NOT APPEAR' };
  const line = formatRoll(result, result.label);
  for (const maxChars of [200, 6000]) {
    const digest = buildDigest(state, {}, { sections: all, roll: result, maxChars });
    assert.ok(digest.endsWith('\n' + line)); assert.ok(digest.length <= maxChars);
    assert.ok(!digest.includes('LEGACY'));
  }
  assert.ok(!buildDigest(state, {}, { sections: all, roll: { ...result, consumedAt: 0 } }).includes('ROLL:'));
  assert.ok(buildDigest(state, {}, { sections: all, roll: { ...result, consumedAt: 0 }, rollArmed: true }).endsWith(line));
});

test('only the consuming reply arms a roll, and sending clears it before the next prompt', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext, { random: () => .1 });
  t.after(() => runtime.dispose()); runtime.start(); fake.add(); runtime.setPack('combat', true);
  runtime.rollDice('combat_odds', 'crit %', 15);
  const reply = fake.add(); await fake.emit('MESSAGE_RECEIVED', reply); await runtime.idle();
  const consumed = structuredClone(runtime.snapshot().store.roll);
  for (const swipeId of [1, 0]) {
    fake.ctx.chat[reply].swipe_id = swipeId;
    await fake.emit('MESSAGE_SWIPED', reply);
    assert.equal(runtime.snapshot().rollArmed, true);
    assert.ok(fake.calls.prompts.at(-1)[1].includes('ROLL:'));
    assert.ok(runtime.preview().injection.includes('ROLL:'));
    assert.deepEqual(runtime.snapshot().store.roll, consumed);
    if (swipeId === 1) {
      await fake.emit('MESSAGE_RECEIVED', reply, 'swipe'); await runtime.idle();
      assert.equal(runtime.snapshot().rollArmed, false);
      assert.ok(!fake.calls.prompts.at(-1)[1].includes('ROLL:'));
    }
  }
  // ST builds the next generation prompt after awaited MESSAGE_SENT listeners.
  let nextPrompt;
  fake.ctx.eventSource.on('MESSAGE_SENT', () => { nextPrompt = fake.calls.prompts.at(-1)[1]; });
  await fake.emit('MESSAGE_SENT', fake.add('Next action', { is_user: true }));
  assert.equal(runtime.snapshot().rollArmed, false);
  assert.ok(!nextPrompt.includes('ROLL:'));
  const later = fake.add(); await fake.emit('MESSAGE_RECEIVED', later); await runtime.idle();
  fake.ctx.chat[later].swipe_id = 1;
  await fake.emit('MESSAGE_SWIPED', later);
  assert.equal(runtime.snapshot().rollArmed, false);
  assert.ok(!fake.calls.prompts.at(-1)[1].includes('ROLL:'));
  assert.deepEqual(runtime.snapshot().store.roll, consumed);
});

for (const reset of ['deletion', 'chat change', 'new roll']) {
  test(`an armed roll is cleared by ${reset}`, async t => {
    const fake = createFakeST(), runtime = createRuntime(fake.getContext, { random: () => .1 });
    t.after(() => runtime.dispose()); runtime.start(); fake.add(); runtime.setPack('combat', true);
    runtime.rollDice('combat_odds', 'crit %', 15);
    const reply = fake.add(); await fake.emit('MESSAGE_RECEIVED', reply); await runtime.idle();
    const consumed = structuredClone(runtime.snapshot().store.roll);
    await fake.emit('MESSAGE_SWIPED', reply);
    assert.equal(runtime.snapshot().rollArmed, true);
    const saved = JSON.stringify(fake.ctx.chatMetadata);
    assert.ok(!saved.includes('rollArmed') && !saved.includes('"armed"'));
    if (reset === 'deletion') {
      fake.ctx.chat.length = reply; await fake.emit('MESSAGE_DELETED', reply);
    } else if (reset === 'chat change') {
      const metadata = fake.ctx.chatMetadata;
      fake.ctx.chatId = 'chat-b'; fake.ctx.chatMetadata = {}; await fake.emit('CHAT_CHANGED');
      fake.ctx.chatId = 'chat-a'; fake.ctx.chatMetadata = metadata; await fake.emit('CHAT_CHANGED');
    } else {
      runtime.rollDice('combat_odds', 'hit %', 80);
    }
    assert.equal(runtime.snapshot().rollArmed, false);
    if (reset === 'new roll') {
      assert.equal(runtime.snapshot().store.roll.consumedAt, undefined);
      assert.equal(runtime.snapshot().store.roll.consumedBy, undefined);
      assert.match(fake.calls.prompts.at(-1)[1], /ROLL: 11 vs hit 80/);
      assert.ok(!fake.calls.prompts.at(-1)[1].includes('vs crit'));
    } else {
      assert.deepEqual(runtime.snapshot().store.roll, consumed);
      assert.ok(!fake.calls.prompts.at(-1)[1].includes('ROLL:'));
    }
  });
}

test('received replies consume rolls even when generation is disabled or no profile exists', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext, { random: () => .1 });
  t.after(() => runtime.dispose()); runtime.start(); fake.add(); runtime.setPack('combat', true);
  for (const settings of [{ enabled: false }, { enabled: true, profileId: '' }]) {
    runtime.updateSettings(settings); runtime.rollDice('combat_odds', 'hit %', 60);
    await fake.emit('MESSAGE_RECEIVED', fake.add());
    assert.ok(Number.isFinite(runtime.snapshot().store.roll.consumedAt));
    assert.ok(!fake.calls.prompts.at(-1)[1].includes('ROLL:'));
  }
  assert.equal(fake.calls.requests.length, 0);
});
