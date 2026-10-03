import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { applyPersonDraft, deriveId, newPersonId, personFingerprint } from '../src/ui/person.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
const four = state => ({ npcs: state.npcs, thoughts: state.thoughts, bonds: state.bonds, dossiers: state.dossiers });
const maren = { id: 'maren', name: 'Maren', npc: fixture.npcs[0] };

test('applyPersonDraft: no change → {}; replace in place; add; remove; bonds as an array', () => {
  const sections = four(structuredClone(fixture));
  assert.deepEqual(applyPersonDraft(sections, maren, {}), {});
  assert.deepEqual(applyPersonDraft(sections, maren, { npc: structuredClone(fixture.npcs[0]) }), {}, 'an identical part is no change');
  const before = JSON.stringify(sections);
  // Replace: only npcs changes, Maren keeps her place before Tomas.
  const replaced = applyPersonDraft(sections, maren, { npc: { ...fixture.npcs[0], mood: 'calm' } });
  assert.deepEqual(Object.keys(replaced), ['npcs']);
  assert.deepEqual(replaced.npcs.map(item => [item.id, item.mood]), [['maren', 'calm'], ['tomas', 'unknown']]);
  assert.equal(JSON.stringify(sections), before, 'the input is not mutated');
  // Add: Tomas has no thought and no bond.
  const tomas = { id: 'tomas', name: 'Tomas', npc: fixture.npcs[1] };
  const added = applyPersonDraft(sections, tomas, { thought: { id: 'tomas', name: 'Tomas', thought: 'Not tonight.' },
    bond: [{ id: 'tomas', name: 'Tomas', toward: '{{user}}', stats: { trust: 10 } }] });
  assert.deepEqual(Object.keys(added).sort(), ['bonds', 'thoughts']);
  assert.deepEqual(added.thoughts.map(item => item.id), ['maren', 'tomas']);
  assert.deepEqual(added.bonds.at(-1).stats, { trust: 10 });
  // Remove: null drops the part; the dossier matches by name, case-insensitively.
  const removed = applyPersonDraft({ ...sections, dossiers: [{ name: 'MAREN', role: 'keeper' }, { name: 'Old Ilse' }] }, maren,
    { thought: null, bond: null, dossier: null });
  assert.deepEqual(removed, { thoughts: [], bonds: [], dossiers: [{ name: 'Old Ilse' }] });
  assert.deepEqual(applyPersonDraft(sections, tomas, { thought: null, dossier: null }), {}, 'removing what is not there is no change');
});

test('applyPersonDraft: an orphan dossier gains a character and edits its dossier by name', () => {
  const sections = { ...four(structuredClone(fixture)), dossiers: [...fixture.dossiers, { name: 'Old Ilse', role: 'net mender' }] };
  const ilse = { id: 'Old Ilse', name: 'Old Ilse', dossier: sections.dossiers[1] };
  const result = applyPersonDraft(sections, ilse, { npc: { id: 'old_ilse', name: 'Old Ilse', present: false },
    dossier: { name: 'Old Ilse', role: 'net mender', hook: 'remembers the storm' } });
  assert.deepEqual(result.npcs.at(-1), { id: 'old_ilse', name: 'Old Ilse', present: false });
  assert.equal(result.npcs.length, 3);
  assert.deepEqual(result.dossiers, [fixture.dossiers[0], { name: 'Old Ilse', role: 'net mender', hook: 'remembers the storm' }]);
  assert.equal(deriveId('Old Ilse'), 'old_ilse');
  assert.equal(newPersonId('Maren', ['maren', 'maren_2']), 'maren_3');
  assert.notEqual(personFingerprint(sections), personFingerprint({ ...sections, thoughts: [] }));
});

function runtimeSetup(t, settings = {}) {
  const fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, settings);
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state: structuredClone(fixture) }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  t.after(() => runtime.dispose());
  const store = () => fake.ctx.chatMetadata.sableTrackers;
  return { fake, runtime, store, state: () => runtime.snapshot().entry.state };
}

