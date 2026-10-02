import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer, packTitle } from '../src/ui/drawer.js';
import { createSettings } from '../src/ui/settings.js';
import { createRuntime } from '../src/run.js';
import { GROUP_IDS } from '../src/settings.js';
import { BUILTIN_PACKS } from '../src/packs/index.js';
import { groupedOrder, orderedSectionIds, getSections, SECTIONS } from '../src/sections.js';
import { createFakeST } from './fakes/st.mjs';

const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const XSS = '<img src=x onerror="globalThis.pwned=true">';
// Synthetic pack state (fixtures/state-packs.json belongs to T8c); no real RP content.
const packState = () => ({
  combat_scene: 'Two guards at the gate, melee range.',
  combat_stats: [
    { key: 'Guard · HP', value: 40, max: 100, note: 'blade cut', delta: -12 },
    { key: `${XSS} %`, value: 15, max: 100 },
    { key: 'rounds', value: 3, max: null, unit: 'r', delta: 1, note: 'third exchange' },
    { key: 'hit %', value: 60, max: null },
  ],
  combat_effects: ['bleeding', `<b>stunned</b>`],
  combat_odds: [{ key: 'crit %', value: '15 (Guard; estimate)' }, { key: 'initiative', value: 'Guard' }],
  combat_roll: 'LAST ROLL: legacy result',
});
const userPack = () => ({ id: 'p_0123abcd', title: 'Resources', icon: '📦', description: 'Supplies', scope: false, rules: 'Resource rules.',
  sections: [{ key: 'stock', title: 'Stock', icon: 'fa-box', instructions: 'Stock.', shape: 'stats', max: 8, mode: 'inject', period: 1 },
    { key: 'odds', title: 'Odds', icon: '', instructions: 'Odds.', shape: 'kv', max: 4, mode: 'inject', period: 1 }] });

function setup(t, { state = packState(), random = () => 0.86, settings = {} } = {}) {
  const dom = new JSDOM('<body><div id="extensions-settings-button"><button class="drawer-toggle"></button></div><div id="extensionsMenu"></div><div id="extensions_settings2"></div><textarea></textarea></body>', { pretendToBeVisual: true });
  const document = dom.window.document;
  const fake = createFakeST(); fake.add();
  fake.ctx.extensionSettings.sableTrackers = { ...fake.ctx.extensionSettings.sableTrackers, ...settings };
  fake.ctx.chatMetadata.sableTrackers = { ring: [{ mesId: 0, swipeId: 0, turn: 3, state: { world: { location: 'Gate' }, ...state } }],
    lastRun: { at: 1234567890000, ok: true, ms: 250, inTok: 123, outTok: 45 } };
  const runtime = createRuntime(fake.getContext, { random }); runtime.start();
  const calls = { packs: [], edits: [], rolls: [], patches: [], packModes: [] };
  const wrapped = { ...runtime,
    setPackMode(id, mode) { calls.packModes.push([id, mode]); return runtime.setPackMode(id, mode); },
    rollDice(id, key, chance) { calls.rolls.push([id, key, chance]); return runtime.rollDice(id, key, chance); },
    setPack(id, on) { calls.packs.push([id, on]); return runtime.setPack(id, on); },
    editState(id, value) { calls.edits.push([id, value]); return runtime.editState(id, value); },
    updateSettings(patch) { calls.patches.push(patch); runtime.updateSettings(patch); } };
  const toasts = [], previousToastr = globalThis.toastr;
  globalThis.toastr = Object.fromEntries(['success', 'warning', 'error', 'info'].map(type => [type, message => toasts.push([type, message])]));
  const ui = createDrawer(wrapped, { document });
  const settingsUi = createSettings(wrapped, { document, getContext: fake.getContext });
  t.after(() => { ui.dispose(); settingsUi.dispose(); runtime.dispose(); dom.window.close(); globalThis.toastr = previousToastr; });
  const query = selector => document.querySelector(selector);
  const card = id => ui.element.querySelector(`[data-section="${id}"]`);
  const group = id => ui.element.querySelector(`.st-sable-group[data-pack="${id}"]`);
  const members = id => [...(group(id)?.querySelectorAll(':scope > .st-sable-group-body > .st-sable-card') ?? [])].map(item => item.dataset.section);
  const shown = () => [...query('.st-sable-cards').children].map(item => item.dataset.section ?? `pack:${item.dataset.pack}`);
  const sheet = () => query('#st-sable-sheet');
  const row = id => sheet().querySelector(`[data-pack="${id}"]`);
  const key = (element, name) => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  const pointer = (target, type = 'pointerdown') => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  const styled = () => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); return element => dom.window.getComputedStyle(element); };
  const digest = () => fake.calls.prompts.at(-1)[1];
  const sq = selector => settingsUi.element.querySelector(selector);
  const change = (selector, value) => {
    const input = sq(selector);
    if (input.type === 'checkbox') input.checked = value; else input.value = value;
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  const button = (scope, text) => [...sq(scope).querySelectorAll('button')].find(b => b.textContent === text);
  return { dom, document, fake, runtime, ui, settingsUi, calls, toasts, query, card, group, members, shown, sheet, row, key, pointer, styled, digest, sq, change, button };
}

test('packTitle pulls the 18+ mark out of a title', () => {
  assert.deepEqual(packTitle('Интим (18+)'), { adult: true, text: 'Интим' });
  assert.deepEqual(packTitle('Intimacy (18+)'), { adult: true, text: 'Intimacy' });
  assert.deepEqual(packTitle('Combat'), { adult: false, text: 'Combat' });
  assert.deepEqual(packTitle('18+'), { adult: true, text: '18+' });
});

