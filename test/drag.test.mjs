import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createDrawer, createUndoPill, UNDO_MS } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { createFakeST } from './fakes/st.mjs';

// SPEC §24: the undo pill and the handle drag between containers. Geometry is stubbed: every top-level block and every
// member gets a rectangle from `layout()`; real geometry is checked only in a real SillyTavern.
const a = 'f_00000001', b = 'f_00000002';
const folder = (id, members, title = 'Tomas') => ({ id, title, icon: '', members });
const rect = (top, height) => () => ({ top, height, bottom: top + height, left: 0, right: 400, width: 400 });

function setup(t, overrides = {}) {
  const dom = new JSDOM('<body><div id="extensionsMenu"></div></body>', { pretendToBeVisual: true });
  const document = dom.window.document, fake = createFakeST(); fake.add();
  Object.assign(fake.ctx.extensionSettings.sableTrackers, { folders: [folder(a, ['world', 'threads'])], ...overrides });
  const frames = [];
  dom.window.requestAnimationFrame = callback => frames.push(callback);
  dom.window.cancelAnimationFrame = () => frames.splice(0);
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document }); ui.open();
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const query = selector => ui.element.querySelector(selector);
  const cards = query('.st-sable-cards');
  const card = id => query(`.st-sable-card[data-section="${id}"]`);
  const group = (id = a) => query(`[data-folder="${id}"]`);
  const members = (id = a) => [...group(id).querySelectorAll('.st-sable-card')].map(item => item.dataset.section);
  const handle = element => element.querySelector('[data-control="handle"]');
  const fire = (target, type, y, x = 10) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  /** Top-level cards are 100 px; a group is a 40 px header plus 100 px per body child while unfolded. */
  const layout = () => {
    let y = 0;
    for (const child of cards.children) {
      const top = y;
      if (child.classList.contains('st-sable-group')) {
        child.firstElementChild.getBoundingClientRect = rect(y, 40); y += 40;
        if (!child.lastElementChild.hidden) for (const item of child.lastElementChild.children) { item.getBoundingClientRect = rect(y, 100); y += 100; }
      } else y += 100;
      child.getBoundingClientRect = rect(top, y - top);
    }
    cards.getBoundingClientRect = rect(0, 3000);
  };
  const start = (element, y) => { layout(); fire(handle(element), 'pointerdown', y); };
  const settings = () => runtime.snapshot().settings;
  return { dom, document, fake, runtime, ui, query, cards, card, group, members, fire, layout, start, settings, frames };
}

test('undo pill: show, replace, timeout, tap on the text and a single restore (fake timers)', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<body></body>'), document = dom.window.document;
  t.after(() => dom.window.close());
  const timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };
  const undo = createUndoPill(document, key => ({ 'undo.restore': 'Вернуть' })[key] ?? key, timers);
  const pill = undo.element, text = pill.querySelector('.st-sable-undo-text'), button = pill.querySelector('[data-control="undo"]');
  assert.equal(pill.getAttribute('role'), 'status'); assert.equal(pill.hidden, true);
  const calls = [];
  undo.show('Maren → Story', () => calls.push('first'));
  assert.equal(pill.hidden, false); assert.equal(text.textContent, 'Maren → Story'); assert.equal(button.textContent, 'Вернуть');
  t.mock.timers.tick(3000);
  undo.show('<b>Old Ilse</b> → No group', () => calls.push('second'));
  assert.equal(text.textContent, '<b>Old Ilse</b> → No group', 'text only'); assert.equal(pill.querySelector('b'), null);
  t.mock.timers.tick(UNDO_MS - 1); assert.equal(pill.hidden, false, 'the replacement restarts the 5 s');
  t.mock.timers.tick(1); assert.equal(pill.hidden, true); assert.deepEqual(calls, []);
  button.click(); assert.deepEqual(calls, [], 'a hidden pill restores nothing');
  undo.show('Tomas → World', () => calls.push('third'));
  text.click(); assert.equal(pill.hidden, true); assert.deepEqual(calls, []);
  undo.show('Tomas → World', () => calls.push('fourth'));
  button.click(); button.click();
  assert.deepEqual(calls, ['fourth']); assert.equal(pill.hidden, true);
  t.mock.timers.tick(UNDO_MS); assert.deepEqual(calls, ['fourth']);
});

