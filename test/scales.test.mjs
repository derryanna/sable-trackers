import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { BOND_SCALES, BOND_SCALE_HINTS, FRICTION_SCALES, SECTION_MAP, bondScales, bondsSection, getAllSections, getSections, normalizeBondScales } from '../src/sections.js';
import { normalizeSettings, saveSettings, GROUP_IDS } from '../src/settings.js';
import { buildPrompt, getPromptTexts } from '../src/prompt.js';
import { parseStateOutput, sanitizeSection } from '../src/parse.js';
import { mergeState } from '../src/merge.js';
import { buildDigest } from '../src/digest.js';
import { createDrawer } from '../src/ui/drawer.js';
import { createPanel } from '../src/ui/panel.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

// Today's bonds instruction, copied literally: the default rebuilt text must stay byte-for-byte equal (SPEC §20).
const TODAY = 'Independent scales toward the named target only: affection = emotional attachment, not necessarily romance; trust = confidence and willingness to rely; desire = attraction toward toward, not love or general arousal; love = romantic feelings toward toward (being in love), distinct from affection and from desire; reputation = how this NPC rates toward, not global fame; suspicion = suspicion toward toward; respect = respect for toward; fear = fear of toward; grudge = resentment toward toward, not general anger; tension = current tension with toward, which can drop independently of affection. Known scores are integers 0-100: 0 means known absence, null means unknown. Do not fill everything with 50. Keep the previous known value without new basis; derive new starting values cautiously from canon. A scale absent from PREVIOUS STATE is new: give it a starting value from canon and shown behaviour instead of null. Change by at most 10 per reply unless a clearly major event warrants more; no automatic affection growth. desire = null for minors, without sexual interpretations; love = null for minors as well. changes contains changed scales only, with short concrete reasons; return {} if unchanged.';
const jealousy = { key: 'jealousy', title: 'Ревность', hint: 'jealousy toward toward', friction: true };
const custom = { bondScales: { off: ['reputation'], custom: [jealousy] } };
const statKeys = section => Object.keys(section.schema.item.fields.stats.fields);

test('bond scale normaliser: off ⊂ built-ins, custom keys validated, capped and coerced', () => {
  assert.deepEqual(normalizeBondScales(undefined), { off: [], custom: [] });
  assert.deepEqual(normalizeBondScales({ off: ['fear', 'bogus', 'fear', 7, 'trust'] }).off, ['fear', 'trust']);
  const result = normalizeBondScales({ custom: [
    { key: 'jealousy', title: '  Ревность  ', hint: ' h ', friction: 1 },
    { key: 'jealousy', title: 'Duplicate' }, { key: 'trust', title: 'Built-in collision' },
    { key: 'Bad', title: 'x' }, { key: '1st', title: 'x' }, { key: 'a', title: 'too short' }, { key: 'abcdefghijklmnopq', title: 'too long' },
    { key: 'empty', title: '   ' }, null, 'str',
    { key: 'long_title', title: 'x'.repeat(40), hint: 'y'.repeat(250), friction: 'no' },
  ] });
  assert.deepEqual(result.custom.map(item => item.key), ['jealousy', 'long_title']);
  assert.deepEqual(result.custom[0], { key: 'jealousy', title: 'Ревность', hint: 'h', friction: true });
  assert.equal(result.custom[1].title.length, 30);
  assert.equal(result.custom[1].hint.length, 200);
  assert.equal(typeof result.custom[1].friction, 'boolean');
  const many = Array.from({ length: 9 }, (_, i) => ({ key: `s${i}x`, title: `S${i}` }));
  assert.equal(normalizeBondScales({ custom: many }).custom.length, 6);
  const settings = normalizeSettings({ bondScales: { off: ['respect', 'respect'], custom: [jealousy, { key: 'fear', title: 'x' }] } });
  assert.deepEqual(settings.bondScales, { off: ['respect'], custom: [jealousy] });
  assert.deepEqual(normalizeSettings({}).bondScales, { off: [], custom: [] });
  assert.equal(GROUP_IDS[GROUP_IDS.indexOf('sections') + 1], 'scales');
});

test('bondScales: built-ins minus off in canonical order, then custom; descriptors carry hints and friction', () => {
  assert.deepEqual(bondScales({}).map(s => s.key), BOND_SCALES);
  assert.deepEqual(FRICTION_SCALES, ['suspicion', 'fear', 'grudge', 'tension']);
  const scales = bondScales({ bondScales: { off: ['tension', 'affection'], custom: [jealousy] } });
  assert.deepEqual(scales.map(s => s.key), ['trust', 'desire', 'love', 'reputation', 'suspicion', 'respect', 'fear', 'grudge', 'jealousy']);
  assert.deepEqual(scales[0], { key: 'trust', builtin: true, title: 'trust', hint: BOND_SCALE_HINTS.trust, friction: false });
  assert.equal(scales.find(s => s.key === 'fear').friction, true);
  assert.deepEqual(scales.at(-1), { ...jealousy, builtin: false });
});

