import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createSettings } from '../src/ui/settings.js';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';
import { VISUAL_DEFAULTS, normalizeSettings } from '../src/settings.js';
import { COMMON_RULES } from '../src/prompt.js';

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

test('danger zone edits and resets instructions while preserving focused drafts', t => {
  const { query, change, button, runtime, calls, dom } = setup(t);
  const danger = query('[data-group="danger"]'); assert.equal(danger.tagName, 'DETAILS'); assert.equal(danger.open, false);
  assert.ok(danger.querySelector('summary h4 .fa-triangle-exclamation'));
  const rules = query('[name="prompts.rules"]'), reset = query('[name="prompts.rules.reset"]');
  assert.equal(rules.value, COMMON_RULES); assert.equal(reset.disabled, true);
  change('[name="prompts.rules"]', 'My rules'); assert.deepEqual(calls.patches.at(-1), { prompts: { rules: 'My rules' } });
  assert.equal(reset.disabled, false); assert.equal(query('[data-changed]').hidden, false);
  reset.click(); assert.deepEqual(calls.patches.at(-1), { prompts: { rules: null } }); assert.equal(rules.value, COMMON_RULES);
  change('[name="prompts.world"]', 'World instructions');
  assert.deepEqual(calls.patches.at(-1), { prompts: { sections: { world: 'World instructions' } } });
  query('[name="prompts.world.reset"]').click(); assert.equal(runtime.snapshot().settings.prompts.sections.world, undefined);
  danger.open = true; rules.focus(); rules.value = 'Unfinished draft'; runtime.publish(); assert.equal(rules.value, 'Unfinished draft');
  rules.blur(); change('[name="prompts.rules"]', 'Saved rules'); change('[name="prompts.world"]', 'World instructions');
  button('Reset all instructions').click(); assert.equal(runtime.snapshot().settings.prompts.rules, 'Saved rules');
  button('Tap again to reset all instructions').click(); assert.deepEqual(runtime.snapshot().settings.prompts, { rules: null, sections: {}, packs: {} });
  runtime.updateSettings({ order: ['threads', 'world'] });
  assert.equal(query('[data-prompt-section]').dataset.promptSection, 'threads');
  runtime.updateSettings({ language: 'ru' }); assert.equal(danger.querySelector('h4').textContent, 'Опасная зона');
});

