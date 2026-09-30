import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createSettings } from '../src/ui/settings.js';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';
import { VISUAL_DEFAULTS, normalizeSettings } from '../src/settings.js';

function setup(t, profileEvent = false, host = 'extensions_settings2') {
  const dom = new JSDOM(`<body><div id="extensions-settings-button"><button class="drawer-toggle"></button></div><div id="${host}"></div></body>`);
  const fake = createFakeST();
  fake.ctx.extensionSettings.sableTrackers.language = 'en';
  if (profileEvent) fake.ctx.eventTypes.CONNECTION_PROFILE_LOADED = 'profile-loaded';
  fake.ctx.extensionSettings.connectionManager.profiles.push({ id: 'text', name: '<img src=x>', mode: 'tc' }, { id: 'unknown', name: 'Unknown' });
  const runtime = createRuntime(fake.getContext); runtime.start();
  const calls = { patches: [], modes: [], refresh: 0, seed: 0 };
  const wrapped = { ...runtime,
    updateSettings(patch) { calls.patches.push(patch); runtime.updateSettings(patch); },
    setMode(...args) { calls.modes.push(args); runtime.setMode(...args); },
    refresh() { calls.refresh++; }, seedLegacy() { calls.seed++; },
  };
  const ui = createSettings(wrapped, { document: dom.window.document, getContext: fake.getContext });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const query = selector => ui.element.querySelector(selector);
  function change(selector, value) {
    const input = query(selector);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  function input(selector, value) {
    const element = query(selector); element.value = value;
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  const button = text => [...ui.element.querySelectorAll('button')].find(b => b.textContent === text);
  return { dom, fake, runtime, ui, calls, query, change, input, button };
}

test('settings render all fields with safe profile names and only cc profiles enabled', t => {
  const { ui, query } = setup(t);
  assert.equal(ui.element.parentElement.id, 'extensions_settings2');
  assert.equal(query('.inline-drawer-header b').textContent, 'Sable Trackers');
  assert.deepEqual([...ui.element.querySelectorAll('.st-sable-settings-heading')].map(h => h.textContent),
    ['Connection', 'Context', 'Sections', 'Custom blocks', 'Appearance', 'Actions']);
  assert.ok(ui.element.classList.contains('st-sable-settings'));
  assert.deepEqual([...query('[data-group="sections"]').querySelectorAll('[data-section]')].map(row => row.dataset.section),
    ['world', 'offscreen', 'threads', 'story', 'npcs', 'thoughts', 'bonds', 'dossiers', 'planner', 'banlist']);
  assert.equal(query('[data-section="world"] .st-sable-settings-section-name').textContent, 'World State');
  assert.ok(query('[data-section="world"] .st-sable-settings-glyph > i.fa-solid.fa-globe'));
  assert.equal(query('[data-group="context"] .st-sable-settings-grid').querySelectorAll('input[type="number"]').length, 6);
  assert.equal(query('[name="depth"]').parentElement.title, 'Chat depth of the injected summary (0 = at the very end).');
  for (const key of ['perChatOverrides', 'showPanel', 'showFloatingButton']) assert.ok(query(`[data-group="actions"] [name="${key}"]`));
  for (const key of ['enabled', 'profileId', 'language']) assert.ok(query(`[data-group="connection"] [name="${key}"]`));
  for (const key of ['enabled', 'profileId', 'language', 'messages', 'cardChars', 'loreChars', 'maxTokens', 'depth', 'keep', 'perChatOverrides', 'showPanel', 'showFloatingButton']) assert.ok(query(`[name="${key}"]`));
  const options = [...query('[name="profileId"]').options];
  assert.deepEqual(options.filter(o => o.value && !o.disabled).map(o => o.value), ['side']);
  assert.equal(options[2].textContent, '<img src=x> (not chat-completion)');
  assert.equal(query('img'), null);
  assert.equal(query('[name="profileId"]').value, 'side');
});

test('settings changes use runtime patches and modes; reset restores global mode', t => {
  const { change, calls, query, runtime } = setup(t);
  change('[name="messages"]', '7');
  change('[name="showPanel"]', false);
  change('[data-section="planner"] [name="period"]', '8');
  assert.deepEqual(calls.patches, [{ messages: 7 }, { showPanel: false }, { sections: { planner: { period: 8 } } }]);
  change('[name="perChatOverrides"]', true);
  change('[data-section="world"] [name="mode"]', 'off');
  assert.deepEqual(calls.modes[0], ['world', 'off']);
  assert.equal(runtime.snapshot().store.modeOverride.world, 'off');
  const buttons = [...query('.inline-drawer-content').querySelectorAll('button')];
  buttons.find(b => b.textContent.startsWith('Reset')).click();
  assert.deepEqual(calls.modes[1], ['world', null, true]);
  assert.deepEqual(runtime.snapshot().store.modeOverride, {});
  assert.equal(query('[data-section="world"] [name="mode"]').value, 'inject');
  assert.ok(buttons.find(b => b.textContent.startsWith('Import')).disabled);
  buttons.find(b => b.textContent === 'Run now').click(); assert.equal(calls.refresh, 1);
  change('[name="language"]', 'ru');
  assert.equal(query('[name="enabled"]').parentElement.textContent, 'Включено');
});

for (const event of [false, true]) test(`profiles refresh via ${event ? 'ST event' : 'drawer open'} and preserve a missing selection`, async t => {
  const { fake, query, runtime } = setup(t, event, 'extensions_settings');
  fake.ctx.extensionSettings.connectionManager.profiles = [{ id: 'new', name: 'New', mode: 'cc' }];
  if (event) await fake.emit('profile-loaded'); else query('.inline-drawer-toggle').click();
  assert.ok(query('[name="profileId"] option[value="new"]'));
  assert.ok(query('[name="profileId"] option[value="side"]').disabled);
  assert.equal(runtime.snapshot().settings.profileId, 'side');
});

test('drawer gear opens Extensions and expands the settings block', t => {
  const { dom, runtime, query } = setup(t);
  const document = dom.window.document;
  const drawer = createDrawer(runtime, { document }); t.after(() => drawer.dispose());
  let opened = 0, expanded = 0, scrolled = 0;
  document.querySelector('#extensions-settings-button .drawer-toggle').addEventListener('click', () => opened++);
  query('.inline-drawer-content').style.display = 'none';
  query('.inline-drawer-toggle').addEventListener('click', () => expanded++);
  document.querySelector('#st-sable-settings').scrollIntoView = () => scrolled++;
  drawer.element.querySelector('[aria-label="Settings"]').click();
  assert.deepEqual([opened, expanded, scrolled], [1, 1, 1]);
});

test('legacy button follows eligibility and invokes runtime import', async t => {
  const { fake, runtime, query, calls } = setup(t);
  fake.ctx.chat.push(JSON.parse(await readFile(new URL('../fixtures/legacy-message.json', import.meta.url), 'utf8')));
  runtime.publish();
  const button = [...query('.inline-drawer-content').querySelectorAll('button')].find(b => b.textContent.startsWith('Import'));
  assert.equal(button.disabled, false);
  button.click();
  assert.equal(calls.seed, 1);
  await runtime.seedLegacy();
  assert.equal(button.disabled, true);
});

test('custom blocks: add writes the full array with a new c_ id, edits patch it, two taps delete', t => {
  const { dom, ui, query, change, calls, runtime, button } = setup(t);
  assert.equal(query('[data-group="custom"] .st-sable-custom'), null);
  assert.equal(query('[data-group="custom"] .st-sable-settings-hint:not([hidden])').textContent.length > 0, true);
  button('Add block').click();
  const patch = calls.patches.at(-1);
  assert.deepEqual(Object.keys(patch), ['customSections']);
  assert.equal(patch.customSections.length, 1);
  const [block] = patch.customSections;
  assert.match(block.id, /^c_[0-9a-f]{8}$/);
  assert.deepEqual({ ...block, id: 'x' }, { id: 'x', title: 'New block', icon: '📌', instructions: '', shape: 'list', max: 8, mode: 'show', period: 1 });
  assert.deepEqual(runtime.snapshot().settings.customSections, [block]);
  const row = query(`[data-custom-id="${block.id}"]`);
  assert.equal(row.open, true, 'a new block opens for editing');
  assert.equal(dom.window.document.activeElement, row.querySelector('[name="title"]'));
  row.querySelector('[name="title"]').blur();
  const scoped = selector => `[data-custom-id="${block.id}"] ${selector}`;
  change(scoped('[name="title"]'), '  Clues <b>x</b> ');
  change(scoped('[name="icon"]'), 'fa-magnifying-glass');
  change(scoped('[name="shape"]'), 'kv');
  change(scoped('[name="max"]'), '50');
  change(scoped('[name="mode"]'), 'inject');
  change(scoped('[name="period"]'), '3');
  change(scoped('[name="instructions"]'), 'Clues the player has found.');
  assert.deepEqual(runtime.snapshot().settings.customSections, [{ ...block, title: 'Clues <b>x</b>', icon: 'fa-magnifying-glass',
    shape: 'kv', max: 20, mode: 'inject', period: 3, instructions: 'Clues the player has found.' }]);
  assert.ok(calls.patches.slice(-7).every(item => Array.isArray(item.customSections) && item.customSections.length === 1), 'full array on every write');
  assert.equal(row.querySelector('.st-sable-custom-name').textContent, 'Clues <b>x</b>');
  assert.equal(ui.element.querySelectorAll('b').length, 1, 'titles are text, not HTML');
  assert.ok(row.querySelector('summary .st-sable-settings-glyph > i.fa-solid.fa-magnifying-glass'));
  assert.equal(row.querySelector('.st-sable-custom-mode').textContent, 'inject');
  change(scoped('[name="period"]'), '0');
  assert.equal(runtime.snapshot().settings.customSections[0].period, 3, 'invalid period is restored, not saved');
  assert.equal(query(scoped('[name="period"]')).value, '3');
  change(scoped('[name="shape"]'), 'text');
  assert.equal(query(scoped('[name="max"]')).disabled, true);
  button('Add block').click();
  const ids = runtime.snapshot().settings.customSections.map(item => item.id);
  assert.equal(new Set(ids).size, 2);
  assert.equal(query('[data-group="custom"] .st-sable-custom-list').children[0], row, 'existing rows are reused');
  const remove = row.querySelector('.st-sable-custom-actions button');
  remove.click();
  assert.equal(runtime.snapshot().settings.customSections.length, 2, 'first tap only arms');
  assert.equal(remove.textContent, 'Delete for good?');
  remove.click();
  assert.deepEqual(runtime.snapshot().settings.customSections.map(item => item.id), [ids[1]]);
  assert.equal(row.isConnected, false);
});

test('custom block rows keep an in-progress edit when another render arrives', t => {
  const { dom, query, runtime, button } = setup(t);
  button('Add block').click();
  const title = query('.st-sable-custom [name="title"]');
  assert.equal(dom.window.document.activeElement, title);
  title.value = 'Half-typed';
  runtime.publish();
  assert.equal(title.value, 'Half-typed');
  title.blur();
  runtime.publish();
  assert.equal(title.value, 'New block');
});

test('appearance: sliders preview live on input, persist the full visual object on change, reset restores defaults', t => {
  const { dom, runtime, query, change, input, calls, button } = setup(t);
  const drawer = createDrawer(runtime, { document: dom.window.document }); t.after(() => drawer.dispose());
  assert.equal(query('[name="opacity"]').type, 'range');
  assert.equal(query('[name="opacity"]').value, '0.93');
  assert.equal(query('[name="opacity"]').closest('label').querySelector('output').textContent, '93%');
  const before = calls.patches.length;
  input('[name="blur"]', '22');
  assert.equal(calls.patches.length, before, 'dragging does not write settings');
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-blur'), '22px');
  assert.equal(query('[name="blur"]').closest('label').querySelector('output').textContent, '22px');
  change('[name="opacity"]', '0.8');
  assert.deepEqual(calls.patches.at(-1), { visual: { ...VISUAL_DEFAULTS, opacity: 0.8 } });
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-opacity'), '0.8');
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-blur'), '14px', 'an unsaved preview is replaced by saved values');
  change('[name="accent"]', '#8b5cf6');
  change('[name="icons"]', 'emoji');
  change('[name="widthVw"]', '95');
  assert.deepEqual(runtime.snapshot().settings.visual, { ...VISUAL_DEFAULTS, opacity: 0.8, accent: '#8b5cf6', icons: 'emoji', widthVw: 95 });
  assert.equal(drawer.element.querySelector('[data-section="world"] .st-sable-card-icon').textContent, '🌍');
  assert.equal(query('[data-section="world"] .st-sable-settings-glyph').textContent, '🌍');
  button('Restore default look').click();
  assert.deepEqual(calls.patches.at(-1), { visual: { ...VISUAL_DEFAULTS } });
  assert.deepEqual(runtime.snapshot().settings.visual, { ...VISUAL_DEFAULTS });
  assert.equal(query('[name="accent"]').value, '#f5f4ee');
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-accent'), '#f5f4ee');
});

test('visual settings normalize with clamps; unknown top-level keys such as customSections survive', () => {
  const custom = [{ id: 'c_0123abcd', title: 'Clues', shape: 'list' }];
  const settings = normalizeSettings({ customSections: custom,
    visual: { opacity: 2, blur: -5, fontSize: 'x', widthVw: '70.4', accent: '#ABC', icons: 'svg', radius: null } });
  assert.deepEqual(settings.visual, { opacity: 1, blur: 0, fontSize: 13, widthVw: 70, accent: '#aabbcc', icons: 'fa', radius: 18 });
  // customSections are normalized by the §11 side: the id and the given fields survive, the rest is filled in.
  assert.equal(settings.customSections.length, 1);
  assert.deepEqual({ id: settings.customSections[0].id, title: settings.customSections[0].title, shape: settings.customSections[0].shape }, custom[0]);
  assert.deepEqual(normalizeSettings({}).visual, { ...VISUAL_DEFAULTS });
  assert.equal(normalizeSettings({ visual: { opacity: 0.555 } }).visual.opacity, 0.56);
});
