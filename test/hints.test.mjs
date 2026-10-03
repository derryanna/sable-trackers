import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');

function setup(t, { settings = {}, profiles, stale = false, onSettings } = {}) {
  const dom = new JSDOM('<body><div id="extensions-settings-button"><button class="drawer-toggle"></button></div><div id="extensionsMenu"></div></body>', { pretendToBeVisual: true });
  const fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, settings);
  if (profiles) fake.ctx.extensionSettings.connectionManager.profiles = profiles;
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state: structuredClone(fixture), ...(stale ? { stale: true } : {}) }] };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document: dom.window.document, onSettings });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const document = dom.window.document;
  const query = selector => document.querySelector(selector);
  const hint = () => query('.st-sable-hint');
  const change = (element, value) => {
    if (element.type === 'checkbox') element.checked = value; else element.value = value;
    element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  return { dom, document, fake, runtime, ui, query, hint, change };
}

test('three hints follow each other above the card list and «Понятно» ends them', t => {
  const { ui, runtime, hint, query } = setup(t);
  ui.open();
  const element = hint();
  assert.equal(element.getAttribute('role'), 'dialog');
  assert.equal(element.hidden, false);
  assert.equal(element.nextElementSibling, query('.st-sable-cards'), 'above the card list');
  assert.equal(element.getAttribute('aria-labelledby'), 'st-sable-hint-title');
  assert.equal(query('#st-sable-hint-title').textContent, 'Проверь соединение');
  const select = element.querySelector('select[data-control="hint-profile"]');
  assert.deepEqual([...select.options].map(option => option.value), ['', 'side']);
  assert.equal(select.value, 'side');
  const next = () => element.querySelector('[data-control="hint-next"]');
  assert.equal(next().textContent, 'Дальше');
  assert.equal(element.querySelector('[data-control="hint-never"]').parentElement.textContent, 'Больше не показывать');
  next().click();
  assert.equal(query('#st-sable-hint-title').textContent, 'Выбери, что нравится');
  assert.deepEqual([...element.querySelectorAll('.st-sable-hint-legend > div')].map(line => line.textContent),
    ['в промпт — модель это видит', 'показ — только тебе', 'выкл — не обновляется']);
  next().click();
  assert.equal(query('#st-sable-hint-title').textContent, 'Наслаждайся');
  assert.match(element.textContent, /Напиши персонажу — после его ответа карточки заполнятся/);
  assert.equal(next().textContent, 'Понятно');
  assert.equal(runtime.snapshot().settings.hints.done, false, 'reading is not finishing');
  next().click();
  assert.equal(runtime.snapshot().settings.hints.done, true);
  assert.equal(hint().hidden, true);
  assert.equal(hint().childElementCount, 0);
  // «Показать подсказки снова» in Settings starts again from the first hint.
  runtime.updateSettings({ hints: { done: false } });
  assert.equal(hint().hidden, false);
  assert.equal(query('#st-sable-hint-title').textContent, 'Проверь соединение');
});

test('«Больше не показывать» sets hints.done at any step; done hints never show', t => {
  const { ui, runtime, hint, change } = setup(t);
  ui.open();
  hint().querySelector('[data-control="hint-next"]').click();
  change(hint().querySelector('[data-control="hint-never"]'), true);
  assert.equal(runtime.snapshot().settings.hints.done, true);
  assert.equal(hint().hidden, true);
  const done = setup(t, { settings: { hints: { done: true } } });
  done.ui.open();
  assert.equal(done.hint().hidden, true);
});

test('the first hint writes the profile inline, lists only chat-completion profiles as selectable and explains when none exist', t => {
  const { runtime, hint, change } = setup(t, { settings: { profileId: '', language: 'en' },
    profiles: [{ id: 'side', name: '<b>Side</b>', mode: 'cc' }, { id: 'text', name: 'Text', mode: 'tc' }] });
  const select = () => hint().querySelector('select');
  assert.deepEqual([...select().options].map(option => [option.value, option.textContent, option.disabled]),
    [['', 'Select a connection profile', false], ['side', '<b>Side</b>', false], ['text', 'Text (not chat-completion)', true]]);
  assert.equal(hint().querySelector('b'), null, 'profile names are text');
  change(select(), 'side');
  assert.equal(runtime.snapshot().settings.profileId, 'side');
  assert.equal(select().value, 'side');
  const none = setup(t, { settings: { profileId: '', language: 'en' }, profiles: [{ id: 'text', name: 'Text', mode: 'tc' }] });
  assert.equal(none.hint().querySelector('select'), null);
  assert.match(none.hint().textContent, /Create a profile in Connection Manager/);
});

test('the first successful run ends the hints; a failed one does not', async t => {
  const { runtime, hint, fake } = setup(t);
  fake.respond('no json at all');
  await runtime.refresh();
  assert.equal(runtime.snapshot().settings.hints.done, false);
  fake.respond('<sable_state>{"world":{"location":"Observatory"}}</sable_state>');
  await runtime.refresh();
  assert.equal(runtime.snapshot().settings.hints.done, true);
  assert.equal(hint().hidden, true);
});