test('danger preview, safe request log, copy, download and clear', async t => {
  const { query, button, runtime, fake, dom } = setup(t);
  button('Show prompt').click(); assert.equal(query('[data-preview]').textContent, 'No character reply or the extension is disabled');
  fake.add(); button('Show prompt').click();
  const preview = query('[data-preview]').textContent;
  assert.ok(preview.includes('=== system ===')); assert.ok(preview.includes('Sections: world'));
  assert.ok(preview.includes('Characters:')); assert.ok(preview.includes('≈ ')); assert.equal(fake.calls.requests.length, 0);
  let copied;
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } }, configurable: true });
  button('Copy').click(); await Promise.resolve(); assert.equal(copied, preview);
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: undefined });
  button('Copy').click(); assert.equal(dom.window.getSelection().toString(), preview);
  fake.respond({ content: '<b>x</b>' }); await runtime.refresh();
  const row = query('.st-sable-log-entry'); assert.ok(row); assert.equal(row.dataset.status, 'invalid');
  assert.equal(row.querySelector('b'), null); assert.equal([...row.querySelectorAll('pre')].at(-1).textContent, '<b>x</b>');
  row.open = true; runtime.publish(); assert.equal(query('.st-sable-log-entry').open, true);
  let blob, downloaded;
  dom.window.URL.createObjectURL = value => { blob = value; return 'blob:log'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
  button('Download log').click(); assert.equal(downloaded, 'sable-log.json');
  const contents = await new Promise(resolve => { const reader = new dom.window.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
  assert.deepEqual(JSON.parse(contents), runtime.snapshot().log);
  button('Clear').click(); assert.equal(query('.st-sable-log-entry'), null); assert.ok(query('.st-sable-log').nextSibling.textContent.includes('The log is empty'));
});

test('settings render all fields with safe profile names and only cc profiles enabled', t => {
  const { ui, query } = setup(t);
  assert.equal(ui.element.parentElement.id, 'extensions_settings2');
  assert.equal(query('.inline-drawer-header b').textContent, 'Sable Trackers');
  assert.deepEqual([...ui.element.querySelectorAll('.st-sable-settings-heading')].map(h => h.textContent),
    ['Connection', 'Context', 'Sections', 'Custom blocks', 'Appearance', 'Actions', 'Danger zone']);
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
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-accent'), '', 'the default accent follows the ink');
});

test('visual settings normalize with clamps; unknown top-level keys such as customSections survive', () => {
  const custom = [{ id: 'c_0123abcd', title: 'Clues', shape: 'list' }];
  const settings = normalizeSettings({ customSections: custom,
    visual: { opacity: 2, blur: -5, fontSize: 'x', widthVw: '70.4', accent: '#ABC', icons: 'svg', radius: null } });
  assert.deepEqual(settings.visual, { ...VISUAL_DEFAULTS, opacity: 1, blur: 0, fontSize: 13, widthVw: 70, accent: '#aabbcc', base: null, text: null, icons: 'fa', radius: 18 });
  // customSections are normalized by the §11 side: the id and the given fields survive, the rest is filled in.
  assert.equal(settings.customSections.length, 1);
  assert.deepEqual({ id: settings.customSections[0].id, title: settings.customSections[0].title, shape: settings.customSections[0].shape }, custom[0]);
  assert.deepEqual(normalizeSettings({}).visual, { ...VISUAL_DEFAULTS });
  assert.equal(normalizeSettings({ visual: { opacity: 0.555 } }).visual.opacity, 0.56);
});

test('base and text colours: swatch writes the visual object, «auto» clears to null, reset clears both', t => {
  const { dom, runtime, query, change, input, calls, button } = setup(t);
  const drawer = createDrawer(runtime, { document: dom.window.document }); t.after(() => drawer.dispose());
  const row = key => query(`[name="${key}"]`).closest('.st-sable-settings-optional');
  assert.equal(row('base').querySelector('.st-sable-settings-label').textContent, 'Base colour');
  assert.equal(row('text').querySelector('.st-sable-settings-label').textContent, 'Text colour');
  assert.equal(query('[name="baseAuto"]').textContent, 'auto');
  assert.equal(query('[name="baseAuto"]').getAttribute('aria-pressed'), 'true');
  assert.equal(query('[name="base"]').value, '#0e0e12', 'auto shows the dark-glass stand-in');
  const before = calls.patches.length;
  input('[name="base"]', '#fdf6e3');
  assert.equal(calls.patches.length, before, 'picking previews without writing');
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-ink-rgb'), '0,0,0');
  change('[name="base"]', '#fdf6e3');
  assert.deepEqual(calls.patches.at(-1), { visual: { ...VISUAL_DEFAULTS, base: '#fdf6e3' } });
  assert.equal(query('[name="baseAuto"]').getAttribute('aria-pressed'), 'false');
  change('[name="text"]', '#5b4636');
  assert.deepEqual(calls.patches.at(-1), { visual: { ...VISUAL_DEFAULTS, base: '#fdf6e3', text: '#5b4636' } });
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-text'), '#5b4636');
  query('[name="textAuto"]').click();
  assert.deepEqual(calls.patches.at(-1), { visual: { ...VISUAL_DEFAULTS, base: '#fdf6e3' } });
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-text'), 'rgb(0,0,0)', 'auto text follows the base ink');
  const count = calls.patches.length;
  query('[name="textAuto"]').click();
  assert.equal(calls.patches.length, count, 'auto on an automatic colour writes nothing');
  change('[name="text"]', '#222222');
  button('Restore default look').click();
  assert.deepEqual(runtime.snapshot().settings.visual, { ...VISUAL_DEFAULTS });
  assert.equal(runtime.snapshot().settings.visual.base, null);
  assert.equal(runtime.snapshot().settings.visual.text, null);
  assert.equal(query('[name="text"]').value, '#eeeae7');
  assert.equal(drawer.element.style.getPropertyValue('--st-sable-base-rgb'), '');
  runtime.updateSettings({ language: 'ru' });
  assert.equal(row('base').querySelector('.st-sable-settings-label').textContent, 'Основной цвет');
  assert.equal(row('text').querySelector('.st-sable-settings-label').textContent, 'Цвет текста');
  assert.equal(query('[name="baseAuto"]').textContent, 'авто');
});

test('base and text normalize to null or #rrggbb', () => {
  const visual = value => normalizeSettings({ visual: value }).visual;
  assert.deepEqual([visual({}).base, visual({}).text], [null, null]);
  assert.deepEqual([visual({ base: null, text: null }).base, visual({ base: null, text: null }).text], [null, null]);
  assert.deepEqual([visual({ base: ' #FDF6E3 ', text: '#ABC' }).base, visual({ base: '#FDF6E3', text: '#ABC' }).text], ['#fdf6e3', '#aabbcc']);
  for (const garbage of ['red', 'url(x)', '#12345', '#1234567', 42, true, {}, ['#ffffff'], 'rgb(0,0,0)']) {
    assert.deepEqual([visual({ base: garbage }).base, visual({ text: garbage }).text], [null, null], String(garbage));
  }
});

test('hideOff defaults and normalization are boolean; Actions checkbox is localized and saved', t => {
  assert.equal(normalizeSettings().hideOff, true);
  for (const hideOff of [null, 'false', 0, [], {}]) assert.equal(normalizeSettings({ hideOff }).hideOff, true);
  assert.equal(normalizeSettings({ hideOff: false }).hideOff, false);
  assert.equal(normalizeSettings({ hideOff: true }).hideOff, true);
  const { runtime, query, change, calls } = setup(t);
  const control = query('[data-group="actions"] [name="hideOff"]');
  assert.equal(control.checked, true);
  assert.equal(control.parentElement.textContent, 'Hide switched-off sections');
  assert.equal(query('[name="showPanel"]').parentElement.nextElementSibling, control.parentElement);
  change('[name="hideOff"]', false);
  assert.equal(runtime.snapshot().settings.hideOff, false);
  assert.deepEqual(calls.patches.at(-1), { hideOff: false });
  change('[name="language"]', 'ru');
  assert.equal(control.parentElement.textContent, 'Скрывать выключенные');
});

test('Sections table moves built-ins and custom blocks, edits effective modes and periods, and stays in sync', async t => {
  const { runtime, query, change, calls, dom, button } = setup(t);
  const drawer = createDrawer(runtime, { document: dom.window.document });
  t.after(() => drawer.dispose());
  const ids = () => [...query('[data-group="sections"]').querySelectorAll('[data-section]')].map(row => row.dataset.section);
  const row = id => query(`[data-section="${id}"]`);
  const move = (id, key) => row(id).querySelector(`[data-move="${key}"]`);
  assert.equal(move('world', 'moveUp').disabled, true);
  assert.equal(move('banlist', 'moveDown').disabled, true);
  move('world', 'moveDown').click();
  assert.deepEqual(ids().slice(0, 3), ['offscreen', 'world', 'threads']);
  assert.deepEqual(calls.patches.at(-1), { order: ids() });
  assert.deepEqual([...drawer.element.querySelectorAll('[data-section]')].map(el => el.dataset.section), ids());
  move('world', 'moveUp').click();
  const id = 'c_0123abcd', title = '<img src=x onerror=alert(1)>';
  runtime.updateSettings({ customSections: [{ id, title, shape: 'text', mode: 'show', period: 3 }], order: ['unknown', 'world', id, 'world'] });
  assert.deepEqual(ids().slice(0, 3), ['world', id, 'offscreen']);
  assert.equal(row(id).querySelector('.st-sable-settings-section-name').textContent, title);
  assert.equal(row(id).querySelector('img, [name="shape"]'), null);
  assert.equal(row(id).querySelector('[name="period"]').value, '3');
  move(id, 'moveUp').click();
  assert.equal(ids()[0], id);
  assert.equal(move(id, 'moveUp').disabled, true);
  assert.equal(dom.window.document.activeElement, move(id, 'moveDown'), 'focus stays on an enabled move control');
  change(`[data-section="${id}"] [name="period"]`, '7');
  assert.equal(runtime.snapshot().settings.customSections[0].period, 7);
  assert.equal(query(`[data-custom-id="${id}"] [name="period"]`).value, '7');
  change('[name="perChatOverrides"]', true);
  change(`[data-section="${id}"] [name="mode"]`, 'inject');
  assert.equal(runtime.snapshot().settings.customSections[0].mode, 'show');
  assert.equal(runtime.snapshot().modes[id], 'inject');
  assert.deepEqual(calls.modes.at(-1), [id, 'inject']);
  change(`[data-custom-id="${id}"] [name="title"]`, 'Changed title');
  assert.equal(row(id).querySelector('.st-sable-settings-section-name').textContent, 'Changed title');
  assert.equal(move(id, 'moveUp').getAttribute('aria-label'), 'Changed title: Move up');
  change(`[data-custom-id="${id}"] [name="period"]`, '4');
  assert.equal(row(id).querySelector('[name="period"]').value, '4');
  const remove = query(`[data-custom-id="${id}"] .st-sable-custom-actions button`);
  remove.click(); remove.click();
  assert.equal(row(id), null);
  assert.equal(runtime.snapshot().settings.order.includes(id), false);
  button('Add block').click();
  const added = runtime.snapshot().settings.customSections[0].id;
  assert.equal(ids().at(-1), added);
  assert.equal(move(added, 'moveDown').disabled, true);
  const style = dom.window.document.createElement('style');
  style.textContent = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  dom.window.document.head.append(style);
  const computed = dom.window.getComputedStyle(move(added, 'moveUp'));
  assert.ok(parseFloat(computed.minHeight) >= 36);
  assert.ok(parseFloat(computed.minWidth) >= 36);
});

test('card colour rows follow sections, write colours, reset and refresh custom definitions', t => {
  const { runtime, ui, query, change, input, button, dom } = setup(t);
  const drawer = createDrawer(runtime, { document: dom.window.document }); t.after(() => drawer.dispose());
  const custom = { id: 'c_0123abcd', title: '<Clues>', icon: '\u{1f50d}', shape: 'list', mode: 'show', period: 1 };
  runtime.updateSettings({ customSections: [custom], order: [custom.id, 'threads', 'world'] });
  const rows = () => [...ui.element.querySelectorAll('[data-card-color]')];
  assert.deepEqual(rows().map(row => row.dataset.cardColor), runtime.snapshot().settings.order);
  assert.equal(rows()[0].querySelector('label').textContent.trim(), '\u{1f50d} <Clues>');
  assert.equal(rows()[0].querySelector('clues'), null);
  const selector = '[name="cardColors.world"]';
  input(selector, '#abcdef');
  assert.equal(drawer.element.querySelector('[data-section="world"]').style.getPropertyValue('--st-sable-accent'), '#abcdef');
  assert.equal(runtime.snapshot().settings.visual.cardColors.world, undefined);
  change(selector, '#abcdef');
  assert.equal(runtime.snapshot().settings.visual.cardColors.world, '#abcdef');
  const auto = query('[data-card-color="world"] button');
  assert.equal(auto.getAttribute('aria-pressed'), 'false'); auto.click();
  assert.equal(Object.hasOwn(runtime.snapshot().settings.visual.cardColors, 'world'), false);
  assert.equal(auto.getAttribute('aria-pressed'), 'true');
  assert.equal(query(selector).value, runtime.snapshot().settings.visual.accent);
  change('[name="accent"]', '#112233'); assert.equal(query(selector).value, '#112233');
  button('Add block').click();
  assert.deepEqual(rows().map(row => row.dataset.cardColor), runtime.snapshot().settings.order);
  assert.equal(rows().length, 12);
  runtime.updateSettings({ customSections: [] }); assert.equal(rows().length, 10);
});
