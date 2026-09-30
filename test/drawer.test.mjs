import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { normalizeSettings, VISUAL_DEFAULTS } from '../src/settings.js';
import { t as translate } from '../src/i18n.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));
const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
function setup(t, state = structuredClone(fixture)) {
  const dom = new JSDOM('<body><div id="extensions-settings-button"><button class="drawer-toggle"><span class="closedIcon"></span></button></div><div id="extensionsMenu"></div><textarea></textarea></body>', { pretendToBeVisual: true });
  const fake = createFakeST(); fake.add();
  fake.ctx.chatMetadata.sableTrackers = {
    ring: [{ mesId: 0, swipeId: 0, turn: 14, state, stale: true }],
    lastRun: { at: 1234567890000, ok: true, ms: 250, inTok: 123, outTok: 45 },
  };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document: dom.window.document });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const document = dom.window.document;
  const query = selector => document.querySelector(selector);
  const card = id => query(`[data-section="${id}"]`);
  const pointer = (target, type, x, y) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  const styled = () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    return element => dom.window.getComputedStyle(element);
  };
  return { dom, document, fake, runtime, ui, query, card, pointer, styled };
}

test('drawer renders full fixture safely and mode cycle updates settings and digest', t => {
  const state = structuredClone(fixture);
  const xss = '<img src=x onerror="globalThis.pwned=true">';
  state.world.summary = xss;
  const { query, card, fake, runtime, ui } = setup(t, state);
  assert.equal(ui.element.hidden, true);
  query('.st-sable-tab').click();
  assert.equal(ui.element.hidden, false);
  assert.equal(query('.st-sable-cards').children.length, 10);
  for (const id of runtime.snapshot().settings.order) assert.ok(card(id).querySelector('.st-sable-card-body').textContent.trim());
  assert.ok(card('world').textContent.includes(xss));
  assert.equal(ui.element.querySelector('img, script'), null);
  assert.equal(card('npcs').querySelectorAll('details')[0].open, true);
  assert.equal(card('npcs').querySelectorAll('details')[1].open, false);
  assert.equal(card('bonds').querySelectorAll('[role="meter"]').length, 8);
  assert.ok(card('bonds').querySelector('.st-sable-delta').textContent.includes('you gave her the key'));
  assert.ok(card('story').textContent.includes('2 хода'));
  assert.ok(query('.st-sable-status').textContent.includes('~123 / ~45'));
  assert.ok(query('.st-sable-stale').textContent.includes('устарело'));
  assert.ok(fake.calls.prompts.at(-1)[1].includes('МИР:'));
  card('world').querySelector('.st-sable-mode').click();
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'show');
  assert.equal(fake.calls.prompts.at(-1)[1].includes('МИР:'), false);
  card('world').querySelector('.st-sable-mode').click();
  assert.ok(card('world').classList.contains('st-sable-off'));
  assert.ok(card('world').querySelector('.st-sable-card-body').hidden);
  card('world').querySelector('.st-sable-mode').click();
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'inject');
  assert.ok(fake.calls.prompts.at(-1)[1].includes('МИР:'));
  runtime.updateSettings({ perChatOverrides: true });
  card('world').querySelector('.st-sable-mode').click();
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'inject');
  assert.equal(runtime.snapshot().store.modeOverride.world, 'show');
});

test('pointer reorder persists and changes digest order; cancel restores saved order', t => {
  const { card, query, pointer, document, runtime, fake } = setup(t);
  const order = runtime.snapshot().settings.order;
  for (const [index, item] of [...query('.st-sable-cards').children].entries()) {
    item.getBoundingClientRect = () => ({ top: index * 100, height: 100 });
  }
  pointer(card('world').querySelector('.st-sable-handle'), 'pointerdown', 10, 25);
  pointer(document, 'pointermove', 10, 180);
  assert.ok(card('world').classList.contains('st-sable-dragging'), 'dragged card is lifted');
  pointer(document, 'pointerup', 10, 180);
  assert.equal(query('.st-sable-dragging'), null);
  assert.deepEqual(runtime.snapshot().settings.order.slice(0, 3), ['offscreen', 'world', 'threads']);
  assert.deepEqual([...query('.st-sable-cards').children].map(item => item.dataset.section), runtime.snapshot().settings.order);
  runtime.setMode('offscreen', 'inject');
  assert.ok(fake.calls.prompts.at(-1)[1].indexOf('ЗА СЦЕНОЙ:') < fake.calls.prompts.at(-1)[1].indexOf('МИР:'));
  pointer(card('world').querySelector('.st-sable-handle'), 'pointerdown', 10, 25);
  pointer(document, 'pointermove', 10, 2000);
  pointer(document, 'pointercancel', 10, 2000);
  assert.equal(query('.st-sable-dragging'), null);
  assert.deepEqual([...query('.st-sable-cards').children].map(item => item.dataset.section), runtime.snapshot().settings.order);
  assert.equal(order[0], 'world');
});