test('editSections: an invalid value returns false and writes nothing', t => {
  const { fake, runtime, store } = runtimeSetup(t);
  const before = JSON.stringify(store()), saves = fake.calls.metadata.length, prompts = fake.calls.prompts.length;
  assert.equal(runtime.editSections({ npcs: [{ id: 'maren', name: 'Maren' }], bonds: 'not a list' }), false);
  assert.equal(runtime.editSections({ npcs: [], nowhere: [] }), false, 'an unknown section');
  assert.equal(runtime.editSections({}), false);
  assert.equal(JSON.stringify(store()), before);
  assert.equal(fake.calls.metadata.length, saves); assert.equal(fake.calls.prompts.length, prompts);
});

test('editSections: one save, one publish, one bond history record, stat history for a stats section; editState wraps it', async t => {
  const custom = { id: 'c_0000000b', title: 'Vitals', shape: 'stats' };
  const { fake, runtime, store, state } = runtimeSetup(t, { customSections: [custom] });
  let published = 0; runtime.subscribe(() => { published++; });
  const saves = fake.calls.metadata.length, prompts = fake.calls.prompts.length;
  const bonds = [{ ...fixture.bonds[0], stats: { ...fixture.bonds[0].stats, trust: 50 } }];
  assert.equal(runtime.editSections({ npcs: [fixture.npcs[0]], bonds, c_0000000b: [{ key: 'HP', value: 7, max: 10 }] }), true);
  await Promise.resolve();
  assert.equal(fake.calls.metadata.length - saves, 1, 'one save');
  assert.equal(fake.calls.prompts.length - prompts, 1, 'one injection');
  assert.equal(published, 1, 'one publish');
  assert.deepEqual(state().npcs.map(item => item.id), ['maren']);
  assert.ok(state().meta.editedAt);
  assert.deepEqual(store().history.maren.trust, [{ mesId: 0, value: 50 }]);
  assert.deepEqual(store().history.c_0000000b, { HP: [{ mesId: 0, value: 7 }] });
  assert.equal(runtime.editState('threads', [{ text: 'Who cut the rope?', priority: 'high' }]), true);
  assert.equal(state().threads.length, 1);
  assert.equal(runtime.editState('nowhere', []), false);
  // history: null drops a bond's lines, an object puts them back.
  const lines = structuredClone(store().history.maren);
  assert.equal(runtime.editSections({ bonds: [] }, { history: { maren: null } }), true);
  assert.equal(store().history.maren, undefined);
  assert.equal(runtime.editSections({ bonds }, { history: { maren: lines } }), true);
  assert.deepEqual(store().history.maren, lines);
});

function drawerSetup(t, state = structuredClone(fixture)) {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { layout: 'people' });
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state }],
    history: { maren: { trust: [{ mesId: 0, value: 30 }, { mesId: 0, value: 34 }] } } };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document }); ui.open();
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const person = id => [...ui.element.querySelectorAll('[data-person]')].find(item => item.dataset.person === id);
  const control = (element, name) => element.querySelector(`[data-control="${name}"]`);
  const menuItem = text => [...ui.element.querySelectorAll('.st-sable-mode-menu [role="menuitem"]')].find(item => item.textContent === text);
  const type = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  return { dom, document, fake, runtime, ui, person, control, menuItem, type, state: () => runtime.snapshot().entry.state };
}

