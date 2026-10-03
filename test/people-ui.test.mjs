import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { normalizeSettings } from '../src/settings.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
const PEOPLE = ['npcs', 'thoughts', 'bonds', 'dossiers'];
function people() {
  const state = structuredClone(fixture);
  state.bonds[0].stats.jealousy = 30;
  state.dossiers = [{ name: 'Stranger', role: 'drifter', look: 'hooded' }, { ...state.dossiers[0], name: 'MAREN' }];
  return state;
}
function setup(t, settings = {}, state = people()) {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div><div id="extensions_settings2"></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { layout: 'people',
    bondScales: { off: [], custom: [{ key: 'jealousy', title: 'Ревность', hint: '', friction: true }] }, ...settings });
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document }); ui.open();
  const settingsUi = createSettings(runtime, { document, getContext: fake.getContext });
  t.after(() => { settingsUi.dispose(); ui.dispose(); runtime.dispose(); dom.window.close(); });
  const query = selector => ui.element.querySelector(selector);
  const card = id => query(`.st-sable-card[data-section="${id}"]`);
  const group = () => query('[data-people]');
  const person = id => [...ui.element.querySelectorAll('[data-person]')].find(item => item.dataset.person === id);
  const persons = () => [...ui.element.querySelectorAll('[data-person]')].map(item => item.dataset.person);
  const control = (element, name) => element.querySelector(`[data-control="${name}"]`);
  return { dom, document, fake, runtime, ui, settingsUi, query, card, group, person, persons, control };
}

