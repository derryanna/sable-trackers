import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { GROUP_IDS, VISUAL_DEFAULTS } from '../src/settings.js';
import { STRINGS } from '../src/i18n.js';
import { createFakeST } from './fakes/st.mjs';

// SPEC §28: settings in one tier. Synthetic fixtures only.
const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
const legacy = JSON.parse(await readFile(new URL('../fixtures/legacy-message.json', import.meta.url), 'utf8'));
const CLUES = { id: 'c_0a1b2c3d', title: 'Clues', icon: '🔍', instructions: 'Track clues.', shape: 'list', max: 8, mode: 'show', period: 2 };

function setup(t, { settings = {}, ring = true, chat } = {}) {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div><div id="extensions_settings2"></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, fake = createFakeST();
  if (chat) fake.ctx.chat.push(...chat); else fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { language: 'en', customSections: [structuredClone(CLUES)], ...settings });
  if (ring) fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state: structuredClone(fixture) }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const patches = [];
  const wrapped = { ...runtime, updateSettings(patch) { patches.push(patch); runtime.updateSettings(patch); } };
  const drawer = createDrawer(wrapped, { document }); drawer.open();
  t.after(() => { drawer.dispose(); runtime.dispose(); dom.window.close(); });
  const query = selector => drawer.element.querySelector(selector);
  const card = id => query(`.st-sable-card[data-section="${id}"]`);
  const control = (element, name) => element.querySelector(`[data-control="${name}"]`);
  const fire = (element, type) => element.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  const key = (element, name) => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  return { dom, document, fake, runtime, drawer, patches, query, card, control, fire, key };
}

test('i18n: every T26 key exists in ru and en, and every settings group has a summary', () => {
  const keys = ['menu.period', 'menu.periodDossiers', 'card.color', 'card.colorLabel', 'legacy.banner', 'legacy.import', 'legacy.hide',
    ...GROUP_IDS.map(id => `group.${id}.summary`)];
  for (const language of ['ru', 'en']) for (const name of keys) assert.equal(typeof STRINGS[language][name], 'string', `${language}: ${name}`);
  assert.equal(STRINGS.ru['group.visual.summary'], 'панель, карточки, фон, цвета карточек, эффекты');
  assert.equal(STRINGS.en['group.visual.summary'], 'panel, cards, background, card colours, effects');
  assert.equal(STRINGS.ru['menu.period'], 'Раз в N ответов');
  assert.equal(STRINGS.ru['card.color'], 'Цвет…');
});

test('settings groups show a muted summary line while folded and hide it while open', t => {
  const dom = new JSDOM('<body><div id="extensions_settings2"></div></body>');
  const fake = createFakeST();
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createSettings(runtime, { document: dom.window.document, getContext: fake.getContext });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const groups = [...ui.element.querySelectorAll('details[data-group]')];
  assert.deepEqual(groups.map(group => group.dataset.group).sort(), [...GROUP_IDS].sort());
  for (const group of groups) {
    const note = group.querySelector(':scope > summary > .st-sable-group-note');
    assert.ok(note, `${group.dataset.group} has a summary line`);
    assert.equal(note.textContent, STRINGS.ru[`group.${group.dataset.group}.summary`]);
    assert.equal(note.hidden, group.open, `${group.dataset.group}: hidden only while open`);
  }
  // Connection is open by default; Appearance is folded and lists its parts.
  const note = id => ui.element.querySelector(`[data-group="${id}"] .st-sable-group-note`);
  assert.equal(note('connection').hidden, true);
  assert.equal(note('visual').hidden, false);
  assert.equal(note('visual').textContent, 'панель, карточки, фон, цвета карточек, эффекты');
  runtime.updateSettings({ groups: { visual: true } });
  assert.equal(note('visual').hidden, true);
  runtime.updateSettings({ groups: { visual: false } });
  assert.equal(note('visual').hidden, false);
  runtime.updateSettings({ language: 'en' });
  assert.equal(note('visual').textContent, 'panel, cards, background, card colours, effects');
  const css = readFile(new URL('../style.css', import.meta.url), 'utf8');
  return css.then(text => assert.match(text, /\.st-sable-group\[open\] > \.st-sable-group-summary > \.st-sable-group-note \{ display: none; \}/));
});