test('pencil menu: 36 px button between mood and fold, two items with the mode menu keys, no legend; no footer hint', t => {
  const { ui, person, control, menuItem, dom } = drawerSetup(t);
  const card = person('maren'), header = card.querySelector('.st-sable-person-header');
  const pencil = control(card, 'person-menu');
  assert.equal(pencil.getAttribute('aria-haspopup'), 'menu');
  assert.ok(pencil.classList.contains('st-sable-edit'), 'the 36 px edit button style');
  const kids = [...header.children];
  assert.ok(kids.indexOf(header.querySelector('.st-sable-mood')) < kids.indexOf(pencil.parentElement));
  assert.ok(kids.indexOf(pencil.parentElement) < kids.indexOf(control(header, 'fold')));
  assert.doesNotMatch(card.querySelector('.st-sable-card-footer').textContent, /раскладке по темам/);
  pencil.click();
  const menu = card.querySelector('.st-sable-mode-menu');
  assert.deepEqual([...menu.querySelectorAll('[role="menuitem"]')].map(item => item.textContent), ['Редактировать', 'Удалить']);
  assert.equal(menu.querySelector('.st-sable-menu-legend'), null);
  assert.equal(pencil.getAttribute('aria-expanded'), 'true');
  assert.equal(dom.window.document.activeElement, menuItem('Редактировать'));
  menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(dom.window.document.activeElement, menuItem('Удалить'));
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ui.element.querySelector('.st-sable-mode-menu'), null);
  assert.equal(dom.window.document.activeElement, pencil);
});

test('edit form: built from the schemas for Maren, keeps its draft over re-renders, saves through editSections', t => {
  const { runtime, person, control, menuItem, type, state, document } = drawerSetup(t);
  control(person('maren'), 'person-menu').click(); menuItem('Редактировать').click();
  const card = person('maren'), form = card.querySelector('.st-sable-person-form');
  assert.ok(form);
  const titles = [...form.querySelectorAll('.st-sable-person-sub-title')].map(item => item.textContent);
  assert.deepEqual(titles, ['Персонаж', 'Тайна / На самом деле', 'Мысль', 'Отношения', 'Досье']);
  assert.ok(form.querySelector('.st-sable-person-sub-title i.fa-masks-theater'), 'section glyphs');
  const npcNames = [...form.querySelectorAll('[data-part="npc"]')[0].querySelectorAll('[name]')].map(item => item.name);
  assert.deepEqual(npcNames.slice(0, 3), ['present', 'mood', 'agenda']);
  assert.ok(npcNames.includes('outfit') && !npcNames.includes('secret'));
  assert.match(form.querySelectorAll('[data-part="npc"]')[1].textContent, /не идёт в промпт/);
  assert.equal(control(form, 'person-npc-secret').tagName, 'INPUT');
  assert.equal(control(form, 'person-thought-thought').tagName, 'TEXTAREA');
  assert.equal(control(form, 'person-bond-0-trust').value, '34');
  assert.equal(control(form, 'person-bond-0-trust').min, '0');
  assert.match(form.querySelector('[data-part="bond-0"] .st-sable-editor-readonly').textContent, /you gave her the key/, '`changes` read-only');
  assert.equal(control(form, 'person-dossier-hook').value, fixture.dossiers[0].hook);
  assert.equal(form.querySelector('[data-control="person-add-thought"], [data-control="person-add-npc"]'), null, 'nothing missing');
  // The draft and the node survive an unrelated render; focus stays in the field.
  const mood = control(form, 'person-npc-mood');
  mood.focus(); type(mood, 'calmer now');
  runtime.updateSettings({ hideOff: true });
  assert.equal(person('maren').querySelector('.st-sable-person-form'), form);
  assert.equal(document.activeElement, mood); assert.equal(mood.value, 'calmer now');
  // A change underneath shows the bar; Save writes the draft on top of the new data.
  assert.equal(form.querySelector('.st-sable-person-stale').hidden, true);
  runtime.editState('thoughts', [{ id: 'maren', name: 'Maren', thought: 'The key was a test.' }]);
  assert.equal(form.querySelector('.st-sable-person-stale').hidden, false);
  assert.match(form.querySelector('.st-sable-person-stale').textContent, /Данные обновились/);
  const calls = [], original = runtime.editSections;
  runtime.editSections = (...args) => { calls.push(structuredClone(args)); return original(...args); };
  type(control(form, 'person-bond-0-trust'), '41');
  control(form, 'person-save').click();
  assert.deepEqual(Object.keys(calls[0][0]).sort(), ['bonds', 'npcs']);
  assert.equal(state().npcs[0].mood, 'calmer now');
  assert.equal(state().bonds[0].stats.trust, 41);
  assert.equal(state().thoughts[0].thought, 'The key was a test.', 'the untouched thought keeps the newer value');
  assert.equal(person('maren').querySelector('.st-sable-person-form'), null);
});

