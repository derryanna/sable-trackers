import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings, saveSettings } from '../src/settings.js';
import { getSections, groupedOrder, orderedSectionIds } from '../src/sections.js';
import { dropIndex, moveToFolder, planDrop, slotFor } from '../src/folders.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

const folder = (id, members = [], title = 'Group') => ({ id, title, icon: '', members });
const a = 'f_00000001', b = 'f_00000002';
test('folders normalize ids, titles, membership, shared icons and fold keys idempotently', () => {
  const settings = normalizeSettings({ customSections: [{ id: 'c_00000001', title: 'Custom' }], folders: [
    null, folder('bad', ['world']), folder(a, [], ' '),
    { ...folder(a, ['world', 'world', 'combat_stats', 'c_00000001', 'missing']), icon: '👨‍👩‍👧' },
    folder(a, ['threads']), { ...folder(b, ['world', 'threads']), icon: '<img>' },
  ], folded: { [`folder:${a}`]: true, 'folder:bad': true } });
  assert.deepEqual(settings.folders, [{ ...folder(a, ['world', 'c_00000001']), icon: '👨‍👩‍👧' }, folder(b, ['threads'])]);
  assert.deepEqual(settings.folded, { [`folder:${a}`]: true });
  assert.deepEqual(normalizeSettings(settings), settings);
  const fake = createFakeST(); saveSettings(fake.ctx, { folders: settings.folders });
  assert.deepEqual(saveSettings(fake.ctx, { folders: [] }).folders, []);
});
test('folders cap accepted folders at 12 and members at 20, trim title and validate FA', () => {
  const customSections = Array.from({ length: 20 }, (_, i) => ({ id: `c_${i.toString(16).padStart(8, '0')}`, title: 'Custom' }));
  const folders = Array.from({ length: 15 }, (_, i) => folder(`f_${i.toString(16).padStart(8, '0')}`));
  folders[0] = { ...folders[0], title: ` ${'x'.repeat(50)} `, icon: 'fa-solid fa-folder', members: ['world', ...customSections.map(s => s.id)] };
  const result = normalizeSettings({ folders, customSections });
  assert.equal(result.folders.length, 12); assert.equal(result.folders[0].members.length, 20);
  assert.equal(result.folders[0].title.length, 40); assert.equal(result.folders[0].icon, 'fa-solid fa-folder');
});
test('groupedOrder puts folders at first member, preserves relative order and coexists with packs', () => {
  const sections = getSections({}, ['combat']), order = ['threads', 'combat_stats', 'npcs', 'world'];
  const folders = [folder(a, ['world', 'threads'])];
  assert.deepEqual(groupedOrder(order, sections, ['combat'], folders).slice(0, 7),
    ['threads', 'world', 'combat_stats', 'combat_scene', 'combat_effects', 'combat_odds', 'npcs']);
  assert.deepEqual(groupedOrder(order, sections, ['combat']), groupedOrder(order, sections, ['combat'], []));
  assert.deepEqual(groupedOrder([], getSections({}), []), orderedSectionIds([]));
});
test('membership joins after target block, leaves after old block and moves between folders without mutation', () => {
  const settings = normalizeSettings({ order: ['world', 'npcs', 'threads', 'bonds', 'story'],
    folders: [folder(a, ['world', 'threads']), folder(b, ['npcs', 'bonds'])] });
  const original = structuredClone(settings);
  const join = moveToFolder(settings, 'story', a);
  assert.deepEqual(join.order.slice(0, 5), ['world', 'threads', 'story', 'npcs', 'bonds']);
  assert.deepEqual(join.folders[0].members, ['world', 'threads', 'story']);
  const leave = moveToFolder(settings, 'world', null);
  assert.deepEqual(leave.order.slice(0, 4), ['threads', 'world', 'npcs', 'bonds']);
  const between = moveToFolder(settings, 'world', b);
  assert.deepEqual(between.order.slice(0, 4), ['threads', 'npcs', 'bonds', 'world']);
  assert.deepEqual(between.folders[0].members, ['threads']);
  assert.deepEqual(between.folders[1].members, ['npcs', 'bonds', 'world']);
  assert.deepEqual(settings, original);
  assert.deepEqual(moveToFolder(settings, 'world', 'missing').order, settings.order);
});
test('setFolderMode writes members once globally or once to chat overrides, including custom modes', async t => {
  const fake = createFakeST(), runtime = createRuntime(fake.getContext); runtime.start(); t.after(() => runtime.dispose());
  runtime.updateSettings({ customSections: [{ id: 'c_00000001', title: 'Custom' }], folders: [folder(a, ['world', 'c_00000001'])] });
  let renders = 0; runtime.subscribe(() => renders++);
  const writes = fake.calls.settings;
  assert.equal(runtime.setFolderMode(a, 'show'), true);
  assert.equal(fake.calls.settings - writes, 1); assert.equal(renders, 1);
  assert.equal(runtime.snapshot().modes.world, 'show'); assert.equal(runtime.snapshot().modes.c_00000001, 'show');
  runtime.updateSettings({ perChatOverrides: true });
  const metadata = fake.calls.metadata.length;
  runtime.setFolderMode(a, 'off'); await Promise.resolve();
  assert.equal(fake.calls.metadata.length - metadata, 1);
  assert.deepEqual(runtime.snapshot().store.modeOverride, { world: 'off', c_00000001: 'off' });
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'show');
  runtime.setFolderMode(a, null); assert.deepEqual(runtime.snapshot().store.modeOverride, {});
  assert.equal(runtime.setFolderMode(a, 'bad'), false); assert.equal(runtime.setFolderMode('bad', 'show'), false);
});