test('mode menu: «Every N replies» is the last row and writes the global period of a built-in section', t => {
  const { card, control, query, fire, key, runtime, patches, document } = setup(t, { settings: { perChatOverrides: true } });
  control(card('threads'), 'mode').click();
  const menu = query('[role="menu"]');
  // The period row is the last control; only the muted legend (SPEC §27) may follow it.
  const row = menu.querySelector('.st-sable-mode-period');
  assert.ok(row && (!row.nextElementSibling || row.nextElementSibling.classList.contains('st-sable-menu-legend')), 'the period row comes last');
  assert.equal(row.textContent, 'Every N replies');
  const input = row.querySelector('input[name="period"]');
  assert.equal(input.type, 'number');
  assert.deepEqual([input.min, input.max], ['0', '99']);
  assert.equal(input.value, String(runtime.snapshot().settings.sections.threads.period));
  assert.equal(menu.querySelector('.st-sable-mode-period-hint'), null, 'no hint outside dossiers');
  // Tab from the options reaches the input.
  key(document.activeElement, 'Tab');
  assert.equal(document.activeElement, input);
  input.value = '4'; fire(input, 'change');
  assert.deepEqual(patches.at(-1), { sections: { threads: { period: 4 } } });
  assert.equal(runtime.snapshot().settings.sections.threads.period, 4);
  assert.equal(query('[role="menu"]'), null, 'the menu closes after a write');
  assert.deepEqual(runtime.snapshot().store.modeOverride, {}, 'never a per-chat override');
  // Out of range values clamp to 99; invalid text writes nothing.
  control(card('threads'), 'mode').click();
  let field = query('[role="menu"] input[name="period"]');
  field.value = '250'; fire(field, 'change');
  assert.equal(runtime.snapshot().settings.sections.threads.period, 99);
  const count = patches.length;
  control(card('threads'), 'mode').click();
  field = query('[role="menu"] input[name="period"]');
  field.value = '-3'; fire(field, 'change');
  assert.equal(patches.length, count);
  // Escape drops the typed value.
  control(card('threads'), 'mode').click();
  field = query('[role="menu"] input[name="period"]');
  field.focus(); field.value = '7'; key(field, 'Escape');
  assert.equal(query('[role="menu"]'), null);
  assert.equal(patches.length, count);
  // A tap outside keeps the typed value.
  control(card('threads'), 'mode').click();
  field = query('[role="menu"] input[name="period"]');
  field.value = '6';
  query('.st-sable-status').dispatchEvent(new document.defaultView.MouseEvent('pointerdown', { bubbles: true }));
  assert.equal(runtime.snapshot().settings.sections.threads.period, 6);
});

test('mode menu period: dossiers keep their special 0 with a hint; custom blocks write their own period', t => {
  const { card, control, query, fire, runtime, patches } = setup(t);
  control(card('dossiers'), 'mode').click();
  assert.equal(query('[role="menu"] input[name="period"]').value, '0');
  assert.equal(query('[role="menu"] .st-sable-mode-period-hint').textContent, 'Dossiers check for new NPCs on every reply.');
  control(card('dossiers'), 'mode').click();
  control(card(CLUES.id), 'mode').click();
  const input = query('[role="menu"] input[name="period"]');
  assert.equal(input.value, '2');
  input.value = '5'; fire(input, 'change');
  const written = patches.at(-1);
  assert.deepEqual(Object.keys(written), ['customSections']);
  assert.equal(written.customSections.find(item => item.id === CLUES.id).period, 5);
  assert.equal(runtime.snapshot().settings.customSections.find(item => item.id === CLUES.id).period, 5);
});

test('mode menu period: group chips and the folder menu have no period row', t => {
  const { card, control, query, runtime } = setup(t);
  runtime.updateSettings({ folders: [{ id: 'f_00000001', title: 'World', icon: '', members: ['world', 'threads'] }] });
  control(query('[data-folder]'), 'mode').click();
  assert.ok(query('[role="menu"]'));
  assert.equal(query('[role="menu"] input[name="period"]'), null);
  control(card('offscreen'), 'folder').click();
  assert.equal(query('[role="menu"] input[name="period"]'), null);
});

test('card footer «Colour…» opens an inline swatch row that writes the full visual object', t => {
  const { card, control, fire, runtime, patches } = setup(t, { settings: { visual: { ...VISUAL_DEFAULTS, opacity: 0.8, cardColors: { world: '#112233' } } } });
  const toggle = () => control(card('threads'), 'color');
  assert.equal(toggle().textContent.trim(), 'Colour…');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(card('threads').querySelector('.st-sable-color-row'), null);
  toggle().click();
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  const row = card('threads').querySelector('.st-sable-card-footer > .st-sable-color-row');
  assert.ok(row);
  assert.equal(toggle().getAttribute('aria-controls'), row.id);
  const input = row.querySelector('input[type="color"]'), auto = control(row, 'color-auto');
  assert.equal(input.value, VISUAL_DEFAULTS.accent, 'automatic shows the accent');
  assert.equal(auto.textContent, 'auto');
  assert.equal(auto.getAttribute('aria-pressed'), 'true');
  // Preview on input touches only the card; change writes.
  input.value = '#aa5500'; fire(input, 'input');
  assert.equal(card('threads').style.getPropertyValue('--st-sable-accent'), '#aa5500');
  assert.equal(runtime.snapshot().settings.visual.cardColors.threads, undefined);
  fire(input, 'change');
  const visual = patches.at(-1).visual;
  assert.deepEqual(Object.keys(patches.at(-1)), ['visual']);
  assert.equal(visual.opacity, 0.8, 'the other visual keys travel with it');
  assert.deepEqual(visual.cardColors, { world: '#112233', threads: '#aa5500' });
  assert.deepEqual(runtime.snapshot().settings.visual.cardColors, { world: '#112233', threads: '#aa5500' });
  // The row stays open after the write and reflects it.
  const after = card('threads').querySelector('.st-sable-color-row');
  assert.equal(after.querySelector('input').value, '#aa5500');
  assert.equal(control(after, 'color-auto').getAttribute('aria-pressed'), 'false');
  control(after, 'color-auto').click();
  assert.deepEqual(patches.at(-1).visual.cardColors, { world: '#112233' });
  assert.equal(patches.at(-1).visual.opacity, 0.8);
  toggle().click();
  assert.equal(card('threads').querySelector('.st-sable-color-row'), null);
});