test('the bonds section follows the settings: stats fields = active keys, rebuilt definitions', () => {
  assert.equal(SECTION_MAP.bonds.instructions, TODAY);
  assert.equal(bondsSection({}), SECTION_MAP.bonds);
  assert.equal(getSections({}).find(s => s.id === 'bonds').instructions, TODAY);
  assert.equal(getPromptTexts(normalizeSettings({}), getAllSections(normalizeSettings({}))).sections.bonds, TODAY);
  const section = getSections(custom).find(s => s.id === 'bonds');
  assert.equal(getAllSections(custom).find(s => s.id === 'bonds').instructions, section.instructions);
  assert.deepEqual(statKeys(section), [...BOND_SCALES.filter(k => k !== 'reputation'), 'jealousy']);
  assert.doesNotMatch(section.instructions, /reputation =/);
  assert.match(section.instructions, /tension = current tension with toward, which can drop independently of affection; jealousy = jealousy toward toward\. Known scores/);
  // Without a hint, the title tells the side model what the scale is.
  const untitled = bondsSection({ bondScales: { custom: [{ key: 'pride', title: 'Гордость' }] } });
  assert.match(untitled.instructions, /pride = Гордость\. /);
  const built = buildPrompt({ settings: normalizeSettings(custom), sections: getSections(normalizeSettings(custom)), dueSections: ['bonds'] });
  assert.match(built.messages[0].content, /jealousy = jealousy toward toward/);
  assert.match(built.messages[0].content, /"jealousy":\{"type":"score"\}/);
  assert.doesNotMatch(built.messages[0].content, /"reputation"/);
  // An instruction override still replaces the whole text.
  const overridden = normalizeSettings({ ...custom, prompts: { sections: { bonds: 'Own text.' } } });
  assert.equal(getPromptTexts(overridden, getSections(overridden)).sections.bonds, 'Own text.');
  assert.equal(normalizeSettings({ ...custom, prompts: { sections: { bonds: section.instructions } } }).prompts.sections.bonds, undefined, 'the rebuilt default is not an override');
});

test('sanitize drops a switched-off scale and keeps a custom one; merge and digest follow the active keys', () => {
  const sections = getSections(custom), section = sections.find(s => s.id === 'bonds');
  const [bond] = sanitizeSection(section, [{ id: 'maren', name: 'Maren', stats: { trust: 30, reputation: 40, jealousy: 55 }, changes: { jealousy: { delta: 5, reason: 'r' } } }]);
  assert.deepEqual(bond.stats, { trust: 30, jealousy: 55 });
  const previous = { bonds: [{ id: 'maren', name: 'Maren', stats: { trust: 30, reputation: 40, jealousy: 50 }, changes: {} }] };
  const parsed = parseStateOutput(`<sable_state>${JSON.stringify({ bonds: [{ id: 'maren', name: 'Maren', stats: { trust: 30, reputation: 60, jealousy: 58 }, changes: { jealousy: { delta: 8, reason: 'saw the letter' } } }] })}</sable_state>`, ['bonds'], sections);
  const merged = mergeState(previous, parsed, { sections, requestedSections: ['bonds'] });
  assert.deepEqual(merged.bonds[0].stats, { trust: 30, jealousy: 58 }, 'reputation is gone from the next state');
  assert.deepEqual(merged.bonds[0].changes, { jealousy: { delta: 8, reason: 'saw the letter' } });
  // Without a registry the built-in set still applies.
  const legacy = mergeState({ bonds: [{ id: 'a', stats: { trust: 1, jealousy: 1 } }] }, { bonds: [{ id: 'a', stats: { trust: 5, jealousy: 9 } }] });
  assert.deepEqual(legacy.bonds[0].changes, { trust: { delta: 4, reason: '(recomputed)' } });
  const state = { bonds: [{ id: 'maren', name: 'Maren', stats: { trust: 30, reputation: 40, jealousy: 58 }, changes: {} }] };
  const text = buildDigest(state, { bonds: 'inject' }, { sections, language: 'en' });
  assert.match(text, /trust 30, jealousy 58/);
  assert.doesNotMatch(text, /reputation/);
  assert.match(buildDigest(state, { bonds: 'inject' }, { language: 'en' }), /reputation 40/, 'default registry prints every built-in');
});

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
function drawerSetup(t, settings) {
  const dom = new JSDOM('<body><div id="chat"></div><div id="extensions-settings-button"><button class="drawer-toggle"></button></div><div id="extensionsMenu"></div></body>', { pretendToBeVisual: true });
  const fake = createFakeST(); fake.add();
  const state = structuredClone(fixture);
  state.bonds[0].stats.jealousy = 70; state.bonds[0].changes.jealousy = { delta: 4, reason: 'a letter' };
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 1, state }] };
  Object.assign(fake.ctx.extensionSettings.sableTrackers, settings);
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document: dom.window.document });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  return { dom, fake, runtime, ui, document: dom.window.document };
}