test('a member detaches past 24 px, drops into a top-level gap with one write, and the pill restores', t => {
  const { start, fire, document, card, group, members, query, settings, runtime, fake } = setup(t);
  const before = structuredClone(settings());
  // Group a: header 0–40, world 40–140, threads 140–240, footer 240–340; then the flat cards, 100 px each.
  start(card('world'), 90);
  fire(document, 'pointermove', 355);
  assert.equal(query('.st-sable-slot'), null, 'within 24 px of the folder the member still sorts');
  assert.deepEqual(members(), ['threads', 'world']);
  fire(document, 'pointermove', 400);
  const slot = query('.st-sable-slot'), next = slot.nextElementSibling;
  assert.equal(slot.textContent, 'сюда'); assert.equal(query('.st-sable-cards').querySelectorAll('.st-sable-slot').length, 1);
  assert.ok(card('world').classList.contains('st-sable-dragging')); assert.equal(card('world').closest('[data-folder]'), group());
  fire(document, 'pointermove', 410); assert.equal(query('.st-sable-slot').nextElementSibling, next, 'one slot, moved in place');
  const writes = fake.calls.settings;
  fire(document, 'pointerup', 410);
  assert.equal(fake.calls.settings - writes, 1, 'one updateSettings per drop');
  assert.equal(query('.st-sable-slot'), null); assert.equal(query('.st-sable-dragging'), null);
  assert.deepEqual(settings().folders[0].members, ['threads']);
  const order = settings().order, anchor = next.dataset.section;
  assert.equal(order.indexOf('world') + 1, order.indexOf(anchor));
  assert.equal(card('world').parentElement, query('.st-sable-cards')); assert.equal(card('world').nextElementSibling, card(anchor));
  const pill = query('.st-sable-undo');
  assert.equal(pill.hidden, false); assert.equal(pill.querySelector('.st-sable-undo-text').textContent, 'Состояние мира → Без группы');
  pill.querySelector('[data-control="undo"]').click();
  assert.deepEqual(settings().folders, before.folders); assert.deepEqual(settings().order, before.order);
  assert.deepEqual(members(), ['world', 'threads']); assert.equal(pill.hidden, true);
  // Right above its own folder: the folder block is anchored by its other member, not by the leaving card.
  runtime.updateSettings({ order: ['offscreen', ...before.order.filter(id => id !== 'offscreen')] });
  start(card('world'), 190);
  fire(document, 'pointermove', 60);
  assert.equal(query('.st-sable-slot').nextElementSibling, group());
  fire(document, 'pointerup', 60);
  assert.deepEqual(settings().order.slice(0, 3), ['offscreen', 'world', 'threads']); assert.deepEqual(members(), ['threads']);
});

test('targets: a member gap of another folder, a folded header, an empty folder hint; the menu stays as it was', t => {
  const { start, fire, document, card, group, members, query, settings, runtime, layout } = setup(t, {
    folders: [folder(a, ['world', 'threads']), folder(b, ['npcs', 'bonds'], 'Maren'), folder('f_00000003', [], 'Old Ilse')] });
  // Into b between npcs and bonds: the slot sits before bonds and the drop keeps b's other members around it.
  layout();
  const bTop = group(b).getBoundingClientRect().top;
  start(card('world'), 90);
  fire(document, 'pointermove', bTop + 40 + 120);
  assert.equal(query('.st-sable-slot').nextElementSibling, card('bonds'));
  fire(document, 'pointerup', bTop + 160);
  assert.deepEqual(members(b), ['npcs', 'world', 'bonds']); assert.deepEqual(members(), ['threads']);
  assert.equal(query('.st-sable-undo-text').textContent, 'Состояние мира → Maren');
  // A folded folder takes the card on its header and stays folded; the header hit means "the end".
  runtime.updateSettings({ folded: { [`folder:${a}`]: true } });
  layout();
  start(card('story'), card('story').getBoundingClientRect().top + 50);
  fire(document, 'pointermove', 20);
  assert.equal(query('.st-sable-slot').parentElement, group()); assert.equal(group().lastElementChild.hidden, true);
  fire(document, 'pointerup', 20);
  assert.deepEqual(settings().folders[0].members, ['threads', 'story']); assert.equal(settings().folded[`folder:${a}`], true);
  // An empty folder: its hint row is the slot.
  const empty = group('f_00000003');
  layout();
  start(card('planner'), card('planner').getBoundingClientRect().top + 50);
  fire(document, 'pointermove', empty.getBoundingClientRect().top + 60);
  assert.equal(empty.querySelector('.st-sable-folder-empty').hidden, true);
  assert.equal(query('.st-sable-slot').parentElement, empty.lastElementChild);
  fire(document, 'pointerup', empty.getBoundingClientRect().top + 60);
  assert.deepEqual(settings().folders[2].members, ['planner']);
  // The «В группу…» menu is unchanged.
  card('offscreen').querySelector('[data-control="folder"]').click();
  assert.deepEqual([...query('[role="menu"]').querySelectorAll('[data-mode]')].map(item => item.dataset.mode), [a, b, 'f_00000003', 'new']);
});

