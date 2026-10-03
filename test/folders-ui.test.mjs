import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';
import { readFile } from 'node:fs/promises';

const a = 'f_00000001', b = 'f_00000002';
const folder = (id, members, title = 'People') => ({ id, title, icon: '', members });
function setup(t, settings = {}) {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div><div id="extensions_settings2"></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { folders: [folder(a, ['world', 'threads'])], ...settings });
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document }); ui.open();
  const settingsUi = createSettings(runtime, { document, getContext: fake.getContext });
  t.after(() => { settingsUi.dispose(); ui.dispose(); runtime.dispose(); dom.window.close(); });
  const query = selector => ui.element.querySelector(selector);
  const card = id => query(`.st-sable-card[data-section="${id}"]`);
  const group = (id = a) => query(`[data-folder="${id}"]`);
  const members = (id = a) => [...group(id).querySelectorAll('.st-sable-card')].map(card => card.dataset.section);
  const control = (element, name) => element.querySelector(`[data-control="${name}"]`);
  const key = (element, key) => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const choose = (id, target) => { control(card(id), 'folder').click(); query(`[role="menu"] [data-mode="${target}"]`).click(); };
  return { dom, document, fake, runtime, ui, settingsUi, query, card, group, members, control, key, choose };
}

test('folder container, safe title, glyph, aggregate chip, set-all and persistent folds', t => {
  const { group, members, control, runtime, query, document } = setup(t);
  assert.equal(group().getAttribute('aria-label'), 'Группа: People');
  assert.deepEqual(members(), ['world', 'threads']); assert.ok(group().querySelector('.fa-folder'));
  runtime.setMode('threads', 'show'); assert.equal(control(group(), 'mode').dataset.mode, 'mixed');
  control(group(), 'mode').click(); query('[data-mode="show"][role="menuitemradio"]').click();
  assert.equal(runtime.snapshot().modes.world, 'show'); assert.equal(control(group(), 'mode').dataset.mode, 'show');
  control(group(), 'fold').focus(); control(group(), 'fold').click();
  assert.equal(runtime.snapshot().settings.folded[`folder:${a}`], true);
  assert.equal(group().lastElementChild.hidden, true); assert.equal(document.activeElement, control(group(), 'fold'));
  runtime.updateSettings({ language: 'en', visual: { icons: 'emoji' }, folders: [folder(a, ['world', 'threads'], '<img src=x>')] });
  assert.equal(group().getAttribute('aria-label'), 'Group: <img src=x>'); assert.equal(group().querySelector('img'), null);
  assert.match(group().querySelector('.st-sable-card-icon').textContent, /📁/);
});

test('folder membership menu moves and leaves cards, keyboard and close rules match the mode menu', t => {
  const { card, group, members, control, query, choose, runtime, key, document } = setup(t, { folders: [folder(a, ['world', 'threads']), folder(b, ['npcs'])] });
  const original = card('story');
  control(original, 'folder').focus(); key(control(original, 'folder'), 'ArrowDown');
  assert.equal(query('[role="menu"]').querySelectorAll('[role="menuitemradio"]').length, 3);
  key(document.activeElement, 'End'); assert.equal(document.activeElement.dataset.mode, 'new');
  key(document.activeElement, 'Home'); assert.equal(document.activeElement.dataset.mode, a);
  key(document.activeElement, 'Escape'); assert.equal(query('[role="menu"]'), null);
  choose('story', a); assert.deepEqual(members(), ['world', 'threads', 'story']); assert.equal(card('story'), original);
  control(card('story'), 'folder').click(); assert.equal(query(`[data-mode="${a}"]`).getAttribute('aria-checked'), 'true');
  query('[role="menu"] [data-mode="none"]').click();
  assert.equal(card('story').parentElement, query('.st-sable-cards'));
  assert.equal(group().nextElementSibling, card('story'));
  choose('world', b); assert.deepEqual(members(b), ['npcs', 'world']); assert.deepEqual(members(), ['threads']);
  runtime.setPack('combat', true); assert.equal(control(card('combat_scene'), 'folder'), null);
});