test('every card footer has «Colour…»: custom and pack cards write their own id, person cards the npcs colour', t => {
  const { card, control, query, fire, runtime } = setup(t, { settings: { packDefaults: ['combat'] } });
  for (const section of [...query('.st-sable-cards').querySelectorAll('.st-sable-card[data-section]')]) {
    const footer = section.querySelector('.st-sable-card-footer');
    if (footer) assert.ok(control(footer, 'color'), `${section.dataset.section} has a colour button`);
  }
  control(card(CLUES.id), 'color').click();
  let input = card(CLUES.id).querySelector('.st-sable-color-row input');
  input.value = '#336699'; fire(input, 'change');
  assert.equal(runtime.snapshot().settings.visual.cardColors[CLUES.id], '#336699');
  control(card('combat_stats'), 'color').click();
  input = card('combat_stats').querySelector('.st-sable-color-row input');
  input.value = '#993333'; fire(input, 'change');
  assert.equal(runtime.snapshot().settings.visual.cardColors.combat_stats, '#993333');
  runtime.updateSettings({ layout: 'people' });
  const person = query('.st-sable-card[data-person]');
  runtime.updateSettings({ folded: { ...runtime.snapshot().settings.folded, [`person:${person.dataset.person}`]: false } });
  const personCard = () => [...query('.st-sable-cards').querySelectorAll('[data-person]')].find(item => item.dataset.person === person.dataset.person);
  control(personCard(), 'color').click();
  input = personCard().querySelector('.st-sable-color-row input');
  assert.equal(input.name, 'cardColors.npcs');
  input.value = '#228844'; fire(input, 'change');
  assert.equal(runtime.snapshot().settings.visual.cardColors.npcs, '#228844');
  assert.equal(personCard().style.getPropertyValue('--st-sable-accent'), '#228844');
});

test('legacy banner: shown above the cards with old data and an empty ring; Import seeds, never automatically', async t => {
  const { query, control, runtime, drawer } = setup(t, { ring: false, chat: [structuredClone(legacy)] });
  const banner = query('.st-sable-legacy-banner');
  assert.equal(banner.hidden, false);
  // The first-run hint (SPEC §27) may sit between the banner and the cards; the banner still precedes them.
  assert.ok(banner.compareDocumentPosition(query('.st-sable-cards')) & 4, 'the banner sits above the cards');
  assert.equal(query('.st-sable-legacy-text').textContent, 'This chat has old Sable data');
  assert.deepEqual([control(banner, 'legacy-import').textContent, control(banner, 'legacy-hide').textContent], ['Import', 'Hide']);
  drawer.close(); drawer.open();
  assert.equal(runtime.snapshot().store.ring.length, 0, 'opening never imports');
  control(banner, 'legacy-import').click(); await Promise.resolve();
  assert.equal(runtime.snapshot().store.ring.length, 1);
  assert.equal(banner.hidden, true);
  assert.equal(runtime.snapshot().legacyBannerHidden, false, 'importing does not set the hide flag');
});

test('legacy banner: «Hide» stores a per-chat flag exposed through the snapshot; other chats still show it', async t => {
  const { query, control, runtime, fake } = setup(t, { ring: false, chat: [structuredClone(legacy)] });
  const banner = query('.st-sable-legacy-banner');
  assert.equal(runtime.snapshot().legacyBannerHidden, false);
  control(banner, 'legacy-hide').click(); await Promise.resolve();
  assert.equal(banner.hidden, true);
  assert.equal(runtime.snapshot().legacyBannerHidden, true);
  assert.equal(runtime.snapshot().canSeedLegacy, true, 'the data is still importable');
  assert.equal(fake.ctx.chatMetadata.sableTrackers.legacyBannerHidden, true);
  assert.equal(runtime.snapshot().store.ring.length, 0, 'hiding never imports');
  assert.equal(runtime.hideLegacyBanner(), false, 'a second hide is a no-op');
  const hidden = fake.ctx.chatMetadata;
  fake.ctx.chatId = 'chat-b'; fake.ctx.chatMetadata = {}; await fake.emit('CHAT_CHANGED');
  assert.equal(banner.hidden, false, 'another chat with old data shows the banner');
  fake.ctx.chatId = 'chat-a'; fake.ctx.chatMetadata = hidden; await fake.emit('CHAT_CHANGED');
  assert.equal(banner.hidden, true);
});

test('legacy banner: hidden in a chat that already has a state', t => {
  const { query } = setup(t);
  assert.equal(query('.st-sable-legacy-banner').hidden, true);
});