test('layout setting: normalised, and the Sections select writes it', t => {
  assert.equal(normalizeSettings({}).layout, 'topics');
  assert.equal(normalizeSettings({ layout: 'grid' }).layout, 'topics');
  assert.equal(normalizeSettings({ layout: 'people' }).layout, 'people');
  assert.deepEqual(normalizeSettings({ folded: { 'person:maren': true, 'person:': true, people: false, junk: true } }).folded,
    { 'person:maren': true, people: false });
  const { settingsUi, runtime, document, card, group } = setup(t, { layout: 'topics' });
  const select = settingsUi.element.querySelector('select[name="layout"]');
  assert.deepEqual([...select.options].map(option => [option.value, option.textContent]), [['topics', 'по темам'], ['people', 'по персонажам']]);
  assert.ok(select.closest('[data-group="sections"]'));
  assert.ok(select.compareDocumentPosition(settingsUi.element.querySelector('.st-sable-settings-table')) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(card('npcs')); assert.equal(group(), null);
  select.value = 'people'; select.dispatchEvent(new document.defaultView.Event('change'));
  assert.equal(runtime.snapshot().settings.layout, 'people');
  assert.equal(card('npcs'), null); assert.ok(group());
});

test('people group replaces the four cards in place; person cards present first, unmatched dossier last', t => {
  const { card, group, persons, query, ui } = setup(t);
  for (const id of PEOPLE) assert.equal(card(id), null);
  assert.ok(card('world') && card('planner'));
  assert.equal(group().getAttribute('aria-label'), 'Группа: Люди'); assert.ok(group().querySelector('.fa-users'));
  // Default order: world offscreen threads story npcs… so the group sits after story and before planner.
  assert.equal(card('story').nextElementSibling, group()); assert.equal(group().nextElementSibling, card('planner'));
  assert.deepEqual(persons(), ['maren', 'tomas', 'Stranger']);
  assert.equal(ui.element.querySelectorAll('[data-person] [data-control="handle"], [data-person] [data-control="folder"]').length, 0);
  assert.match(query('[data-person="maren"] .st-sable-card-footer').textContent, /в раскладке по темам/);
});

test('person card: fields, spoiler, thought, bond rows with a custom title, dossier matched case-insensitively', t => {
  const { person, control, runtime } = setup(t);
  const maren = person('maren'), tomas = person('tomas');
  assert.equal(maren.querySelector('.st-sable-card-label').textContent, 'Maren');
  assert.equal(maren.querySelector('.st-sable-mood').textContent, 'guarded, tired');
  assert.ok(maren.classList.contains('st-sable-present'));
  assert.equal(maren.querySelector('.st-sable-card-body').hidden, false); assert.equal(tomas.querySelector('.st-sable-card-body').hidden, true);
  const npcPart = maren.querySelector('[data-part="npcs"]');
  assert.equal(npcPart.querySelector('dt').textContent, 'Собирается');
  assert.doesNotMatch(npcPart.textContent, /boathouse/);
  control(maren, 'spoiler').click(); assert.match(npcPart.textContent, /boathouse/);
  assert.match(maren.querySelector('[data-part="thoughts"] blockquote').textContent, /whole village/);
  assert.equal(tomas.querySelector('[data-part="thoughts"]'), null);
  const rows = [...maren.querySelectorAll('[data-part="bonds"] details')];
  assert.ok(rows.every(row => row.dataset.key.startsWith('person:maren:')));
  const jealousy = maren.querySelector('details[data-key="person:maren:jealousy"]');
  assert.equal(jealousy.querySelector('.st-sable-scale-name').textContent, 'Ревность');
  assert.ok(jealousy.querySelector('.st-sable-friction'));
  assert.match(maren.querySelector('[data-part="bonds"] .st-sable-bond-name').textContent, /→ Player/);
  assert.match(maren.querySelector('[data-part="dossiers"]').textContent, /lighthouse keeper's widow/);
  assert.equal(maren.querySelector('[data-part="dossiers"] dt').textContent, 'Роль');
  assert.equal(person('Stranger').querySelector('[data-part="npcs"]'), null);
  assert.match(person('Stranger').querySelector('[data-part="dossiers"]').textContent, /drifter/);
  assert.equal(maren.querySelectorAll('.st-sable-person-part').length, 4);
  // Order of the parts: npcs, thought, bonds, dossier.
  assert.deepEqual([...maren.querySelector('.st-sable-card-body').children].map(part => part.dataset.part), PEOPLE);
  runtime.setMode('thoughts', 'off');
  assert.equal(person('maren').querySelector('[data-part="thoughts"]'), null);
  assert.equal(person('maren'), maren);
});

test('model text stays text in person cards', t => {
  const state = people();
  state.npcs[0].name = '<img src=x onerror=alert(1)>'; state.npcs[0].mood = '<b>bold</b>'; state.thoughts[0].thought = '<script>x</script>';
  const { person, ui } = setup(t, {}, state);
  assert.equal(ui.element.querySelector('img, b, script'), null);
  assert.equal(person('maren').querySelector('.st-sable-card-label').textContent, '<img src=x onerror=alert(1)>');
});

test('group chip aggregates the four modes and its menu sets all four in one write', t => {
  const { group, control, query, runtime, fake } = setup(t);
  assert.equal(control(group(), 'mode').dataset.mode, 'mixed');
  const before = fake.calls.settings;
  control(group(), 'mode').click(); query('[role="menuitemradio"][data-mode="show"]').click();
  for (const id of PEOPLE) assert.equal(runtime.snapshot().modes[id], 'show');
  assert.equal(fake.calls.settings - before, 1);
  assert.equal(control(group(), 'mode').dataset.mode, 'show');
  runtime.updateSettings({ perChatOverrides: true });
  assert.equal(runtime.setSectionsMode(PEOPLE, 'inject', true), true);
  assert.deepEqual(PEOPLE.map(id => fake.ctx.chatMetadata.sableTrackers.modeOverride[id]), PEOPLE.map(() => 'inject'));
  assert.equal(runtime.setSectionsMode(PEOPLE, 'loud'), false);
});

test('all four off: the group hides under hideOff and the reveal row brings it back', t => {
  const { group, runtime, query, persons } = setup(t);
  runtime.setSectionsMode(PEOPLE, 'off');
  assert.equal(group(), null); assert.deepEqual(persons(), []);
  const reveal = query('.st-sable-hidden-toggle');
  assert.equal(reveal.closest('.st-sable-hidden-row').hidden, false); assert.match(reveal.textContent, /4/);
  reveal.click();
  assert.ok(group()); assert.ok(group().classList.contains('st-sable-off')); assert.equal(group().dataset.mode, 'off');
  reveal.click(); assert.equal(group(), null);
  runtime.setMode('bonds', 'show');
  assert.deepEqual(persons(), ['maren', 'tomas']);
  assert.equal(query('[data-person="maren"] [data-part="npcs"]'), null);
  assert.ok(query('[data-person="maren"] [data-part="bonds"]'));
});

test('person cards and bond rows keep their nodes across a state change; the change is flagged', t => {
  const { person, runtime } = setup(t);
  const maren = person('maren'), row = maren.querySelector('details[data-key="person:maren:trust"]');
  const group = maren.closest('[data-people]');
  assert.equal(row.querySelector('.st-sable-bar-fill').style.transform, 'scaleX(0.34)');
  const bonds = structuredClone(runtime.snapshot().entry.state.bonds); bonds[0].stats.trust = 80;
  runtime.editState('bonds', bonds);
  assert.equal(person('maren'), maren); assert.equal(maren.closest('[data-people]'), group);
  const same = maren.querySelector('details[data-key="person:maren:trust"]');
  assert.equal(same, row); assert.equal(row.querySelector('.st-sable-bar-fill').style.transform, 'scaleX(0.8)');
  assert.ok(row.hasAttribute('data-st-sable-changed')); assert.ok(maren.hasAttribute('data-st-sable-changed'));
  assert.equal(maren.querySelector('.st-sable-change-dot').hidden, false);
  assert.equal(person('tomas').hasAttribute('data-st-sable-changed'), false);
});

test('person fold persists under folded[person:<id>] and the group fold under folded.people', t => {
  const { person, control, runtime, group, document } = setup(t);
  control(person('maren'), 'fold').focus(); control(person('maren'), 'fold').click();
  assert.equal(runtime.snapshot().settings.folded['person:maren'], true);
  assert.equal(person('maren').querySelector('.st-sable-card-body').hidden, true);
  assert.equal(document.activeElement, control(person('maren'), 'fold'));
  person('tomas').querySelector('.st-sable-card-title').click();
  assert.equal(runtime.snapshot().settings.folded['person:tomas'], false);
  assert.equal(person('tomas').querySelector('.st-sable-card-body').hidden, false);
  control(group(), 'fold').click();
  assert.equal(runtime.snapshot().settings.folded.people, true); assert.equal(group().lastElementChild.hidden, true);
});

test('a folder listing npcs keeps its other members; switching back restores the four cards', t => {
  const folders = [{ id: 'f_00000001', title: 'Mixed', icon: '', members: ['world', 'npcs'] },
    { id: 'f_00000002', title: 'Cast', icon: '', members: ['thoughts', 'dossiers'] }];
  const { query, runtime, card, group, persons } = setup(t, { folders });
  const mixed = query('[data-folder="f_00000001"]');
  assert.deepEqual([...mixed.querySelectorAll('.st-sable-card')].map(item => item.dataset.section), ['world']);
  assert.equal(query('[data-folder="f_00000002"]'), null, 'a folder of NPC sections only is consumed whole');
  assert.ok(group()); assert.equal(persons().length, 3);
  runtime.updateSettings({ layout: 'topics' });
  assert.equal(group(), null); assert.deepEqual(persons(), []);
  for (const id of PEOPLE) assert.ok(card(id));
  assert.deepEqual([...query('[data-folder="f_00000001"]').querySelectorAll('.st-sable-card')].map(item => item.dataset.section), ['world', 'npcs']);
  assert.ok(query('[data-folder="f_00000002"]'));
});

test('the People handle moves the whole block among top-level items', t => {
  const { group, control, runtime, dom } = setup(t);
  const handle = control(group(), 'handle');
  handle.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  const order = runtime.snapshot().settings.order;
  assert.deepEqual(order.slice(0, 8), ['world', 'offscreen', 'threads', ...PEOPLE, 'story']);
  assert.equal(group().nextElementSibling.dataset.section, 'story');
});