test('new folder opens focused editor; draft persists, rename and icon save, cancel and two-tap delete', t => {
  const { choose, runtime, group, query, control, document, card } = setup(t);
  choose('story', 'new');
  const created = runtime.snapshot().settings.folders.at(-1), id = created.id;
  assert.equal(created.title, 'Группа 2'); assert.deepEqual(created.members, ['story']);
  const editor = query(`[data-folder-editor="${id}"]`), title = editor.querySelector('[name="title"]');
  assert.equal(document.activeElement, title); title.value = 'Renamed';
  editor.querySelector('[name="icon"]').value = 'fa-book'; runtime.publish();
  assert.equal(query(`[data-folder-editor="${id}"]`), editor); assert.equal(title.value, 'Renamed'); assert.equal(document.activeElement, title);
  editor.querySelector('.st-sable-editor-save').click();
  assert.equal(runtime.snapshot().settings.folders.at(-1).title, 'Renamed'); assert.ok(group(id).querySelector('.fa-book'));
  control(group(id), 'folder-edit').click(); query(`[data-folder-editor="${id}"] .st-sable-editor-cancel`).click();
  assert.equal(query(`[data-folder-editor="${id}"]`), null);
  control(group(id), 'folder-edit').click();
  const remove = query(`[data-folder-editor="${id}"] [data-control="folder-delete"]`);
  remove.focus(); remove.click(); assert.match(remove.textContent, /ещё раз/); assert.ok(group(id));
  title.focus(); remove.dispatchEvent(new document.defaultView.Event('blur')); remove.click(); assert.ok(group(id));
  const order = runtime.snapshot().settings.order; remove.click();
  assert.equal(group(id), null); assert.equal(card('story').parentElement, query('.st-sable-cards'));
  assert.deepEqual(runtime.snapshot().settings.order, order);
});

test('empty folders render last with disabled handles and editors; hideOff counts and reveals nested cards', t => {
  const { group, control, query, runtime, members } = setup(t, { folders: [folder(a, ['world', 'threads']), folder(b, [])] });
  assert.equal(query('.st-sable-cards').lastElementChild, group(b));
  assert.ok(control(group(b), 'handle').disabled); assert.match(group(b).textContent, /Пусто/);
  control(group(b), 'folder-edit').click(); assert.ok(group(b).querySelector('[data-folder-editor]'));
  runtime.setMode('threads', 'off'); assert.deepEqual(members(), ['world']); assert.match(query('.st-sable-hidden-toggle').textContent, /1/);
  runtime.setMode('world', 'off'); assert.equal(group(), null); assert.ok(group(b));
  query('.st-sable-hidden-toggle').click(); assert.deepEqual(members(), ['world', 'threads']);
  assert.equal(group().dataset.mode, 'off'); assert.equal(query('.st-sable-cards').lastElementChild, group(b));
});

test('folder keyboard and pointer movement stays bounded and preserves member nodes', t => {
  const { group, card, control, key, query, members, runtime, document, dom } = setup(t);
  const container = group(), world = card('world'), threads = card('threads');
  key(control(group(), 'handle'), 'ArrowDown'); assert.equal(query('.st-sable-cards').firstElementChild, card('offscreen'));
  key(control(world, 'handle'), 'ArrowDown'); assert.deepEqual(members(), ['threads', 'world']);
  key(control(world, 'handle'), 'ArrowDown'); assert.deepEqual(members(), ['threads', 'world']);
  assert.equal(group(), container); assert.equal(card('threads'), threads); assert.equal(card('world'), world);
  const at = (target, type, y) => { const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event); };
  const stub = parent => [...parent.children].forEach((item, i) => { item.getBoundingClientRect = () => ({ top: i * 100, height: 100 }); });
  const drag = (grip, y, end = 'pointerup') => { at(grip, 'pointerdown', 25); at(document, 'pointermove', y); at(document, end, y); };
  control(group(), 'folder-edit').click(); const editor = group().querySelector('[data-folder-editor]');
  stub(group().lastElementChild); drag(control(world, 'handle'), 30);
  assert.deepEqual(members(), ['world', 'threads']); assert.equal(group().lastElementChild.firstElementChild, editor);
  stub(group().lastElementChild); drag(control(world, 'handle'), 5000, 'pointercancel'); assert.deepEqual(members(), ['world', 'threads']);
  stub(group().lastElementChild); drag(control(world, 'handle'), 5000); assert.deepEqual(members(), ['threads', 'world']);
  assert.ok(group().lastElementChild.lastElementChild.classList.contains('st-sable-card-footer'));
  stub(query('.st-sable-cards')); drag(control(group(), 'handle'), 30); assert.equal(query('.st-sable-cards').firstElementChild, group());
  assert.equal(runtime.snapshot().settings.order.includes(undefined), false);
});