test('no usable profile: a permanent status button opens settings on Connection and refresh is disabled', t => {
  for (const [settings, profiles] of [[{ profileId: '' }], [{ profileId: 'gone' }], [{ profileId: 'text' }, [{ id: 'text', name: 'Text', mode: 'tc' }]]]) {
    const groups = [];
    const { query, runtime, ui } = setup(t, { settings, profiles, onSettings: group => groups.push(group) });
    ui.open();
    assert.ok(runtime.snapshot().profileIssue);
    const setupButton = query('.st-sable-status [data-control="setup"]');
    assert.equal(setupButton.tagName, 'BUTTON');
    assert.equal(setupButton.textContent, 'Нет профиля модели → настроить');
    const refresh = query('.st-sable-header .fa-rotate').parentElement;
    assert.equal(refresh.disabled, true);
    assert.equal(refresh.title, 'Нет профиля модели → настроить');
    setupButton.click();
    assert.deepEqual(groups, ['connection']);
    assert.equal(runtime.snapshot().settings.groups.connection, true);
    assert.equal(ui.element.hidden, true, 'the gear path closes the drawer');
  }
  const ok = setup(t);
  assert.equal(ok.runtime.snapshot().profileIssue, null);
  assert.equal(ok.query('.st-sable-status [data-control="setup"]'), null);
  assert.equal(ok.query('.st-sable-header .fa-rotate').parentElement.disabled, false);
});

test('the setup button follows the gear path into the Extensions tab and opens the Connection group', t => {
  const { query, document, runtime } = setup(t, { settings: { profileId: '', groups: { connection: false } } });
  const host = document.createElement('div'); host.id = 'st-sable-settings';
  const group = document.createElement('details'); group.dataset.group = 'connection';
  let scrolled; group.scrollIntoView = () => { scrolled = true; };
  host.append(group); document.body.append(host);
  let tabClicks = 0;
  query('#extensions-settings-button .drawer-toggle').addEventListener('click', () => tabClicks++);
  query('[data-control="setup"]').click();
  assert.equal(tabClicks, 1);
  assert.equal(runtime.snapshot().settings.groups.connection, true);
  assert.equal(scrolled, true);
});

test('an edited latest reply shows «Состояние устарело» with a recompute button and dims the cards', async t => {
  const { query, runtime, fake } = setup(t, { stale: true });
  const status = query('.st-sable-status-stale');
  assert.match(status.textContent, /^Состояние устарело/);
  const recompute = status.querySelector('[data-control="recompute"]');
  assert.equal(recompute.textContent, '⟳ Пересчитать');
  assert.ok(query('[data-section="world"]').classList.contains('st-sable-stale'));
  assert.ok([...query('.st-sable-cards').querySelectorAll('.st-sable-card')].every(card => card.classList.contains('st-sable-stale')));
  recompute.click();
  await runtime.idle();
  assert.equal(fake.calls.requests.length, 1, 'one edit run');
  assert.equal(runtime.snapshot().entry.stale, undefined);
  assert.equal(query('.st-sable-status-stale'), null);
  assert.equal(query('.st-sable-stale'), null);
  // A new edit marks it stale again without a request.
  fake.ctx.chat[0].mes = 'Edited again';
  await fake.emit('MESSAGE_EDITED', 0);
  await runtime.idle();
  assert.equal(fake.calls.requests.length, 1);
  assert.ok(query('.st-sable-status-stale [data-control="recompute"]'));
});

test('every mode menu ends with the muted legend, aggregate chips included; the folder menu has none', t => {
  const { query, runtime, ui } = setup(t, { settings: { language: 'en' } });
  ui.open();
  query('[data-section="world"] [data-control="mode"]').click();
  const legend = query('[role="menu"] > .st-sable-menu-legend');
  assert.equal(legend, query('[role="menu"]').lastElementChild);
  assert.deepEqual([...legend.children].map(line => line.textContent), ['inject — the model sees it', 'show — only you', 'off — not updated']);
  query('[data-section="world"] [data-control="mode"]').click();
  runtime.setPack('combat', true);
  const groupChip = query('.st-sable-group[data-container="pack:combat"] .st-sable-group-header [data-control="mode"]');
  groupChip.click();
  assert.ok(query('[role="menu"] > .st-sable-menu-legend'));
  groupChip.click();
  query('[data-section="world"] [data-control="folder"]').click();
  assert.ok(query('[role="menu"]'));
  assert.equal(query('[role="menu"] .st-sable-menu-legend'), null);
});

test('T25 styles: 12 px legend, 36 px hint controls, a short fade the effects-off rule stops', () => {
  const block = css.slice(css.indexOf('/* T25 */'));
  assert.ok(block.length > 10);
  assert.match(block, /\.st-sable-menu-legend \{[^}]*font-size: 12px/);
  assert.match(block, /\.st-sable-hint-next, \.st-sable-status-setup, \.st-sable-recompute \{[^}]*min-height: 36px/);
  assert.match(block, /\.st-sable-hint-never \{[^}]*min-height: 36px/);
  for (const [, amount] of block.matchAll(/(?:animation|transition):[^;}]*?(\d+)ms/g)) assert.ok(Number(amount) <= 150);
  assert.match(block, /\.st-sable-card\.st-sable-stale::before \{ opacity: \.35; \}/);
  assert.match(css, /\.st-sable-drawer\[data-st-sable-effects="off"\] \*,/, 'the off rule covers the hint inside the drawer');
});