test('planDrop moves into a folder at the end or an index, out to no folder at an index, and refuses illegal drops', () => {
  const settings = normalizeSettings({ order: ['world', 'npcs', 'threads', 'bonds', 'story'],
    folders: [folder(a, ['world', 'threads']), folder(b, [])] });
  const original = structuredClone(settings);
  const end = planDrop(settings, 'story', { folderId: a, index: Infinity });
  assert.deepEqual(end.folders[0].members, ['world', 'threads', 'story']);
  assert.deepEqual(end.order.slice(0, 5), ['world', 'threads', 'story', 'npcs', 'bonds']);
  const at = planDrop(settings, 'story', { folderId: a, index: 1 });
  assert.deepEqual(at.order.slice(0, 5), ['world', 'story', 'threads', 'npcs', 'bonds']);
  assert.deepEqual(at.folders[0].members, ['world', 'threads', 'story'], 'members stay a set; order holds the position');
  // Top-level blocks without the card: [world, threads] folder, npcs, bonds, … — index 2 lands before bonds.
  const out = planDrop(settings, 'world', { folderId: null, index: 2 });
  assert.deepEqual(out.folders[0].members, ['threads']);
  assert.deepEqual(out.order.slice(0, 4), ['threads', 'npcs', 'world', 'bonds']);
  assert.deepEqual(planDrop(settings, 'world', { folderId: null, index: 0 }).order.slice(0, 2), ['world', 'threads']);
  const inside = planDrop(settings, 'threads', { folderId: a, index: 0 });
  assert.deepEqual(inside.order.slice(0, 2), ['threads', 'world']); assert.deepEqual(inside.folders, settings.folders);
  // An empty folder gains the card where it stood.
  const empty = planDrop(settings, 'story', { folderId: b, index: 0 });
  assert.deepEqual(empty.folders[1].members, ['story']); assert.deepEqual(empty.order.slice(0, 5), ['world', 'threads', 'npcs', 'bonds', 'story']);
  assert.deepEqual(settings, original, 'no mutation');
  assert.equal(planDrop(settings, 'combat_stats', { folderId: a }), null, 'a pack member');
  assert.equal(planDrop(settings, 'missing', { folderId: a }), null);
  assert.equal(planDrop(settings, 'story', { folderId: 'f_0000000f' }), null);
  assert.equal(planDrop(settings, 'story', { folderId: 'people' }), null, 'the People group is not a folder');
  const customSections = Array.from({ length: 20 }, (_, i) => ({ id: `c_${i.toString(16).padStart(8, '0')}`, title: 'Custom' }));
  const full = normalizeSettings({ customSections, folders: [folder(a, customSections.map(item => item.id))] });
  assert.equal(planDrop(full, 'world', { folderId: a }), null, 'a full folder');
  assert.deepEqual(planDrop(full, 'c_00000000', { folderId: a, index: Infinity }).folders[0].members.length, 20, 'a member moves inside its full folder');
});

test('dropIndex maps an anchor card to the planDrop index; slotFor picks the gap by rectangle middles', () => {
  const settings = normalizeSettings({ order: ['world', 'npcs', 'threads', 'bonds', 'story'], folders: [folder(a, ['world', 'threads'])] });
  assert.equal(dropIndex(settings, 'story', a, 'threads'), 1);
  assert.equal(dropIndex(settings, 'story', a, null), Infinity);
  assert.equal(dropIndex(settings, 'world', null, 'bonds'), 2);
  assert.equal(dropIndex(settings, 'world', null, 'threads'), 0, 'the anchor names its whole block');
  assert.equal(dropIndex(settings, 'story', 'f_0000000f', 'threads'), Infinity);
  const rects = [{ top: 0, height: 100 }, { top: 100, height: 40 }, { top: 140, bottom: 240 }];
  assert.equal(slotFor(rects, -10), 0); assert.equal(slotFor(rects, 49), 0); assert.equal(slotFor(rects, 50), 1);
  assert.equal(slotFor(rects, 119), 1); assert.equal(slotFor(rects, 121), 2); assert.equal(slotFor(rects, 189), 2);
  assert.equal(slotFor(rects, 191), 3); assert.equal(slotFor([], 10), 0);
});