test('drawer: active rows only, custom title and friction tint; the editor shows the custom field', t => {
  const { document, runtime } = drawerSetup(t, structuredClone(custom));
  const bonds = () => document.querySelector('[data-section="bonds"]');
  let card = bonds();
  const keys = [...card.querySelectorAll('details.st-sable-scale')].map(row => row.dataset.key.split(':').at(-1));
  assert.deepEqual(keys, ['affection', 'trust', 'suspicion', 'respect', 'fear', 'grudge', 'tension', 'jealousy']);
  const row = card.querySelector('[data-key="bonds:maren:jealousy"]');
  assert.equal(row.querySelector('.st-sable-scale-name').textContent, 'Ревность');
  assert.ok(row.querySelector('.st-sable-bar').classList.contains('st-sable-friction'));
  assert.ok(card.querySelector('[data-key="bonds:maren:trust"] .st-sable-bar').classList.contains('st-sable-affinity'));
  card.querySelector('[data-control="edit"]').click();
  card = bonds();
  const labels = [...card.querySelectorAll('.st-sable-editor-label')].map(label => label.textContent);
  assert.ok(labels.includes('Ревность'));
  assert.ok(!labels.includes('Репутация'));
  // Switching a scale back on brings its row back.
  card.querySelector('.st-sable-editor-cancel').click();
  runtime.updateSettings({ bondScales: { off: [], custom: [{ ...jealousy, friction: false }] } });
  card = bonds();
  assert.ok(card.querySelector('[data-key="bonds:maren:reputation"]'));
  assert.ok(card.querySelector('[data-key="bonds:maren:jealousy"] .st-sable-bar').classList.contains('st-sable-affinity'));
});

test('reply panel badges follow the active scales with custom titles', t => {
  const { document, fake, runtime, ui } = drawerSetup(t, { bondScales: { off: ['trust'], custom: [jealousy] } });
  const mes = document.createElement('div'); mes.className = 'mes'; mes.setAttribute('mesid', '0'); mes.setAttribute('is_user', 'false');
  mes.innerHTML = '<div class="mes_text">x</div>'; document.querySelector('#chat').append(mes);
  runtime.snapshot().store.ring[0].stale = false;
  const panel = createPanel(runtime, ui, { document, getContext: fake.getContext });
  t.after(() => panel.dispose());
  const badges = () => [...document.querySelectorAll('.st-sable-panel-badge')].map(badge => badge.textContent);
  assert.deepEqual(badges(), ['Maren: +4 Ревность']);
  runtime.updateSettings({ bondScales: { off: [], custom: [] } });
  assert.deepEqual(badges(), ['Maren: +5 Доверие']);
});

function settingsSetup(t, settings = {}) {
  const dom = new JSDOM('<body><div id="extensions_settings2"></div></body>');
  const fake = createFakeST();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { language: 'en' }, settings);
  const runtime = createRuntime(fake.getContext); runtime.start();
  const patches = [];
  const ui = createSettings({ ...runtime, updateSettings(patch) { patches.push(patch); runtime.updateSettings(patch); } },
    { document: dom.window.document, getContext: fake.getContext });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const group = ui.element.querySelector('[data-group="scales"]');
  const fire = (element, type = 'change') => element.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  return { dom, runtime, patches, group, fire, document: dom.window.document };
}