test('edit form: «Перечитать» drops the draft; no change closes without a write; a failed write shows the error', t => {
  const { runtime, person, control, menuItem, type, fake } = drawerSetup(t);
  control(person('maren'), 'person-menu').click(); menuItem('Редактировать').click();
  let form = person('maren').querySelector('.st-sable-person-form');
  type(control(form, 'person-npc-mood'), 'draft');
  runtime.editState('thoughts', []);
  control(form, 'person-reread').click();
  form = person('maren').querySelector('.st-sable-person-form');
  assert.equal(control(form, 'person-npc-mood').value, 'guarded, tired');
  assert.equal(form.querySelector('.st-sable-person-stale').hidden, true);
  assert.ok(control(form, 'person-add-thought'), 'the thought is gone, so «+ Мысль» appears');
  const saves = fake.calls.metadata.length;
  control(form, 'person-save').click();
  assert.equal(fake.calls.metadata.length, saves, 'an untouched form writes nothing');
  assert.equal(person('maren').querySelector('.st-sable-person-form'), null);
  control(person('maren'), 'person-menu').click(); menuItem('Редактировать').click();
  form = person('maren').querySelector('.st-sable-person-form');
  type(control(form, 'person-npc-mood'), 'x');
  runtime.editSections = () => false;
  control(form, 'person-save').click();
  assert.equal(person('maren').querySelector('.st-sable-person-form'), form);
  assert.equal(form.querySelector('.st-sable-editor-error').hidden, false);
});

test('edit form: «+» parts for Tomas, several forms at once, an orphan dossier gains «+ Персонаж»', t => {
  const state = structuredClone(fixture);
  state.dossiers.push({ name: 'Old Ilse', role: 'net mender' });
  const { person, control, menuItem, type, state: current } = drawerSetup(t, state);
  control(person('maren'), 'person-menu').click(); menuItem('Редактировать').click();
  control(person('tomas'), 'person-menu').click(); menuItem('Редактировать').click();
  assert.ok(person('maren').querySelector('.st-sable-person-form') && person('tomas').querySelector('.st-sable-person-form'));
  const tomas = person('tomas').querySelector('.st-sable-person-form');
  assert.deepEqual([...tomas.querySelectorAll('.st-sable-person-adds button')].map(item => item.textContent), ['+ Досье', '+ Отношения', '+ Мысль']);
  control(tomas, 'person-add-thought').click();
  type(control(tomas, 'person-thought-thought'), 'Stay out of sight.');
  control(tomas, 'person-add-bond').click();
  type(control(tomas, 'person-bond-0-fear'), '20');
  control(tomas, 'person-save').click();
  assert.deepEqual(current().thoughts.at(-1), { id: 'tomas', name: 'Tomas', thought: 'Stay out of sight.' });
  assert.deepEqual(current().bonds.at(-1), { id: 'tomas', name: 'Tomas', toward: '{{user}}', stats: { fear: 20 }, changes: {} });
  assert.ok(person('maren').querySelector('.st-sable-person-form'), 'the other form stays open');
  control(person('Old Ilse'), 'person-menu').click(); menuItem('Редактировать').click();
  const ilse = person('Old Ilse').querySelector('.st-sable-person-form');
  assert.equal(control(ilse, 'person-dossier-role').value, 'net mender');
  assert.ok(control(ilse, 'person-add-npc'));
  assert.equal(control(ilse, 'person-add-npc').textContent, '+ Персонаж');
  control(ilse, 'person-add-npc').click();
  control(ilse, 'person-save').click();
  assert.deepEqual(current().npcs.at(-1), { id: 'old_ilse', name: 'Old Ilse', present: false });
  assert.ok(person('old_ilse'), 'the dossier now belongs to a character card');
  assert.equal(person('Old Ilse'), undefined);
});