test('folds, pin, edge tab toggle and visibility persist; menu, settings and refresh work', async t => {
  const { query, card, ui, runtime, pointer, document, fake } = setup(t);
  card('world').querySelector('.st-sable-fold').click();
  assert.equal(runtime.snapshot().settings.folded.world, true);
  runtime.publish();
  assert.ok(card('world').querySelector('.st-sable-card-body').hidden);
  query('.st-sable-menu-entry').click();
  assert.equal(ui.element.hidden, false);
  query('[aria-label="Закрепить"]').click();
  pointer(query('textarea'), 'pointerdown', 0, 0);
  assert.equal(ui.element.hidden, false);
  query('[aria-label="Закрепить"]').click();
  pointer(query('textarea'), 'pointerdown', 0, 0);
  assert.equal(ui.element.hidden, true);
  const tab = query('.st-sable-tab');
  assert.equal(tab.getAttribute('aria-expanded'), 'false');
  assert.equal(tab.getAttribute('aria-label'), 'Открыть Sable');
  pointer(tab, 'pointerdown', 0, 0);
  tab.click();
  assert.equal(ui.element.hidden, false, 'tapping the tab opens the panel');
  assert.equal(tab.getAttribute('aria-expanded'), 'true');
  assert.equal(tab.getAttribute('aria-label'), 'Закрыть Sable');
  assert.equal(query('.st-sable-menu-entry').getAttribute('aria-expanded'), 'true');
  pointer(tab, 'pointerdown', 0, 0);
  assert.equal(ui.element.hidden, false, 'pressing the tab is not an outside tap');
  tab.click();
  assert.equal(ui.element.hidden, true, 'the tab closes the open panel');
  assert.equal(tab.getAttribute('aria-expanded'), 'false');
  runtime.updateSettings({ floatingPosition: { x: 80, y: 120 } });
  assert.deepEqual([tab.style.left, tab.style.top], ['', ''], 'saved floating position is ignored');
  runtime.updateSettings({ showFloatingButton: false });
  assert.ok(tab.hidden);
  query('.st-sable-menu-entry').click();
  assert.equal(ui.element.hidden, false);
  let settingsClicks = 0;
  query('#extensions-settings-button .drawer-toggle').addEventListener('click', () => settingsClicks++);
  query('[aria-label="Настройки"]').click();
  assert.equal(settingsClicks, 1);
  assert.equal(ui.element.hidden, true);
  query('[aria-label="Обновить"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fake.calls.requests.length, 1);
  assert.ok(runtime.snapshot().store.lastRun.at);
  assert.equal(query('.st-sable-stale'), null);
  const originalCard = card('world');
  query('textarea').dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  assert.equal(card('world'), originalCard, 'typing must not render');
  ui.close(); ui.open();
  assert.equal(card('world'), originalCard, 'opening must not render');
  ui.dispose();
  assert.equal(query('.st-sable-drawer'), null);
  assert.equal(query('.st-sable-tab'), null);
});

test('empty sections use em dash and drawer settings normalize malformed saved values', t => {
  const { query } = setup(t, {});
  assert.equal(query('.st-sable-cards').querySelectorAll('.st-sable-empty').length, 10);
  const normalized = normalizeSettings({ folded: { world: true, thoughts: 'yes', unknown: true }, pinned: 'yes', floatingPosition: { x: Infinity, y: 4 } });
  assert.deepEqual(normalized.folded, { world: true });
  assert.equal(normalized.pinned, false);
  assert.equal(normalized.floatingPosition, null);
});

test('display macros use current names as literal text without changing stored state or digest', t => {
  const state = structuredClone(fixture);
  state.world.summary = '{{user}} meets {{char}} and {{user}}.';
  const { fake, runtime, card, ui } = setup(t, state);
  fake.ctx.name1 = '<img src=x> $&';
  fake.ctx.name2 = 'Guide {{user}}';
  runtime.publish();
  assert.ok(card('world').textContent.includes('<img src=x> $& meets Guide {{user}} and <img src=x> $&.'));
  assert.equal(ui.element.querySelector('img'), null);
  assert.equal(state.world.summary, '{{user}} meets {{char}} and {{user}}.');
  assert.ok(fake.calls.prompts.at(-1)[1].includes(state.world.summary));
  fake.ctx.name1 = 'New player';
  runtime.publish();
  assert.ok(card('world').textContent.includes('New player meets Guide {{user}} and New player.'));
  assert.ok(card('bonds').querySelector('.st-sable-bond-name').textContent.includes('→ New player'));
});

test('drawer CSS docks a full-height side panel, wraps text and keeps inset accents and tap targets', t => {
  const { dom, ui, query, styled } = setup(t);
  const computed = styled();
  ui.open();
  assert.match(css, /@media\s*\(max-width:\s*700px\)\s*\{\s*\.st-sable-drawer,\s*\.st-sable-tab\s*\{\s*--st-sable-panel-w:\s*min\(var\(--st-sable-width,\s*80vw\),\s*420px\)/);
  assert.match(css, /\.st-sable-drawer,\s*\.st-sable-tab\s*\{\s*--st-sable-panel-w:\s*min\(420px,\s*100vw\)/);
  const panel = computed(ui.element);
  assert.equal(panel.position, 'fixed');
  assert.equal(panel.width, 'var(--st-sable-panel-w)');
  assert.equal(panel.height, '100dvh', 'explicit height: <html> is a 0px containing block in SillyTavern');
  assert.equal(panel.top, '0px');
  assert.equal(panel.right, '0px');
  assert.equal(panel.zIndex, '9500');
  assert.equal(panel.fontSize, 'var(--st-sable-font, 13px)', 'base size comes from visual settings');
  assert.equal(panel.overflowX, 'hidden');
  assert.equal(panel.overflowWrap, 'anywhere');
  for (const element of [ui.element, ...ui.element.querySelectorAll('*')]) {
    const style = dom.window.getComputedStyle(element);
    assert.equal(style.boxSizing, 'border-box');
    if (element !== ui.element && /^\d+(\.\d+)?px$/.test(style.width)) {
      assert.ok(parseFloat(style.width) <= 320, `${element.className} exceeds a narrow phone drawer`);
    }
    if (/^\d+(\.\d+)?px$/.test(style.fontSize)) assert.ok(parseFloat(style.fontSize) <= 18, `${element.className} text is too large`);
  }
  assert.equal(query('.st-sable-header').querySelectorAll('button').length, 4);
  for (const button of ui.element.querySelectorAll('button')) {
    assert.ok(parseFloat(computed(button).minHeight) >= (button.classList.contains('st-sable-mode') ? 32 : 36));
  }
  for (const summary of ui.element.querySelectorAll('summary')) assert.ok(parseFloat(computed(summary).minHeight) >= 36, 'foldable rows are tap targets');
  assert.equal(computed(query('.st-sable-title')).minWidth, '0');
  assert.match(css, /\.st-sable-card::before\s*\{[^}]*top:\s*14px;\s*bottom:\s*14px;\s*width:\s*3px/);
  for (const [, property, value] of css.matchAll(/(animation|transition):([^;}]*)/g)) {
    for (const [, amount, unit] of value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
      assert.ok(Number(amount) * (unit === 's' ? 1000 : 1) <= 150, `${property} longer than 150 ms`);
    }
  }
});

test('edge tab is a right-edge glass pull tab, centred with viewport units, and moves to the panel edge when open', t => {
  const { query, ui, runtime, styled } = setup(t);
  const computed = styled();
  const tab = query('.st-sable-tab');
  assert.equal(query('.st-sable-floating'), null, 'no floating button');
  assert.equal(tab.parentElement, query('body'), 'tab lives outside the clipped panel');
  assert.ok(tab.querySelector('.fa-solid.fa-wand-magic-sparkles'));
  assert.ok(tab.querySelector('.fa-solid.fa-chevron-right'));
  let style = computed(tab);
  assert.equal(style.position, 'fixed');
  assert.equal(style.right, '0px');
  assert.equal(style.left, 'auto');
  assert.equal(style.top, '50dvh', 'top: 50% would resolve against the 0px <html>');
  assert.equal(style.transform, 'translateY(-50%)');
  assert.equal(style.width, '22px');
  assert.equal(style.height, '72px');
  assert.equal(style.zIndex, '9501');
  assert.equal(style.borderRadius, '12px 0 0 12px');
  assert.match(css, /\.st-sable-tab::before\s*\{[^}]*left:\s*-14px/, 'hit area widened to 36px');
  ui.open();
  style = computed(tab);
  assert.equal(tab.getAttribute('aria-expanded'), 'true');
  assert.equal(style.right, 'var(--st-sable-panel-w)', 'tab sits on the panel left edge');
  assert.equal(style.width, '22px');
  ui.close();
  assert.equal(computed(tab).right, '0px');
  runtime.updateSettings({ language: 'en' });
  assert.equal(tab.getAttribute('aria-label'), 'Open Sable');
  assert.equal(translate('showFloatingButton', 'ru'), 'Язычок сбоку');
  assert.equal(translate('showFloatingButton', 'en'), 'Edge tab');
  for (const name of ['rotate', 'thumbtack', 'gear', 'xmark']) assert.ok(query('.st-sable-header button > .fa-solid.fa-' + name));
  assert.ok(query('.st-sable-title > .fa-solid.fa-wand-magic-sparkles'));
  assert.ok(query('#extensionsMenu > .list-group-item.flex-container.flexGap5.st-sable-menu-entry > div.fa-solid.fa-wand-magic-sparkles.extensionsMenuExtensionButton'));
  assert.equal(query('.st-sable-menu-entry > span').textContent, 'Sable');
});

test('cards read at a glance: icons, mode accents, priority dots, bars with deltas, numbered beats, chips', t => {
  const state = structuredClone(fixture);
  state.bonds[0].changes.tension = { delta: -3, reason: 'the fire is warm' };
  state.story.seeds.push({ text: 'an old debt', planted_turn: 9 }, { text: 'a fresh one', planted_turn: 13 }, { text: 'undated' });
  const { card, query, runtime, ui } = setup(t, state);
  for (const [id, glyph] of [['world', 'globe'], ['threads', 'code-branch'], ['bonds', 'handshake'], ['banlist', 'ban']]) {
    assert.ok(card(id).querySelector(`.st-sable-card-title > .fa-solid.fa-${glyph}.st-sable-card-icon[aria-hidden="true"]`));
  }
  assert.equal(card('world').dataset.mode, 'inject');
  assert.equal(card('thoughts').dataset.mode, 'show');
  assert.equal(card('world').querySelector('.st-sable-mode').dataset.mode, 'inject');
  assert.ok(card('world').querySelector('.st-sable-handle > .fa-solid.fa-grip-vertical'));
  assert.ok(card('world').querySelector('.st-sable-fold > .fa-solid.fa-chevron-down'));
  assert.deepEqual([...card('world').querySelectorAll('.st-sable-meta-item')].map(item => item.title), ['Время', 'Место', 'Погода']);
  assert.equal(card('world').querySelector('.st-sable-you .st-sable-key').textContent, 'ВЫ');
  const dots = [...card('threads').querySelectorAll('.st-sable-dot')];
  assert.deepEqual(dots.map(dot => dot.className), ['st-sable-dot st-sable-priority-high', 'st-sable-dot st-sable-priority-mid', 'st-sable-dot st-sable-priority-low']);
  assert.deepEqual(dots.map(dot => dot.getAttribute('aria-label')), ['важно', 'средне', 'фон']);
  assert.deepEqual([...card('story').querySelectorAll('.st-sable-item-meta')].map(item => item.textContent), ['2 хода', '5 ходов', '1 ход', 'in 2 days']);
  assert.equal(card('story').querySelectorAll('.st-sable-item').length, 5, 'undated seed shows without a fake age');
  assert.equal(card('story').querySelectorAll('.st-sable-chips > .st-sable-tag').length, 2);
  const [maren, tomas] = card('npcs').querySelectorAll('details');
  assert.ok(maren.classList.contains('st-sable-present'));
  assert.ok(tomas.classList.contains('st-sable-absent'));
  assert.equal(tomas.querySelector('.st-sable-pill').textContent, 'не здесь');
  assert.equal(maren.querySelector('.st-sable-kv dt').textContent, 'Одежда');
  const trust = card('bonds').querySelector('[role="meter"][aria-label="Доверие"]');
  assert.equal(trust.getAttribute('aria-valuenow'), '34');
  assert.equal(trust.querySelector('.st-sable-bar-fill').style.width, '34%');
  assert.ok(trust.classList.contains('st-sable-affinity'));
  assert.ok(card('bonds').querySelector('[aria-label="Напряжение"]').classList.contains('st-sable-friction'));
  assert.equal(card('bonds').querySelector('[aria-label="Влечение"]'), null, 'unknown scales stay hidden');
  const deltas = [...card('bonds').querySelectorAll('details.st-sable-delta')];
  assert.deepEqual(deltas.map(item => item.querySelector('.st-sable-badge').textContent), ['+5', '−3']);
  assert.ok(deltas[0].querySelector('.st-sable-badge').classList.contains('st-sable-up'));
  assert.ok(deltas[1].querySelector('.st-sable-badge').classList.contains('st-sable-down'));
  assert.equal(deltas[1].querySelector('.st-sable-reason').textContent, 'the fire is warm');
  assert.equal(deltas[0].open, false, 'reason on tap');
  assert.equal(card('thoughts').querySelector('.st-sable-quote').textContent, '«If I tell them about Tomas, the whole village turns on him. Not yet.»');
  assert.equal(card('planner').querySelectorAll('ol.st-sable-beats > li').length, 1);
  assert.equal(card('planner').querySelector('.st-sable-why').textContent, 'pays off the rope thread');
  assert.equal(card('planner').querySelector('.st-sable-note .st-sable-key').textContent, 'не забыть');
  assert.equal(card('banlist').querySelectorAll('.st-sable-tag.st-sable-ban').length, 2);
  assert.deepEqual([...card('dossiers').querySelector('summary').children].map(item => item.textContent), ['Maren', "lighthouse keeper's widow"]);
  assert.ok(query('.st-sable-status-dot.st-sable-ok'));
  // Rows the user unfolded stay unfolded across re-renders; nothing jumps.
  tomas.open = true; deltas[1].open = true;
  runtime.publish();
  assert.equal(card('npcs').querySelectorAll('details')[1].open, true);
  assert.equal(card('bonds').querySelectorAll('details.st-sable-delta')[1].open, true);
  runtime.updateSettings({ language: 'en' });
  assert.ok(card('story').textContent.includes('2 turns'));
  assert.ok(card('story').textContent.includes('1 turn'));
  assert.equal(card('thoughts').querySelector('.st-sable-quote').textContent.at(0), '“');
  assert.equal(ui.element.querySelector('img, script'), null);
});

test('visual settings become CSS variables on the drawer and tab, live on every render', t => {
  const { ui, query, runtime, styled } = setup(t);
  const tab = query('.st-sable-tab');
  const vars = element => Object.fromEntries(['opacity', 'blur', 'font', 'width', 'accent', 'radius']
    .map(name => [name, element.style.getPropertyValue(`--st-sable-${name}`)]));
  assert.deepEqual(vars(ui.element), { opacity: '0.93', blur: '14px', font: '13px', width: '80vw', accent: '#f5f4ee', radius: '18px' });
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, opacity: 0.7, blur: 4, fontSize: 15, widthVw: 92, accent: '#8B5CF6', radius: 10 } });
  const expected = { opacity: '0.7', blur: '4px', font: '15px', width: '92vw', accent: '#8b5cf6', radius: '10px' };
  assert.deepEqual(vars(ui.element), expected);
  assert.deepEqual(vars(tab), expected, 'the tab follows the panel width');
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, opacity: 7, blur: -1, accent: 'red; background: url(x)' } });
  assert.deepEqual([vars(ui.element).opacity, vars(ui.element).blur, vars(ui.element).accent], ['1', '0px', '#f5f4ee'], 'values are clamped and validated');
  const computed = styled();
  ui.open();
  assert.match(css, /\.st-sable-drawer\s*\{[^}]*background:\s*rgba\(14,14,18,var\(--st-sable-opacity,\s*\.93\)\)/);
  assert.match(css, /\.st-sable-drawer\s*\{[^}]*backdrop-filter:\s*blur\(var\(--st-sable-blur,\s*14px\)\)/);
  assert.match(css, /\.st-sable-card\s*\{[^}]*border-radius:\s*var\(--st-sable-radius,\s*18px\)/);
  assert.match(css, /\.st-sable-card::before\s*\{[^}]*background:\s*var\(--st-sable-accent,\s*#f5f4ee\)/);
  assert.match(css, /\.st-sable-mode\[data-mode="inject"\]\s*\{[^}]*var\(--st-sable-accent,\s*#f5f4ee\)/);
  assert.equal(computed(ui.element.querySelector('.st-sable-card-body')).fontSize, 'var(--st-sable-fs)');
});

test('title icons switch between Font Awesome and registry emoji', t => {
  const { card, runtime } = setup(t);
  assert.ok(card('world').querySelector('.st-sable-card-title > i.fa-solid.fa-globe.st-sable-card-icon'));
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, icons: 'emoji' } });
  const glyph = card('world').querySelector('.st-sable-card-icon');
  assert.equal(glyph.tagName, 'SPAN');
  assert.equal(glyph.textContent, '🌍');
  assert.equal(glyph.getAttribute('aria-hidden'), 'true');
  assert.equal(card('world').querySelector('.fa-globe'), null);
  assert.equal(card('banlist').querySelector('.st-sable-card-icon').textContent, '🚫');
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, icons: 'fa' } });
  assert.ok(card('world').querySelector('.st-sable-card-icon.fa-globe'));
});
