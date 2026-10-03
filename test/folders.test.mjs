import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings, saveSettings } from '../src/settings.js';
import { getSections, groupedOrder, orderedSectionIds } from '../src/sections.js';
import { moveToFolder } from '../src/folders.js';
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