test('settings: built-in checkboxes write the whole off array; the rebuild hint is shown in both languages', t => {
  const { runtime, patches, group, fire } = settingsSetup(t);
  assert.equal(group.querySelector('summary').textContent, 'Bond scales');
  const boxes = [...group.querySelectorAll('input[data-scale]')];
  assert.deepEqual(boxes.map(box => box.dataset.scale), BOND_SCALES);
  assert.ok(boxes.every(box => box.checked));
  assert.equal(boxes[4].parentElement.textContent, 'Reputation — how the NPC rates the target, not fame');
  assert.match(group.textContent, /rebuilt from the enabled scales/);
  boxes[6].checked = false; fire(boxes[6]);
  boxes[4].checked = false; fire(boxes[4]);
  assert.deepEqual(patches.at(-1), { bondScales: { off: ['reputation', 'respect'], custom: [] } });
  boxes[6].checked = true; fire(boxes[6]);
  assert.deepEqual(runtime.snapshot().settings.bondScales.off, ['reputation']);
  assert.ok(!boxes[4].checked);
  const danger = group.parentElement.querySelector('textarea[name="prompts.bonds"]');
  assert.doesNotMatch(danger.value, /reputation =/, 'the Danger zone shows the rebuilt default');
  assert.match(danger.value, /respect = respect for toward/);
  runtime.updateSettings({ language: 'ru' });
  assert.equal(group.querySelector('summary').textContent, 'Шкалы отношений');
  assert.equal(boxes[4].parentElement.textContent, 'Репутация — как NPC оценивает цель, не слава');
  assert.match(group.textContent, /своя инструкция в «Опасной зоне» заменяет её целиком/);
});

test('settings: custom scale rows write the whole custom array, validate keys, cap at 6 and delete in two taps', t => {
  const { runtime, patches, group, fire, document } = settingsSetup(t);
  const add = group.querySelector('[data-control="add-scale"]');
  add.click();
  assert.deepEqual(runtime.snapshot().settings.bondScales.custom, [{ key: 'custom1', title: 'New scale', hint: '', friction: false }]);
  const row = () => group.querySelectorAll('.st-sable-scale-custom')[0];
  assert.equal(document.activeElement, row().querySelector('[name="title"]'), 'the new row focuses its title');
  const title = row().querySelector('[name="title"]'); title.value = 'Jealousy'; fire(title);
  const hint = row().querySelector('[name="hint"]'); hint.value = 'jealousy toward toward'; fire(hint);
  const friction = row().querySelector('[name="friction"]'); friction.checked = true; fire(friction);
  const key = row().querySelector('[name="key"]'); key.value = 'jealousy'; fire(key);
  assert.deepEqual(patches.at(-1), { bondScales: { off: [], custom: [{ key: 'jealousy', title: 'Jealousy', hint: 'jealousy toward toward', friction: true }] } });
  // A bad or colliding key stays in the input, marked, and is not saved.
  const before = patches.length;
  for (const bad of ['Bad key', 'trust']) {
    key.value = bad; fire(key);
    assert.equal(key.getAttribute('aria-invalid'), 'true');
    assert.equal(row().querySelector('.st-sable-invalid-hint').hidden, false);
  }
  assert.equal(patches.length, before);
  runtime.updateSettings({ spoilers: false });
  assert.equal(key.value, 'trust', 'kept across renders');
  key.value = 'envy'; fire(key);
  assert.equal(key.getAttribute('aria-invalid'), 'false');
  assert.equal(runtime.snapshot().settings.bondScales.custom[0].key, 'envy');
  for (let i = 0; i < 5; i++) add.click();
  assert.equal(runtime.snapshot().settings.bondScales.custom.length, 6);
  assert.deepEqual(runtime.snapshot().settings.bondScales.custom.map(item => item.key), ['envy', 'custom1', 'custom2', 'custom3', 'custom4', 'custom5']);
  assert.equal(add.disabled, true);
  assert.match(group.textContent, /At most 6 custom scales/);
  const remove = row().querySelector('.st-sable-custom-actions button');
  remove.click();
  assert.equal(remove.textContent, 'Delete for good?');
  assert.equal(runtime.snapshot().settings.bondScales.custom.length, 6, 'the first tap only arms');
  remove.click();
  assert.deepEqual(runtime.snapshot().settings.bondScales.custom.map(item => item.key), ['custom1', 'custom2', 'custom3', 'custom4', 'custom5']);
  assert.equal(group.querySelectorAll('.st-sable-scale-custom').length, 5);
  assert.equal(row().querySelector('[name="key"]').value, 'custom1');
  assert.equal(add.disabled, false);
});

test('saveSettings replaces bondScales whole', () => {
  const fake = createFakeST();
  saveSettings(fake.ctx, { bondScales: { off: ['fear'], custom: [jealousy] } });
  const next = saveSettings(fake.ctx, { bondScales: { off: ['trust'] } });
  assert.deepEqual(next.bondScales, { off: ['trust'], custom: [] });
});