test('a full folder shows its badge and no slot; packs and the People group dim; such drops cancel without writing', t => {
  const customSections = Array.from({ length: 20 }, (_, i) => ({ id: `c_${i.toString(16).padStart(8, '0')}`, title: 'Custom' }));
  const { start, fire, document, card, group, query, settings, runtime, fake, layout } = setup(t, {
    customSections, folders: [folder(a, ['world', 'threads']), folder(b, customSections.map(item => item.id), 'Maren')] });
  runtime.updateSettings({ folded: { [`folder:${b}`]: true } });
  runtime.setPack('combat', true);
  layout();
  const writes = fake.calls.settings, before = structuredClone(settings());
  start(card('world'), 90);
  fire(document, 'pointermove', group(b).getBoundingClientRect().top + 20);
  const header = group(b).firstElementChild;
  assert.ok(header.classList.contains('st-sable-full')); assert.equal(header.querySelector('.st-sable-full-badge').textContent, 'полная');
  assert.equal(query('.st-sable-slot'), null);
  const pack = query('[data-pack="combat"]');
  assert.ok(pack.classList.contains('st-sable-dim'));
  fire(document, 'pointermove', pack.getBoundingClientRect().top + 20);
  assert.equal(query('.st-sable-full'), null); assert.equal(query('.st-sable-slot'), null);
  fire(document, 'pointerup', pack.getBoundingClientRect().top + 20);
  assert.equal(fake.calls.settings, writes); assert.deepEqual(settings(), before);
  assert.equal(query('.st-sable-dim'), null); assert.equal(query('.st-sable-dragging'), null);
  assert.equal(query('.st-sable-undo').hidden, true);
  // Pack members and folder handles keep today's rules: no detaching, no slot.
  layout();
  start(query('[data-pack="combat"] .st-sable-card'), pack.getBoundingClientRect().top + 60);
  fire(document, 'pointermove', 5000); assert.equal(query('.st-sable-slot'), null); assert.equal(query('.st-sable-dim'), null);
  fire(document, 'pointercancel', 5000);
  // The People layout: the group and its person cards dim while a card is detached.
  runtime.updateSettings({ layout: 'people' });
  layout();
  start(card('world'), 90);
  fire(document, 'pointermove', 2900);
  assert.ok(query('[data-container="people"]').classList.contains('st-sable-dim'));
  fire(document, 'pointercancel', 2900); assert.equal(query('.st-sable-dim'), null);
});

test('cancel paths: Escape, 40 px left of the panel, lost capture and no slot write nothing; auto-scroll in the bands', t => {
  const { start, fire, document, dom, card, members, query, settings, fake, ui, frames, cards } = setup(t);
  const writes = fake.calls.settings, order = settings().order;
  const check = () => {
    assert.equal(fake.calls.settings, writes); assert.deepEqual(settings().order, order);
    assert.equal(query('.st-sable-slot'), null); assert.equal(query('.st-sable-dragging'), null);
    assert.deepEqual(members(), ['world', 'threads']);
  };
  start(card('world'), 90); fire(document, 'pointermove', 400);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  check(); assert.equal(ui.element.hidden, false, 'Escape cancels the drag, not the drawer');
  fire(document, 'pointerup', 400); check();
  start(card('world'), 90); fire(document, 'pointermove', 400); fire(document, 'pointermove', 400, -41); check();
  start(card('world'), 90); fire(document, 'pointermove', 400);
  const lost = new dom.window.Event('lostpointercapture', { bubbles: true }); Object.defineProperty(lost, 'pointerId', { value: 1 });
  card('world').querySelector('[data-control="handle"]').dispatchEvent(lost); check();
  start(card('world'), 90); fire(document, 'pointermove', 400); fire(document, 'pointercancel', 400); check();
  // Auto-scroll: 12 px per frame at full depth, proportional inside the 48 px band, nothing outside it.
  let scrollTop = 500;
  Object.defineProperty(cards, 'scrollTop', { configurable: true, get: () => scrollTop, set: value => { scrollTop = value; } });
  start(card('world'), 90);
  cards.getBoundingClientRect = rect(100, 1000);
  fire(document, 'pointermove', 1100 - 24);
  assert.equal(frames.length, 1); frames.shift()();
  assert.equal(scrollTop, 506, 'half way into the bottom band');
  frames.shift()(); assert.equal(scrollTop, 512);
  fire(document, 'pointermove', 90); frames.shift()(); assert.equal(scrollTop, 512 - 12, 'beyond the top edge: full speed');
  fire(document, 'pointermove', 600); frames.shift()?.(); assert.equal(frames.length, 0, 'the loop stops outside the bands');
  assert.equal(scrollTop, 500);
  fire(document, 'pointermove', 1099); assert.equal(frames.length, 1);
  fire(document, 'pointercancel', 1099); assert.equal(frames.length, 0, 'the drag end stops the loop');
});