test('suggested folders create localized presets, preserve order, and replace only after two taps with blur disarming', t => {
  const { settingsUi, runtime, document } = setup(t, { folders: [] });
  const button = settingsUi.element.querySelector('[data-control="suggested-folders"]'), order = runtime.snapshot().settings.order;
  button.click(); assert.deepEqual(runtime.snapshot().settings.folders.map(f => f.title), ['Мир', 'Люди', 'Сюжет']);
  assert.deepEqual(runtime.snapshot().settings.folders.map(f => f.members), [['world', 'offscreen', 'threads'], ['npcs', 'thoughts', 'bonds', 'dossiers'], ['story', 'planner', 'banlist']]);
  assert.deepEqual(runtime.snapshot().settings.order, order);
  const previous = runtime.snapshot().settings.folders;
  runtime.updateSettings({ language: 'en' }); button.focus(); button.click(); assert.match(button.textContent, /Tap again/);
  button.dispatchEvent(new document.defaultView.Event('blur')); assert.match(button.textContent, /Suggested groups/);
  button.click(); assert.deepEqual(runtime.snapshot().settings.folders, previous);
  button.click(); assert.deepEqual(runtime.snapshot().settings.folders.map(f => f.title), ['World', 'People', 'Story']);
});

test('folder menu enforces folder and member caps and navigates past disabled choices', t => {
  const customSections = Array.from({ length: 20 }, (_, i) => ({ id: `c_${i.toString(16).padStart(8, '0')}`, title: 'Custom' }));
  const folders = Array.from({ length: 12 }, (_, i) => folder(`f_${i.toString(16).padStart(8, '0')}`, i ? [] : customSections.map(s => s.id)));
  const { card, control, query, document, key, runtime } = setup(t, { folders, customSections });
  control(card('world'), 'folder').click();
  assert.ok(query('[role="menu"] [data-mode="f_00000000"]').disabled);
  assert.ok(query('[role="menu"] [data-mode="new"]').disabled);
  key(document.activeElement, 'End'); assert.equal(document.activeElement.dataset.mode, 'f_0000000b');
  key(document.activeElement, 'ArrowDown'); assert.equal(document.activeElement.dataset.mode, 'f_00000001');
  query('[role="menu"] [data-mode="new"]').click(); assert.equal(runtime.snapshot().settings.folders.length, 12);
});

test('preview module and phone iframe fixture load with two folders', async () => {
  const previewUrl = new URL('../dev/preview.html', import.meta.url), html = await readFile(previewUrl, 'utf8');
  const phone = new JSDOM(await readFile(new URL('../dev/phone.html', import.meta.url), 'utf8'));
  assert.equal(phone.window.document.querySelector('iframe').getAttribute('src'), 'preview.html'); phone.window.close();
  const dom = new JSDOM(html, { url: 'http://localhost/dev/preview.html', pretendToBeVisual: true });
  const previous = Object.fromEntries(['document', 'location', 'fetch'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location,
    fetch: async path => ({ ok: true, json: async () => JSON.parse(await readFile(new URL(path, previewUrl), 'utf8')) }) });
  let loaded;
  try {
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
      .replace(/from '(\.\.[^']+)'/g, (_, path) => `from '${new URL(path, previewUrl).href}'`);
    loaded = await import(`data:text/javascript;base64,${Buffer.from(`${script}\nexport { ui, runtime };`).toString('base64')}`);
    assert.equal(dom.window.document.title, 'ready');
    assert.equal(dom.window.document.querySelectorAll('[data-folder]').length, 2);
    assert.equal(loaded.ui.element.hidden, false);
  } finally {
    loaded?.ui.dispose(); loaded?.runtime.dispose(); dom.window.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