test('sheet: the header button opens it, switches toggle packs per chat without a run, Escape / ✕ / tap outside close it', async t => {
  const { ui, query, sheet, row, card, members, shown, runtime, fake, calls, key, pointer, document, styled } = setup(t);
  ui.open();
  const packs = query('.st-sable-header [data-control="packs"]');
  assert.equal(packs, query('.st-sable-header button:nth-of-type(4)'), 'the pack button sits before ✕');
  assert.ok(packs.querySelector('.fa-solid.fa-box-open'));
  assert.equal(packs.getAttribute('aria-label'), 'Наборы');
  assert.equal(sheet().hidden, true);
  packs.click();
  assert.equal(sheet().hidden, false);
  assert.equal(packs.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, sheet().querySelector('.st-sable-sheet-header button'));
  assert.equal(sheet().querySelector('.st-sable-sheet-title').textContent, 'Наборы');
  assert.deepEqual([...sheet().querySelectorAll('[data-pack]')].map(item => item.dataset.pack), ['combat', 'intimacy']);
  assert.equal(row('combat').querySelector('.st-sable-pack-title').textContent, 'Бой');
  assert.equal(row('combat').querySelector('.st-sable-adult'), null);
  assert.equal(row('intimacy').querySelector('.st-sable-pack-title > span').textContent, 'Интим');
  assert.equal(row('intimacy').querySelector('.st-sable-adult').textContent, '18+');
  assert.ok(row('combat').querySelector('.st-sable-pack-desc').textContent.length > 0);
  assert.ok(row('combat').querySelector('.st-sable-pack-icon .fa-hand-fist'));
  const toggle = () => row('combat').querySelector('[role="switch"]');
  assert.equal(toggle().getAttribute('aria-checked'), 'false');
  assert.equal(row('combat').querySelector('[role="radiogroup"]'), null, 'scope toggle only while on');
  assert.equal(card('combat_stats'), null);
  const computed = styled();
  assert.ok(parseFloat(computed(toggle()).minHeight) >= 36);
  toggle().focus(); toggle().click();
  assert.deepEqual(calls.packs, [['combat', true]]);
  assert.deepEqual(runtime.snapshot().packs.enabled, ['combat']);
  await tick(); assert.deepEqual(fake.ctx.chatMetadata.sableTrackers.packs, ['combat'], 'the chat list persists');
  assert.equal(fake.calls.requests.length, 0, 'switching never starts a run');
  assert.equal(toggle().getAttribute('aria-checked'), 'true');
  assert.equal(document.activeElement, toggle(), 'focus survives the re-render');
  assert.equal(sheet().hidden, false);
  for (const id of ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds']) assert.ok(card(id), `${id} card appears`);
  assert.equal(shown().at(-1), 'pack:combat', 'the pack group follows the existing cards (SPEC §15)');
  assert.deepEqual(members('combat'), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds'], 'its cards are nested inside');
  assert.ok(card('combat_stats').querySelector('.st-sable-card-title .fa-heart-pulse'));
  assert.equal(card('combat_stats').querySelector('.st-sable-card-label').textContent, 'Показатели боя');
  const scope = row('combat').querySelector('[role="radiogroup"]');
  assert.ok(scope);
  assert.deepEqual([...scope.querySelectorAll('[role="radio"]')].map(item => [item.textContent, item.getAttribute('aria-checked')]), [['все', 'true'], ['только я', 'false'], ['кроме меня', 'false']]);
  for (const option of scope.querySelectorAll('[role="radio"]')) assert.ok(parseFloat(computed(option).minHeight) >= 36);
  scope.querySelector('[data-scope="user"]').focus(); scope.querySelector('[data-scope="user"]').click();
  assert.deepEqual(calls.patches.at(-1), { packScope: { combat: 'user' } });
  assert.equal(runtime.snapshot().settings.packScope.combat, 'user');
  assert.equal(row('combat').querySelector('[data-scope="user"]').getAttribute('aria-checked'), 'true');
  assert.equal(document.activeElement, row('combat').querySelector('[data-scope="user"]'));
  const patches = calls.patches.length;
  row('combat').querySelector('[data-scope="user"]').click();
  assert.equal(calls.patches.length, patches, 'the checked option writes nothing');
  row('combat').querySelector('[data-scope="others"]').click();
  assert.deepEqual(calls.patches.at(-1), { packScope: { combat: 'others' } });
  assert.equal(row('combat').querySelector('[data-scope="others"]').getAttribute('aria-checked'), 'true');
  assert.equal(computed(row('combat').querySelector('.st-sable-segment')).flexWrap, 'wrap');
  assert.ok(query('.st-sable-status .st-sable-pack-chip'), 'status lists the enabled pack');
  assert.equal(query('.st-sable-status .st-sable-pack-chip').textContent, 'Бой');
  key(document.activeElement, 'Escape');
  assert.equal(sheet().hidden, true);
  assert.equal(ui.element.hidden, false, 'Escape closes the sheet before the drawer');
  assert.equal(document.activeElement, packs);
  packs.click(); assert.equal(sheet().hidden, false);
  pointer(sheet()); assert.equal(sheet().hidden, true, 'a tap on the scrim closes');
  packs.click(); pointer(query('.st-sable-sheet-panel')); assert.equal(sheet().hidden, false, 'a tap inside stays');
  sheet().querySelector('.st-sable-sheet-header button').click();
  assert.equal(sheet().hidden, true); assert.equal(document.activeElement, packs);
  packs.click(); pointer(query('textarea'));
  assert.equal(ui.element.hidden, true); assert.equal(sheet().hidden, true, 'closing the drawer closes the sheet');
  ui.open(); packs.click();
  toggle().focus(); toggle().click();
  assert.deepEqual(runtime.snapshot().packs.enabled, []);
  assert.equal(card('combat_stats'), null, 'cards disappear when the pack is off');
  assert.equal(row('combat').querySelector('[role="radiogroup"]'), null);
  assert.equal(document.activeElement, toggle());
  assert.equal(query('.st-sable-status .st-sable-pack-chip'), null);
  assert.equal(runtime.snapshot().entry.state.combat_stats.length, 4, 'values stay in the ring');
  runtime.updateSettings({ visual: { icons: 'emoji' } });
  assert.equal(packs.textContent, '🎒');
  runtime.updateSettings({ language: 'en' });
  assert.equal(packs.getAttribute('aria-label'), 'Packs');
  assert.equal(row('intimacy').querySelector('.st-sable-pack-title > span').textContent, 'Intimacy');
  assert.equal(ui.element.querySelector('img'), null);
});

test('stats and tags render safely: bars, counters, units, delta badges with notes, chips; dice write the roll line', t => {
  const { ui, card, runtime, fake, calls, digest, query, styled } = setup(t);
  runtime.setPack('combat', true);
  ui.open();
  const stats = card('combat_stats');
  assert.ok(stats.textContent.includes(XSS), 'the key stays text');
  assert.equal(ui.element.querySelector('img, script'), null);
  assert.equal(globalThis.pwned, undefined);
  const rows = [...stats.querySelectorAll('.st-sable-stat-row')];
  assert.equal(rows.length, 4);
  const hp = rows[0];
  assert.equal(hp.tagName, 'SUMMARY', 'a delta row opens its note');
  assert.equal(hp.querySelector('.st-sable-scale-name').textContent, 'Guard · HP');
  const bar = hp.querySelector('[role="meter"]');
  assert.deepEqual([bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuenow')], ['100', '40']);
  assert.equal(bar.querySelector('.st-sable-bar-fill').style.transform, 'scaleX(0.4)');
  assert.equal(hp.querySelector('.st-sable-score').textContent, '40/100');
  assert.equal(hp.querySelector('.st-sable-badge').textContent, '−12');
  assert.ok(hp.querySelector('.st-sable-badge').classList.contains('st-sable-down'));
  const note = hp.closest('details');
  assert.equal(note.open, false);
  assert.equal(note.querySelector('.st-sable-reason').textContent, 'blade cut');
  note.open = true; runtime.publish();
  assert.equal(card('combat_stats').querySelector('details').open, true, 'opened notes survive renders');
  const rounds = [...card('combat_stats').querySelectorAll('.st-sable-stat-row')][2];
  assert.ok(rounds.classList.contains('st-sable-counter'));
  assert.equal(rounds.querySelector('[role="meter"]'), null, 'null max is a plain counter');
  assert.equal(rounds.querySelector('.st-sable-score').textContent, '3 r');
  assert.equal(rounds.querySelector('.st-sable-badge').textContent, '+1');
  assert.ok(rounds.querySelector('.st-sable-badge').classList.contains('st-sable-up'));
  const chips = [...card('combat_effects').querySelectorAll('.st-sable-chips > .st-sable-tag')];
  assert.deepEqual(chips.map(chip => chip.textContent), ['bleeding', '<b>stunned</b>']);
  assert.equal(card('combat_effects').querySelector('b'), null);
  assert.equal(card('combat_scene').querySelector('p').textContent, 'Two guards at the gate, melee range.');
  // Dice only on rows whose key ends in "%": two stats rows and one kv row.
  const dice = [...card('combat_stats').querySelectorAll('.st-sable-dice')];
  assert.equal(dice.length, 2);
  assert.equal(card('combat_odds').querySelectorAll('.st-sable-dice').length, 1);
  assert.equal(card('combat_odds').querySelector('dd.st-sable-kv-dice > span').textContent, '15 (Guard; estimate)');
  const computed = styled();
  for (const die of [...dice, card('combat_odds').querySelector('.st-sable-dice')]) {
    assert.ok(parseFloat(computed(die).minHeight) >= 36); assert.ok(parseFloat(computed(die).minWidth) >= 36);
    assert.equal(die.getAttribute('aria-label'), 'Бросить d100');
  }
  assert.ok(!digest().includes('LAST ROLL'));
  assert.equal(card('combat_roll'), null, 'legacy roll values never render');
  card('combat_odds').querySelector('.st-sable-dice').click();
  assert.deepEqual(calls.edits, []);
  assert.deepEqual(calls.rolls, [['combat_odds', 'crit %', 15]]);
  assert.equal(runtime.snapshot().store.roll.roll, 87);
  assert.ok(digest().endsWith('ROLL: 87 vs crit 15 → miss (resolve the next action with it)'));
  assert.equal(card('combat_odds').querySelector('[data-st-sable-roll="pending"]').textContent, '87 → промах');
  assert.equal(query('.st-sable-roll-note').textContent, 'Бросок: 87 vs crit 15 → промах');
  assert.equal(fake.calls.requests.length, 0, 'dice never call a model');
  [...card('combat_stats').querySelectorAll('.st-sable-dice')].at(-1).click();
  assert.equal(runtime.snapshot().store.roll.label, 'hit');
  assert.equal(card('combat_stats').querySelector('[data-st-sable-roll="pending"]').textContent, '87 → промах');
  runtime.updateSettings({ language: 'en' });
  [...card('combat_stats').querySelectorAll('.st-sable-dice')][0].click();
  assert.equal(runtime.snapshot().store.roll.label, XSS);
  assert.equal(query('.st-sable-roll-note').textContent, `Roll: 87 vs ${XSS} 15 → miss`);
  assert.equal(ui.element.querySelector('img'), null);
  // Any stats/kv percentage row gets dice, including user packs and custom blocks.
  runtime.updateSettings({ packs: [userPack()], customSections: [{ id: 'c_00000001', title: 'Odds', shape: 'kv' }] });
  runtime.setPack('p_0123abcd', true);
  runtime.editState('p_0123abcd_odds', [{ key: 'luck %', value: '50' }]);
  runtime.editState('p_0123abcd_stock', [{ key: 'ammo %', value: 50, max: 100 }]);
  runtime.editState('c_00000001', [{ key: 'luck %', value: '50' }]);
  assert.ok(card('p_0123abcd_odds').querySelector('.st-sable-dice'));
  assert.ok(card('p_0123abcd_stock').querySelector('.st-sable-dice'));
  assert.ok(card('c_00000001').querySelector('.st-sable-dice'));
  assert.ok(card('p_0123abcd_stock').querySelector('[role="meter"]'));
  runtime.updateSettings({ visual: { icons: 'emoji' } });
  assert.equal(card('combat_odds').querySelector('.st-sable-dice').textContent, '🎲');
});

test('inline kv roll is pending during consuming reply swipes and done after receipt or sending', async t => {
  const { runtime, fake, card, digest, styled, button, sq } = setup(t, { settings: { language: 'en' } });
  runtime.setPack('combat', true);
  card('combat_odds').querySelector('.st-sable-dice').click();
  const result = () => card('combat_odds').querySelector('[data-st-sable-roll]');
  assert.equal(result().dataset.stSableRoll, 'pending');
  assert.equal(result().textContent, '87 → miss');
  assert.ok(result().previousElementSibling.classList.contains('st-sable-dice'));
  button('[data-group="danger"]', 'Show prompt').click();
  assert.ok(sq('[data-preview]').textContent.includes('ROLL: 87 vs crit 15 → miss (resolve the next action with it)'));
  // Keep the side-model reply unresolved to verify consumption immediately on receipt.
  let resolve;
  fake.respond(() => new Promise(done => { resolve = done; }));
  const id = fake.add(); await fake.emit('MESSAGE_RECEIVED', id);
  assert.equal(result().dataset.stSableRoll, 'done');
  assert.equal(result().textContent, '87 → miss');
  assert.equal(styled()(result()).opacity, '0.5');
  assert.ok(!digest().includes('ROLL:'));
  resolve(JSON.stringify(packState())); await runtime.idle();
  fake.respond(JSON.stringify(packState()));
  fake.ctx.chat[id].swipe_id = 1;
  await fake.emit('MESSAGE_SWIPED', id);
  assert.equal(result().dataset.stSableRoll, 'pending');
  assert.ok(digest().includes('ROLL: 87 vs crit 15 → miss'));
  await fake.emit('MESSAGE_RECEIVED', id, 'swipe'); await runtime.idle();
  assert.equal(result().dataset.stSableRoll, 'done');
  assert.ok(!digest().includes('ROLL:'));
  fake.ctx.chat[id].swipe_id = 0;
  await fake.emit('MESSAGE_SWIPED', id);
  assert.equal(result().dataset.stSableRoll, 'pending');
  await fake.emit('MESSAGE_SENT', fake.add('Next action', { is_user: true }));
  assert.equal(result().dataset.stSableRoll, 'done');
  assert.ok(!digest().includes('ROLL:'));
  card('combat_odds').querySelector('.st-sable-dice').click();
  assert.equal(result().dataset.stSableRoll, 'pending');
  assert.equal(runtime.snapshot().store.roll.forMesId, id);
});

test('intimacy sheet starts with others checked and retains all three localized choices', t => {
  const { runtime, row, query } = setup(t);
  runtime.setPack('intimacy', true); query('[data-control="packs"]').click();
  assert.equal(row('intimacy').querySelector('[data-scope="others"]').getAttribute('aria-checked'), 'true');
  assert.deepEqual([...row('intimacy').querySelectorAll('[role="radio"]')].map(item => item.textContent), ['все', 'только я', 'кроме меня']);
  runtime.updateSettings({ language: 'en' });
  assert.deepEqual([...row('intimacy').querySelectorAll('[role="radio"]')].map(item => item.textContent), ['all', 'only me', 'everyone but me']);
});

test('pack cards fold, hide when off, reorder from the keyboard, take card colours and open the editor', t => {
  const { ui, card, runtime, query, document, key, members, shown } = setup(t);
  runtime.setPack('combat', true);
  ui.open();
  card('combat_stats').querySelector('.st-sable-fold').click();
  assert.equal(runtime.snapshot().settings.folded.combat_stats, true);
  assert.ok(card('combat_stats').querySelector('.st-sable-card-body').hidden);
  runtime.setMode('combat_effects', 'off');
  assert.equal(card('combat_effects'), null);
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Скрыто: 1');
  query('.st-sable-hidden-toggle').click();
  assert.ok(card('combat_effects').classList.contains('st-sable-off'));
  runtime.setMode('combat_effects', 'inject');
  const handle = card('combat_stats').querySelector('.st-sable-handle');
  key(handle, 'ArrowUp');
  const order = runtime.snapshot().settings.order;
  assert.ok(order.indexOf('combat_stats') < order.indexOf('combat_scene'), 'pack order persists in settings.order');
  assert.deepEqual(members('combat'), ['combat_stats', 'combat_scene', 'combat_effects', 'combat_odds']);
  runtime.setPack('combat', false); runtime.setPack('combat', true);
  assert.deepEqual(members('combat').slice(-2), ['combat_effects', 'combat_odds']);
  assert.equal(shown().indexOf('pack:combat'), 10, 'explicit positions survive a toggle');
  runtime.updateSettings({ visual: { cardColors: { combat_stats: '#abcdef' } } });
  assert.equal(card('combat_stats').style.getPropertyValue('--st-sable-accent'), '#abcdef');
  card('combat_scene').querySelector('[data-control="edit"]').click();
  const editor = card('combat_scene').querySelector('.st-sable-editor');
  assert.equal(editor.querySelector('textarea').value, 'Two guards at the gate, melee range.');
  editor.querySelector('textarea').value = 'Edited scene';
  editor.querySelector('.st-sable-editor-save').click();
  assert.equal(runtime.snapshot().entry.state.combat_scene, 'Edited scene');
  card('combat_stats').querySelector('[data-control="fold"]').click();
  card('combat_stats').querySelector('[data-control="edit"]').focus();
  card('combat_stats').querySelector('[data-control="edit"]').click();
  const statEditor = card('combat_stats').querySelector('.st-sable-editor');
  assert.equal(statEditor.querySelectorAll('.st-sable-editor-item').length, 4);
  assert.equal(statEditor.querySelector('.st-sable-editor-item input[type="number"]').value, '40');
  assert.equal(document.activeElement.closest('[data-section]')?.dataset.section, 'combat_stats');
});

test('settings: the Packs group folds, lists packs with defaults, scope and copies; export/import round-trip; Danger zone pack fields', async t => {
  const { settingsUi, sq, change, button, runtime, calls, toasts, dom, fake } = setup(t, { settings: { language: 'en' } });
  const group = sq('[data-group="packs"]');
  assert.equal(group.tagName, 'DETAILS'); assert.equal(group.open, false);
  assert.ok(GROUP_IDS.includes('packs'));
  assert.equal([...settingsUi.element.querySelectorAll('details.st-sable-group')].map(item => item.dataset.group).join(), GROUP_IDS.join());
  assert.ok(group.querySelector('summary h4 .fa-box-open'));
  assert.equal(group.querySelector('summary h4').textContent, 'Packs');
  group.querySelector('summary').click(); await tick();
  assert.deepEqual(calls.patches.at(-1), { groups: { packs: true } });
  assert.equal(runtime.snapshot().settings.groups.packs, true);
  runtime.updateSettings({ messages: 5 }); await tick();
  assert.equal(group.open, true, 'an unrelated render keeps the group open');
  const rows = () => [...group.querySelectorAll('[data-pack]')];
  assert.deepEqual(rows().map(row => row.dataset.pack), ['combat', 'intimacy']);
  const combat = sq('[data-group="packs"] [data-pack="combat"]'), intimacy = sq('[data-group="packs"] [data-pack="intimacy"]');
  assert.equal(combat.querySelector('.st-sable-custom-name').textContent, 'Combat');
  assert.equal(combat.querySelector('.st-sable-adult').hidden, true);
  assert.equal(intimacy.querySelector('.st-sable-custom-name').textContent, 'Intimacy');
  assert.equal(intimacy.querySelector('.st-sable-adult').hidden, false);
  assert.equal(intimacy.querySelector('.st-sable-pack-desc').textContent, 'Tracks established adult scenes (18+), arousal, stamina, counters and marks.');
  assert.equal(combat.querySelector('[name="packs.default"]').parentElement.textContent, 'On in new chats');
  assert.equal(combat.querySelector('[name="packs.default"]').checked, false);
  change('[data-pack="combat"] [name="packs.default"]', true);
  assert.deepEqual(calls.patches.at(-1), { packDefaults: ['combat'] });
  change('[data-pack="intimacy"] [name="packs.default"]', true);
  assert.deepEqual(runtime.snapshot().settings.packDefaults, ['combat', 'intimacy']);
  change('[data-pack="combat"] [name="packs.default"]', false);
  assert.deepEqual(runtime.snapshot().settings.packDefaults, ['intimacy']);
  assert.equal(combat.querySelector('[name="packs.default"]').checked, false);
  assert.equal(fake.calls.requests.length, 0);
  assert.deepEqual([...combat.querySelector('[name="packScope"]').options].map(o => o.textContent), ['all', 'only me', 'everyone but me']);
  assert.equal(intimacy.querySelector('[name="packScope"]').value, 'others');
  change('[data-pack="combat"] [name="packScope"]', 'user');
  assert.deepEqual(calls.patches.at(-1), { packScope: { combat: 'user' } });
  change('[data-pack="combat"] [name="packScope"]', 'others');
  assert.deepEqual(calls.patches.at(-1), { packScope: { combat: 'others' } });
  assert.equal(runtime.snapshot().settings.packScope.combat, 'others');
  assert.equal(combat.querySelector('[name="title"]'), null, 'built-ins have no editor');
  // Make a copy: a p_ pack with literal titles that opens for editing.
  button('[data-pack="combat"]', 'Make a copy').click();
  const copy = runtime.snapshot().settings.packs[0];
  assert.match(copy.id, /^p_[0-9a-f]{8}$/);
  assert.equal(copy.title, 'Combat'); assert.equal(copy.sections[1].title, 'Combat stats'); assert.equal(copy.rules, BUILTIN_PACKS[0].rules);
  assert.deepEqual(rows().map(row => row.dataset.pack), ['combat', 'intimacy', copy.id]);
  const copyRow = () => sq(`[data-group="packs"] [data-pack="${copy.id}"]`);
  assert.equal(copyRow().open, true);
  assert.equal(dom.window.document.activeElement, copyRow().querySelector('[name="title"]'));
  copyRow().querySelector('[name="title"]').blur();
  assert.equal(copyRow().querySelector('[name="title"]').value, 'Combat');
  assert.equal(copyRow().querySelector('[name="rules"]').value, BUILTIN_PACKS[0].rules);
  assert.equal(copyRow().querySelector('[name="pack.scope"]').checked, true);
  assert.deepEqual([...copyRow().querySelectorAll('[data-pack-section]')].map(row => row.dataset.packSection), copy.sections.map(s => `${copy.id}:${s.key}`));
  // Export through the UI, then import the same file: the collision gets a fresh id.
  let blob, downloaded;
  dom.window.URL.createObjectURL = value => { blob = value; return 'blob:pack'; };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
  button(`[data-pack="${copy.id}"]`, 'Save pack file').click();
  assert.equal(downloaded, 'sable-pack.json');
  const text = await new Promise(resolve => { const reader = new dom.window.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); });
  assert.deepEqual(JSON.parse(text), { format: 'sable-pack', version: 1, pack: copy });
  const choose = async files => {
    const input = sq('[name="packFile"]');
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await tick(); await tick();
  };
  await choose([{ text: async () => text }]);
  assert.equal(toasts.at(-1)[0], 'success');
  const packs = runtime.snapshot().settings.packs;
  assert.equal(packs.length, 2); assert.notEqual(packs[1].id, copy.id);
  assert.deepEqual({ ...packs[1], id: copy.id }, copy, 'the UI round-trips the pack');
  for (const [bad, error] of [['not json', 'format'], [JSON.stringify({ format: 'sable-pack', version: 1, pack: BUILTIN_PACKS[0] }), 'builtin-id'],
    [JSON.stringify({ format: 'sable-pack', version: 1, pack: {} }), 'invalid']]) {
    await choose([{ text: async () => bad }]);
    assert.deepEqual(toasts.at(-1), ['warning', { format: 'Sable: this file is not a Sable pack.', 'builtin-id': 'Sable: this file carries a built-in pack id; make a copy instead.', invalid: 'Sable: the pack has no valid sections.' }[error]]);
    assert.equal(runtime.snapshot().settings.packs.length, 2);
  }
  await choose([{ text: async () => { throw new Error('io'); } }]);
  assert.equal(toasts.at(-1)[0], 'warning');
  // Built-in export is a copy too (fresh p_ id, literal titles).
  button('[data-pack="intimacy"]', 'Save pack file').click();
  const exported = JSON.parse(await new Promise(resolve => { const reader = new dom.window.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob); }));
  assert.match(exported.pack.id, /^p_/); assert.equal(exported.pack.title, 'Intimacy (18+)');
  // Danger zone: pack rules and built-in pack sections.
  const danger = sq('[data-group="danger"]');
  assert.ok(danger.querySelector('[data-prompt-section="combat_stats"]'), 'built-in pack sections are listed');
  assert.ok(danger.querySelector('[data-prompt-section="intimacy_marks"]'));
  assert.equal(danger.querySelector(`[data-prompt-section="${copy.id}_stats"]`), null, 'user pack sections keep their own instructions');
  assert.equal(danger.querySelector('[data-prompt-section="combat_stats"] summary span:last-of-type').textContent, 'Combat stats');
  assert.equal(danger.querySelector('[name="prompts.combat_stats"]').value, BUILTIN_PACKS[0].sections[1].instructions);
  change('[name="prompts.combat_stats"]', 'Stats override');
  assert.deepEqual(calls.patches.at(-1), { prompts: { sections: { combat_stats: 'Stats override' } } });
  const packField = danger.querySelector('[data-prompt-pack="combat"]');
  assert.ok(packField.querySelector('summary .fa-hand-fist'));
  assert.equal(packField.querySelector('summary > span:nth-of-type(2)').textContent, 'Combat');
  assert.equal(packField.querySelector('summary .st-sable-adult').hidden, true);
  assert.equal(danger.querySelector('[data-prompt-pack="intimacy"] summary .st-sable-adult').hidden, false);
  assert.equal(packField.querySelector('[name="prompts.combat"]').value, BUILTIN_PACKS[0].rules);
  assert.equal(packField.querySelector('[data-changed]').hidden, true);
  change('[name="prompts.combat"]', 'New combat rules');
  assert.deepEqual(calls.patches.at(-1), { prompts: { packs: { combat: 'New combat rules' } } });
  assert.deepEqual(runtime.snapshot().settings.prompts.packs, { combat: 'New combat rules' });
  assert.equal(packField.querySelector('[data-changed]').hidden, false);
  assert.equal(sq('[name="prompts.combat.reset"]').disabled, false);
  sq('[name="prompts.combat.reset"]').click();
  assert.deepEqual(calls.patches.at(-1), { prompts: { packs: { combat: null } } });
  assert.deepEqual(runtime.snapshot().settings.prompts.packs, {});
  assert.equal(packField.querySelector('[name="prompts.combat"]').value, BUILTIN_PACKS[0].rules);
  change('[name="prompts.combat"]', 'Again');
  button('[data-group="danger"]', 'Reset all instructions').click();
  button('[data-group="danger"]', 'Tap again to reset all instructions').click();
  assert.deepEqual(runtime.snapshot().settings.prompts, { rules: null, sections: {}, packs: {} });
  runtime.updateSettings({ language: 'ru' });
  assert.equal(group.querySelector('summary h4').textContent, 'Наборы');
  assert.equal(combat.querySelector('.st-sable-custom-name').textContent, 'Бой');
  assert.equal(danger.querySelector('[data-prompt-section="combat_stats"] summary span:last-of-type').textContent, 'Показатели боя');
  assert.equal(packField.querySelector('summary > span:nth-of-type(2)').textContent, 'Бой');
  assert.equal(settingsUi.element.querySelector('img'), null);
});

test('settings: the user-pack editor writes the whole packs array; cards reuse the block editor; keys are validated; two taps delete', t => {
  const { sq, change, button, runtime, calls, dom } = setup(t, { settings: { language: 'en', packs: [userPack()] } });
  const id = 'p_0123abcd';
  const row = () => sq(`[data-group="packs"] [data-pack="${id}"]`);
  const scoped = selector => `[data-pack="${id}"] ${selector}`;
  assert.equal(row().querySelector('.st-sable-custom-name').textContent, 'Resources');
  assert.equal(row().querySelector('.st-sable-pack-scope').hidden, true, 'no scope select without the flag');
  change(scoped('[name="title"]'), ' Supplies <b>x</b> ');
  change(scoped('[name="icon"]'), 'fa-box');
  change(scoped('[name="description"]'), 'What the party carries');
  change(scoped('[name="rules"]'), 'Count only shown items.');
  change(scoped('[name="pack.scope"]'), true);
  const pack = runtime.snapshot().settings.packs[0];
  assert.deepEqual({ ...pack, sections: null }, { id, title: 'Supplies <b>x</b>', icon: 'fa-box', description: 'What the party carries', rules: 'Count only shown items.', scope: true, scopeDefault: 'all', sections: null });
  assert.ok(calls.patches.slice(-5).every(patch => Array.isArray(patch.packs) && patch.packs.length === 1), 'the whole array on every write');
  assert.equal(row().querySelector('.st-sable-custom-name').textContent, 'Supplies <b>x</b>');
  assert.equal(row().querySelector('b'), null);
  assert.equal(row().querySelector('.st-sable-pack-scope').hidden, false);
  change(scoped('[name="packScope"]'), 'user');
  assert.equal(runtime.snapshot().settings.packScope[id], 'user');
  change(scoped('[name="title"]'), '');
  assert.equal(runtime.snapshot().settings.packs[0].title, 'New pack');
  // Cards: the block editor with a key field, stats and tags shapes, add, rename, remove.
  const block = key => sq(`[data-pack-section="${id}:${key}"]`);
  assert.deepEqual([...block('stock').querySelectorAll('[name="shape"] option')].map(o => o.value), ['text', 'list', 'kv', 'stats', 'tags']);
  assert.equal(block('stock').querySelector('[name="shape"]').value, 'stats');
  assert.equal(block('stock').querySelector('[name="key"]').value, 'stock');
  assert.equal(block('stock').querySelector('.st-sable-custom-name').textContent, 'Stock');
  change(`[data-pack-section="${id}:stock"] [name="title"]`, 'Stock <i>x</i>');
  change(`[data-pack-section="${id}:stock"] [name="shape"]`, 'tags');
  change(`[data-pack-section="${id}:stock"] [name="max"]`, '12');
  change(`[data-pack-section="${id}:stock"] [name="mode"]`, 'show');
  change(`[data-pack-section="${id}:stock"] [name="period"]`, '2');
  change(`[data-pack-section="${id}:stock"] [name="instructions"]`, 'Only shown items.');
  assert.deepEqual(runtime.snapshot().settings.packs[0].sections[0], { key: 'stock', title: 'Stock <i>x</i>', icon: 'fa-box', instructions: 'Only shown items.', shape: 'tags', max: 12, mode: 'show', period: 2 });
  assert.equal(block('stock').querySelector('i:not(.fa-solid)'), null);
  change(`[data-pack-section="${id}:odds"] [name="key"]`, 'Bad Key');
  assert.equal(runtime.snapshot().settings.packs[0].sections[1].key, 'odds', 'an invalid key is not saved');
  assert.equal(block('odds').querySelector('[name="key"]').value, 'odds');
  change(`[data-pack-section="${id}:odds"] [name="key"]`, 'stock');
  assert.equal(runtime.snapshot().settings.packs[0].sections[1].key, 'odds', 'a duplicate key is not saved');
  change(`[data-pack-section="${id}:odds"] [name="key"]`, 'luck');
  assert.deepEqual(runtime.snapshot().settings.packs[0].sections.map(s => s.key), ['stock', 'luck']);
  assert.equal(block('odds'), null); assert.equal(block('luck').open, true);
  assert.equal(dom.window.document.activeElement, block('luck').querySelector('[name="title"]'));
  button(`[data-pack="${id}"]`, 'Add card').click();
  assert.deepEqual(runtime.snapshot().settings.packs[0].sections.map(s => s.key), ['stock', 'luck', 'card3']);
  assert.deepEqual({ ...runtime.snapshot().settings.packs[0].sections[2] }, { key: 'card3', title: 'New block', icon: '📌', instructions: '', shape: 'list', max: 8, mode: 'show', period: 1 });
  assert.equal(block('card3').open, true);
  const remove = block('card3').querySelector('.st-sable-custom-actions button');
  remove.click(); assert.equal(runtime.snapshot().settings.packs[0].sections.length, 3, 'first tap arms');
  remove.click(); assert.deepEqual(runtime.snapshot().settings.packs[0].sections.map(s => s.key), ['stock', 'luck']);
  const stockRemove = block('stock').querySelector('.st-sable-custom-actions button');
  stockRemove.click(); stockRemove.click();
  assert.deepEqual(runtime.snapshot().settings.packs[0].sections.map(s => s.key), ['luck']);
  assert.equal(block('luck').querySelector('.st-sable-custom-actions button').disabled, true, 'the last card stays');
  // Add pack, then delete it with two taps.
  button('[data-group="packs"]', 'Add pack').click();
  const added = runtime.snapshot().settings.packs[1];
  assert.match(added.id, /^p_[0-9a-f]{8}$/);
  assert.deepEqual({ ...added, id: 'x' }, { id: 'x', title: 'New pack', icon: '🎒', description: '', rules: '', scope: false, scopeDefault: 'all',
    sections: [{ key: 'card', title: 'New block', icon: '📌', instructions: '', shape: 'list', max: 8, mode: 'show', period: 1 }] });
  assert.equal(sq(`[data-pack="${added.id}"]`).open, true);
  assert.equal(dom.window.document.activeElement, sq(`[data-pack="${added.id}"] [name="title"]`));
  const del = [...sq(`[data-pack="${added.id}"]`).querySelectorAll(':scope > .st-sable-custom-body > .st-sable-custom-actions button')].find(b => b.textContent === 'Delete pack');
  del.click(); assert.equal(runtime.snapshot().settings.packs.length, 2); assert.equal(del.textContent, 'Delete the pack for good?');
  del.click(); assert.deepEqual(runtime.snapshot().settings.packs.map(p => p.id), [id]);
  assert.equal(sq(`[data-pack="${added.id}"]`), null);
  // Enabled pack sections join the Sections table and the card colours like any other card.
  runtime.setPack(id, true);
  assert.ok(sq('[data-group="sections"] [data-section="p_0123abcd_luck"]'));
  change('[data-group="sections"] [data-section="p_0123abcd_luck"] [name="period"]', '4');
  assert.deepEqual(calls.patches.at(-1), { sections: { p_0123abcd_luck: { period: 4 } } });
  assert.equal(runtime.snapshot().settings.sections.p_0123abcd_luck.period, 4);
  assert.ok(sq('[data-card-color="p_0123abcd_luck"]'));
  runtime.setPack(id, false);
  assert.equal(sq('[data-group="sections"] [data-section="p_0123abcd_luck"]'), null);
});

// T13: packs as groups in the drawer (SPEC §15 "Drawer").
test('groupedOrder: pack blocks are contiguous at the first member, keep their relative order and append when absent', () => {
  const settings = { customSections: [], packs: [] }, sections = getSections(settings, ['combat', 'intimacy']);
  const ids = id => sections.find(s => s.id === id);
  assert.ok(ids('combat_scene').pack === 'combat' && ids('intimacy_marks').pack === 'intimacy');
  assert.deepEqual(groupedOrder(undefined, SECTIONS), orderedSectionIds(undefined, SECTIONS), 'no packs: the plain order');
  assert.deepEqual(groupedOrder(['world', 'combat_stats', 'threads', 'combat_scene'], sections, ['combat']).slice(0, 6),
    ['world', 'combat_stats', 'combat_scene', 'combat_effects', 'combat_odds', 'threads'], 'placed where the first member appears, relative order kept');
  const absent = groupedOrder(['intimacy_marks', 'banlist'], sections, ['combat', 'intimacy']);
  assert.deepEqual(absent.slice(0, 5), ['intimacy_marks', 'intimacy_scene', 'intimacy_arousal', 'intimacy_counters', 'banlist']);
  assert.deepEqual(absent.slice(-4), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds'], 'a pack with no entry goes to the end');
  assert.deepEqual(groupedOrder(['combat_odds', 'world'], sections, []).slice(0, 2), ['combat_odds', 'world'], 'packs not listed stay flat');
  assert.deepEqual(groupedOrder(['combat_odds', 'world', 'combat_scene'], sections, [{ id: 'combat' }]).slice(0, 5),
    ['combat_odds', 'combat_scene', 'combat_stats', 'combat_effects', 'world'], 'pack objects work too');
  assert.equal(new Set(groupedOrder(['x', 'combat_scene', 'combat_scene'], sections)).size, sections.length, 'unknown and duplicate ids drop');
  assert.deepEqual(groupedOrder(['combat_scene', 'combat_stats'], sections, undefined).slice(0, 4), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds'], 'the default groups every pack present');
});

test('groups: one container per enabled pack with the pack title, a four-control header, nested members and flat built-ins', t => {
  const { ui, card, group, members, shown, runtime, query, styled, document } = setup(t);
  ui.open();
  assert.equal(ui.element.querySelector('.st-sable-group'), null);
  runtime.setPack('intimacy', true); runtime.setPack('combat', true);
  assert.deepEqual(shown().slice(-2), ['pack:combat', 'pack:intimacy'], 'registry order when nothing is saved, whichever was switched on first');
  const combat = group('combat'), intimacy = group('intimacy');
  assert.equal(combat.tagName, 'SECTION');
  assert.equal(combat.getAttribute('aria-label'), 'Набор: Бой');
  assert.equal(intimacy.getAttribute('aria-label'), 'Набор: Интим');
  const header = combat.querySelector(':scope > .st-sable-group-header');
  assert.ok(header.classList.contains('st-sable-card-header'), 'same header row as a card');
  assert.deepEqual([...header.querySelectorAll('button')].map(item => item.dataset.control), ['handle', 'mode', 'fold'], 'four controls, no pack switch');
  assert.equal(header.querySelectorAll('[role="switch"]').length, 0);
  assert.equal(header.querySelector('.st-sable-card-label').textContent, 'Бой');
  assert.ok(header.querySelector('.st-sable-card-icon.fa-hand-fist'));
  assert.equal(header.querySelector('.st-sable-adult'), null);
  assert.equal(intimacy.querySelector('.st-sable-group-header .st-sable-card-label').textContent, 'Интим');
  assert.equal(intimacy.querySelector('.st-sable-group-header .st-sable-adult').textContent, '18+');
  assert.deepEqual(members('combat'), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds']);
  assert.deepEqual(members('intimacy'), ['intimacy_scene', 'intimacy_arousal', 'intimacy_counters', 'intimacy_marks']);
  assert.equal(card('world').parentElement, query('.st-sable-cards'), 'built-ins stay flat');
  assert.equal(card('combat_stats').parentElement, combat.querySelector('.st-sable-group-body'));
  assert.equal(card('combat_stats').querySelector('[data-control="mode"]').textContent, 'в промпт', 'members keep their own chip');
  assert.ok(card('combat_stats').querySelector('[data-control="fold"]') && card('combat_stats').querySelector('[data-control="edit"]'));
  assert.ok(card('combat_stats').querySelector('.st-sable-bar'), 'member bodies render');
  const computed = styled();
  for (const button of header.querySelectorAll('button')) assert.ok(parseFloat(computed(button).minHeight) >= 32, 'tap targets');
  assert.ok(parseFloat(computed(header).minHeight) >= 40);
  assert.equal(computed(combat.querySelector('.st-sable-group-body')).paddingLeft, '8px', 'members are indented');
  assert.equal(parseFloat(computed(card('combat_stats')).borderRadius), 0, 'members are lighter than a card');
  assert.match(css, /\.st-sable-drawer \.st-sable-group \.st-sable-card \{[^}]*background: none;[^}]*box-shadow: none;/, 'no own glass fill or shadow');
  assert.match(css, /\.st-sable-drawer \.st-sable-group\.st-sable-menu-open:last-child \{ margin-bottom: 126px; \}/);
  assert.ok(!/^\.st-sable-group[^-]/m.test(css.slice(css.indexOf('/* Pack groups'))), 'group rules are scoped to the drawer: settings own the bare class');
  runtime.updateSettings({ language: 'en' });
  assert.equal(group('intimacy').getAttribute('aria-label'), 'Pack: Intimacy');
  assert.equal(group('combat').querySelector('.st-sable-group-header [data-control="fold"]').getAttribute('aria-label'), 'Fold / unfold the pack');
  runtime.setPack('combat', false);
  assert.equal(group('combat'), null, 'the whole group leaves with the pack');
  assert.equal(card('combat_stats'), null);
  assert.ok(group('intimacy'));
  assert.equal(document.querySelector('img'), null);
});

test('group chip: aggregate of the member modes, «mixed» otherwise; the menu sets every member in one write', async t => {
  const { ui, card, group, runtime, query, calls, fake, document } = setup(t);
  runtime.setPack('combat', true);
  ui.open();
  const chip = () => group('combat').querySelector('.st-sable-group-header [data-control="mode"]');
  assert.equal(chip().textContent, 'в промпт');
  assert.equal(chip().dataset.mode, 'inject');
  assert.equal(group('combat').dataset.mode, 'inject');
  assert.equal(chip().getAttribute('aria-label'), 'Бой: в промпт');
  runtime.setMode('combat_effects', 'show');
  assert.equal(chip().textContent, 'смешано');
  assert.equal(chip().dataset.mode, 'mixed');
  assert.equal(group('combat').dataset.mode, 'mixed');
  assert.equal(card('combat_effects').querySelector('[data-control="mode"]').textContent, 'показ');
  chip().focus(); chip().click();
  const menu = query('[role="menu"]');
  assert.ok(menu && group('combat').contains(menu));
  assert.ok(group('combat').classList.contains('st-sable-menu-open'));
  assert.deepEqual([...menu.querySelectorAll('[role="menuitemradio"]')].map(item => item.getAttribute('aria-checked')), ['false', 'false', 'false'], 'mixed checks nothing');
  assert.equal(document.activeElement, menu.querySelector('[data-mode="inject"]'));
  const settingsWrites = fake.calls.settings;
  menu.querySelector('[data-mode="show"]').click();
  assert.deepEqual(calls.packModes, [['combat', 'show']]);
  assert.equal(fake.calls.settings - settingsWrites, 1, 'one settings write for the whole pack');
  assert.deepEqual(['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds'].map(id => runtime.snapshot().modes[id]), ['show', 'show', 'show', 'show']);
  assert.equal(chip().textContent, 'показ');
  assert.equal(query('[role="menu"]'), null);
  assert.equal(document.activeElement, chip(), 'focus returns to the group chip');
  assert.equal(runtime.snapshot().settings.sections.combat_odds.mode, 'show');
  chip().click(); query('[role="menu"] [data-mode="off"]').click();
  assert.equal(group('combat'), null, 'a group whose members are all off hides with hideOff');
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Скрыто: 4');
  assert.equal(document.activeElement, query('.st-sable-hidden-toggle'));
  query('.st-sable-hidden-toggle').click();
  assert.ok(group('combat').classList.contains('st-sable-off'));
  assert.equal(group('combat').dataset.mode, 'off');
  assert.equal(chip().textContent, 'выкл');
  // Per-chat overrides: the same semantics as setMode, one store write; null drops every override.
  runtime.updateSettings({ perChatOverrides: true });
  const metadataWrites = fake.calls.metadata.length;
  assert.equal(runtime.setPackMode('combat', 'inject'), true);
  await tick();
  assert.equal(fake.calls.metadata.length - metadataWrites, 1);
  assert.deepEqual(fake.ctx.chatMetadata.sableTrackers.modeOverride, { combat_scene: 'inject', combat_stats: 'inject', combat_effects: 'inject', combat_odds: 'inject' });
  assert.equal(runtime.snapshot().settings.sections.combat_scene.mode, 'off', 'the global mode is untouched');
  assert.equal(runtime.snapshot().modes.combat_scene, 'inject');
  assert.equal(runtime.setPackMode('combat', null), true);
  assert.deepEqual(fake.ctx.chatMetadata.sableTrackers.modeOverride, {});
  assert.equal(runtime.setPackMode('combat', 'bogus'), false);
  assert.equal(runtime.setPackMode('intimacy', 'show'), false, 'a pack that is off in this chat is refused');
  assert.equal(runtime.setPackMode('nope', 'show'), false);
});

test('group fold persists under folded["pack:…"], hides the members and leaves member folds alone', t => {
  const { ui, card, group, runtime, fake } = setup(t);
  runtime.setPack('combat', true);
  ui.open();
  const fold = () => group('combat').querySelector('.st-sable-group-header [data-control="fold"]');
  const body = () => group('combat').querySelector('.st-sable-group-body');
  assert.equal(fold().getAttribute('aria-label'), 'Свернуть / развернуть набор');
  assert.equal(fold().getAttribute('aria-controls'), body().id);
  assert.equal(fold().getAttribute('aria-expanded'), 'true');
  assert.equal(body().hidden, false);
  card('combat_stats').querySelector('[data-control="fold"]').click();
  assert.equal(runtime.snapshot().settings.folded.combat_stats, true);
  fold().focus(); fold().click();
  assert.equal(runtime.snapshot().settings.folded['pack:combat'], true);
  assert.equal(runtime.snapshot().settings.folded.combat_stats, true, 'member folds are kept');
  assert.equal(body().hidden, true);
  assert.equal(fold().getAttribute('aria-expanded'), 'false');
  assert.equal(fake.ctx.extensionSettings.sableTrackers.folded['pack:combat'], true, 'survives the normaliser');
  assert.equal(group('combat').ownerDocument.activeElement, fold(), 'focus stays on the group fold');
  group('combat').querySelector('.st-sable-group-header .st-sable-card-label').click();
  assert.equal(runtime.snapshot().settings.folded['pack:combat'], false, 'a tap on the title unfolds');
  assert.equal(body().hidden, false);
  assert.ok(card('combat_stats').querySelector('.st-sable-card-body').hidden, 'the member stays folded inside the open group');
  runtime.updateSettings({ folded: { 'pack:combat': true, 'pack:nope': true, combat_stats: 'yes' } });
  assert.deepEqual(runtime.snapshot().settings.folded, { 'pack:combat': true }, 'unknown packs and non-booleans drop');
});

test('hideOff inside groups: off members hide and count, an all-off group hides, the reveal row brings them back', t => {
  const { ui, card, group, members, runtime, query } = setup(t);
  runtime.setPack('combat', true);
  ui.open();
  runtime.setMode('combat_effects', 'off');
  assert.equal(card('combat_effects'), null);
  assert.deepEqual(members('combat'), ['combat_scene', 'combat_stats', 'combat_odds']);
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Скрыто: 1');
  query('.st-sable-hidden-toggle').click();
  assert.deepEqual(members('combat'), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds'], 'revealed in its slot');
  assert.ok(card('combat_effects').classList.contains('st-sable-off'));
  assert.ok(card('combat_effects').querySelector('[data-control="fold"]').disabled);
  query('.st-sable-hidden-toggle').click();
  runtime.setMode('offscreen', 'off');
  for (const id of ['combat_scene', 'combat_stats', 'combat_odds']) runtime.setMode(id, 'off');
  assert.equal(group('combat'), null, 'all members off: no group');
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Скрыто: 5');
  query('.st-sable-hidden-toggle').click();
  assert.ok(group('combat'));
  assert.deepEqual(members('combat'), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds']);
  assert.ok(card('offscreen'));
  runtime.updateSettings({ hideOff: false });
  assert.equal(query('.st-sable-hidden-row').hidden, true);
  assert.deepEqual(members('combat').length, 4, 'nothing hides without hideOff');
});

test('order: the group handle moves the block among flat cards, a member handle moves inside the group; settings.order stays flat', t => {
  const { ui, card, group, members, shown, runtime, key, query, document, dom } = setup(t);
  runtime.setPack('combat', true); runtime.setPack('intimacy', true);
  ui.open();
  const handle = () => group('combat').querySelector('.st-sable-group-header [data-control="handle"]');
  assert.deepEqual(shown().slice(-3), ['banlist', 'pack:combat', 'pack:intimacy']);
  handle().focus(); key(handle(), 'ArrowUp');
  assert.deepEqual(shown().slice(-3), ['pack:combat', 'banlist', 'pack:intimacy'], 'the whole block steps over a card');
  assert.equal(document.activeElement, handle(), 'focus follows the group handle');
  const order = runtime.snapshot().settings.order;
  assert.deepEqual(order.slice(-9), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds', 'banlist', 'intimacy_scene', 'intimacy_arousal', 'intimacy_counters', 'intimacy_marks'], 'flat, contiguous block');
  assert.equal(order.length, new Set(order).size);
  key(group('intimacy').querySelector('.st-sable-group-header [data-control="handle"]'), 'ArrowUp');
  assert.deepEqual(shown().slice(-3), ['pack:combat', 'pack:intimacy', 'banlist'], 'blocks step over each other');
  key(card('banlist').querySelector('[data-control="handle"]'), 'ArrowUp');
  assert.deepEqual(shown().slice(-3), ['pack:combat', 'banlist', 'pack:intimacy'], 'a flat card steps over a whole block');
  key(card('banlist').querySelector('[data-control="handle"]'), 'ArrowUp');
  assert.deepEqual(shown().slice(-4), ['planner', 'banlist', 'pack:combat', 'pack:intimacy']);
  // Members move inside their block only.
  const member = id => card(id).querySelector('[data-control="handle"]');
  key(member('combat_scene'), 'ArrowUp');
  assert.deepEqual(members('combat'), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds'], 'the first member cannot leave the group upwards');
  key(member('combat_scene'), 'ArrowDown');
  assert.deepEqual(members('combat'), ['combat_stats', 'combat_scene', 'combat_effects', 'combat_odds']);
  for (let i = 0; i < 4; i++) key(member('combat_scene'), 'ArrowDown');
  assert.deepEqual(members('combat'), ['combat_stats', 'combat_effects', 'combat_odds', 'combat_scene'], 'the last member cannot leave the group downwards');
  assert.deepEqual(shown().slice(-4), ['planner', 'banlist', 'pack:combat', 'pack:intimacy'], 'the rest of the order is untouched');
  assert.deepEqual(runtime.snapshot().settings.order.slice(-8), ['combat_stats', 'combat_effects', 'combat_odds', 'combat_scene', 'intimacy_scene', 'intimacy_arousal', 'intimacy_counters', 'intimacy_marks']);
  // Touch drag (beginDrag) at both levels: the group among the flat cards, a member inside its group.
  const stub = parent => { for (const [index, item] of [...parent.children].entries()) item.getBoundingClientRect = () => ({ top: index * 100, height: 100 }); };
  const at = (target, type, y) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  const drag = (grip, y) => { at(grip, 'pointerdown', 25); at(document, 'pointermove', y); at(document, 'pointerup', y); };
  stub(query('.st-sable-cards'));
  drag(handle(), 30);
  assert.deepEqual(shown().slice(0, 2), ['pack:combat', 'world'], 'the group dropped at the top');
  assert.deepEqual(runtime.snapshot().settings.order.slice(0, 5), ['combat_stats', 'combat_effects', 'combat_odds', 'combat_scene', 'world']);
  assert.equal(query('.st-sable-dragging'), null);
  stub(group('combat').querySelector('.st-sable-group-body'));
  drag(member('combat_scene'), 30);
  assert.deepEqual(members('combat'), ['combat_scene', 'combat_stats', 'combat_effects', 'combat_odds'], 'the member dropped at the top of its group');
  assert.deepEqual(shown().slice(0, 2), ['pack:combat', 'world']);
  stub(group('combat').querySelector('.st-sable-group-body'));
  drag(member('combat_scene'), 5000);
  assert.deepEqual(members('combat'), ['combat_stats', 'combat_effects', 'combat_odds', 'combat_scene'], 'a member never leaves its group');
  assert.equal(card('combat_scene').parentElement, group('combat').querySelector('.st-sable-group-body'));
  at(member('combat_scene'), 'pointerdown', 25); at(document, 'pointermove', 30); at(document, 'pointercancel', 30);
  assert.deepEqual(members('combat'), ['combat_stats', 'combat_effects', 'combat_odds', 'combat_scene'], 'cancel restores');
  assert.equal(query('.st-sable-dragging'), null);
});

test('members and their group keep their nodes across renders; the editor opens on a member', t => {
  const { ui, card, group, runtime, query } = setup(t);
  runtime.setPack('combat', true);
  ui.open();
  const container = group('combat'), stats = card('combat_stats'), scene = card('combat_scene');
  const row = stats.querySelector('.st-sable-scale[data-key="combat_stats:Guard · HP"]'), fill = row.querySelector('.st-sable-bar-fill');
  assert.equal(fill.style.transform, 'scaleX(0.4)');
  runtime.editState('combat_stats', [{ key: 'Guard · HP', value: 70, max: 100 }, { key: 'rounds', value: 4, max: null }]);
  assert.equal(group('combat'), container, 'the group container persists');
  assert.equal(card('combat_stats'), stats, 'the member card persists');
  assert.equal(stats.querySelector('.st-sable-scale[data-key="combat_stats:Guard · HP"]'), row, 'keyed rows persist');
  assert.equal(fill.style.transform, 'scaleX(0.7)');
  assert.ok(row.hasAttribute('data-st-sable-changed'));
  assert.ok(stats.hasAttribute('data-st-sable-changed'));
  assert.equal(stats.querySelector('.st-sable-change-dot').hidden, false);
  assert.equal(scene.hasAttribute('data-st-sable-changed'), false);
  runtime.setMode('combat_effects', 'show');
  assert.equal(group('combat'), container, 'a mode change rebuilds only the headers');
  assert.equal(card('combat_stats'), stats);
  runtime.updateSettings({ visual: { cardColors: { combat_scene: '#abcdef' } } });
  assert.equal(card('combat_scene'), scene);
  assert.equal(scene.style.getPropertyValue('--st-sable-accent'), '#abcdef', 'card colours apply to members');
  assert.equal(container.style.getPropertyValue('--st-sable-accent'), '', 'the group takes no card colour');
  scene.querySelector('[data-control="edit"]').click();
  const editor = query('.st-sable-editor[data-editor="combat_scene"]');
  assert.ok(editor && card('combat_scene').contains(editor), 'the editor opens inside the member');
  assert.equal(card('combat_scene').parentElement, container.querySelector('.st-sable-group-body'));
  assert.equal(group('combat'), container);
  editor.querySelector('textarea').value = 'Edited inside the group';
  editor.querySelector('.st-sable-editor-save').click();
  assert.equal(runtime.snapshot().entry.state.combat_scene, 'Edited inside the group');
  assert.equal(query('.st-sable-editor'), null);
  assert.equal(card('combat_scene').querySelector('.st-sable-line').textContent, 'Edited inside the group');
  assert.equal(card('combat_stats'), stats, 'the save render keeps the other member');
});