test('delete: one editSections call, bond history dropped, the undo pill restores all four sections and the history', t => {
  const { runtime, ui, person, control, menuItem, state, fake } = drawerSetup(t);
  const before = four(structuredClone(state())), lines = structuredClone(fake.ctx.chatMetadata.sableTrackers.history.maren);
  const calls = [], original = runtime.editSections;
  runtime.editSections = (...args) => { calls.push(structuredClone(args)); return original(...args); };
  control(person('maren'), 'person-menu').click(); menuItem('Удалить').click();
  assert.equal(calls.length, 1, 'one call, no confirmation');
  assert.deepEqual(Object.keys(calls[0][0]).sort(), ['bonds', 'dossiers', 'npcs', 'thoughts']);
  assert.equal(person('maren'), undefined);
  assert.deepEqual(state().npcs.map(item => item.id), ['tomas']);
  assert.deepEqual([state().thoughts, state().bonds, state().dossiers], [[], [], []]);
  assert.equal(fake.ctx.chatMetadata.sableTrackers.history.maren, undefined);
  const pill = ui.element.querySelector('.st-sable-undo');
  assert.equal(pill.hidden, false);
  assert.equal(pill.querySelector('.st-sable-undo-text').textContent, 'Maren удалена');
  ui.element.querySelector('[data-control="undo"]').click();
  assert.equal(calls.length, 2);
  assert.deepEqual(four(state()), before);
  // The old line comes back; the restoring edit records its point on the same reply, as any edit does (SPEC §22).
  assert.deepEqual(fake.ctx.chatMetadata.sableTrackers.history.maren.trust, lines.trust);
  assert.ok(person('maren'));
  ui.undo.hide();
});

test('«+ Человек»: a one-field form in the People footer appends a present NPC and opens its form', t => {
  const { runtime, ui, person, control, type, state, document } = drawerSetup(t);
  const footer = ui.element.querySelector('[data-people] .st-sable-people-footer');
  assert.ok(footer); assert.equal(footer.parentElement.lastElementChild, footer, 'last in the group body');
  const add = control(footer, 'person-add');
  assert.match(add.textContent, /\+ Человек/);
  add.click();
  const input = control(footer, 'person-name');
  assert.equal(input.maxLength, 60); assert.equal(input.required, true);
  assert.equal(document.activeElement, input);
  const calls = [], original = runtime.editSections;
  runtime.editSections = (...args) => { calls.push(structuredClone(args)); return original(...args); };
  control(footer, 'person-add-save').click();
  assert.equal(calls.length, 0, 'the name is required'); assert.equal(input.getAttribute('aria-invalid'), 'true');
  type(input, '  Old Ilse ');
  footer.querySelector('form').dispatchEvent(new document.defaultView.Event('submit', { cancelable: true }));
  assert.deepEqual(calls, [[{ npcs: [...fixture.npcs, { id: 'old_ilse', name: 'Old Ilse', present: true }] }]]);
  assert.deepEqual(state().npcs.at(-1), { id: 'old_ilse', name: 'Old Ilse', present: true });
  const card = person('old_ilse');
  assert.ok(card.querySelector('.st-sable-person-form'), 'the new person opens in the form');
  assert.equal(document.activeElement.closest('[data-person]'), card);
  assert.equal(control(footer, 'person-add').hidden, false); assert.equal(footer.querySelector('form').hidden, true);
});

test('topics layout: the section editor is unchanged and has no pencil menu', t => {
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
  const fake = createFakeST(); fake.add();
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state: structuredClone(fixture) }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document: dom.window.document });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  assert.equal(ui.element.querySelector('[data-control="person-menu"]'), null);
  assert.ok(ui.element.querySelector('.st-sable-card[data-section="npcs"] [data-control="edit"]'));
});
