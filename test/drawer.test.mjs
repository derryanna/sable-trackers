import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer, inkFor, luminance, visualColors } from '../src/ui/drawer.js';
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

test('drawer renders full fixture safely and mode menu updates settings and digest', t => {
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
  assert.equal(fake.calls.prompts.at(-1)[1], '');
  card('world').querySelector('.st-sable-mode').click();
  query('.st-sable-mode-option[data-mode="show"]').click();
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'show');
  assert.equal(fake.calls.prompts.at(-1)[1].includes('МИР:'), false);
  card('world').querySelector('.st-sable-mode').click();
  query('.st-sable-mode-option[data-mode="off"]').click();
  query('.st-sable-hidden-toggle').click();
  assert.ok(card('world').classList.contains('st-sable-off'));
  assert.ok(card('world').querySelector('.st-sable-card-body').hidden);
  card('world').querySelector('.st-sable-mode').click();
  query('.st-sable-mode-option[data-mode="inject"]').click();
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'inject');
  assert.equal(fake.calls.prompts.at(-1)[1], '');
  runtime.updateSettings({ perChatOverrides: true });
  card('world').querySelector('.st-sable-mode').click();
  query('.st-sable-mode-option[data-mode="show"]').click();
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'inject');
  assert.equal(runtime.snapshot().store.modeOverride.world, 'show');
});

test('reply edit keeps the drawer state and stale hint while removing its injection', async t => {
  const { fake, runtime, query, card } = setup(t);
  delete runtime.snapshot().entry.stale;
  runtime.publish();
  const content = card('world').textContent;
  assert.notEqual(fake.calls.prompts.at(-1)[1], '');
  fake.ctx.chat[0].mes = 'Trimmed reply';
  await fake.emit('MESSAGE_EDITED', 0);
  assert.equal(card('world').textContent, content);
  assert.ok(query('.st-sable-stale'));
  assert.equal(runtime.snapshot().entry.stale, true);
  assert.equal(fake.calls.prompts.at(-1)[1], '');
});

test('pointer reorder persists and changes digest order; cancel restores saved order', t => {
  const { card, query, pointer, document, runtime, fake } = setup(t);
  delete runtime.snapshot().entry.stale;
  runtime.publish();
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
  delete runtime.snapshot().entry.stale;
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
  assert.equal(query('.st-sable-header').querySelectorAll('button').length, 5);
  for (const button of ui.element.querySelectorAll('button')) {
    assert.ok(parseFloat(computed(button).minHeight) >= (button.classList.contains('st-sable-mode') ? 32 : 36));
  }
  for (const summary of ui.element.querySelectorAll('summary')) assert.ok(parseFloat(computed(summary).minHeight) >= 36, 'foldable rows are tap targets');
  assert.equal(computed(query('.st-sable-title')).minWidth, '0');
  assert.match(css, /\.st-sable-card::before\s*\{[^}]*top:\s*14px;\s*bottom:\s*14px;\s*width:\s*3px/);
  // Up to the live-card block (SPEC §16), which states its own limits per rule in test/effects.test.mjs.
  for (const [, property, value] of css.slice(0, css.indexOf('/* Live cards (SPEC §16)')).matchAll(/(animation|transition):([^;}]*)/g)) {
    if (value.includes('st-sable-pulse')) { assert.match(value, /1\.5s ease-in-out infinite/); continue; }
    for (const [, amount, unit] of value.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
      assert.ok(Number(amount) * (unit === 's' ? 1000 : 1) <= 200, `${property} longer than 200 ms`);
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
  assert.equal(trust.querySelector('.st-sable-bar-fill').style.transform, 'scaleX(0.34)', 'the fill is scaled, so a new value slides it (SPEC §16)');
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
  assert.deepEqual(vars(ui.element), { opacity: '0.93', blur: '14px', font: '13px', width: '80vw', accent: '', radius: '18px' }, 'the default accent is left to the CSS ink fallback');
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, opacity: 0.7, blur: 4, fontSize: 15, widthVw: 92, accent: '#8B5CF6', radius: 10 } });
  const expected = { opacity: '0.7', blur: '4px', font: '15px', width: '92vw', accent: '#8b5cf6', radius: '10px' };
  assert.deepEqual(vars(ui.element), expected);
  assert.deepEqual(vars(tab), expected, 'the tab follows the panel width');
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, opacity: 7, blur: -1, accent: 'red; background: url(x)' } });
  assert.deepEqual([vars(ui.element).opacity, vars(ui.element).blur, vars(ui.element).accent], ['1', '0px', ''], 'values are clamped and validated');
  const computed = styled();
  ui.open();
  assert.match(css, /\.st-sable-drawer\s*\{[^}]*background:\s*rgba\(var\(--st-sable-base-rgb,\s*14,14,18\),\s*var\(--st-sable-opacity,\s*\.93\)\)/);
  assert.match(css, /\.st-sable-drawer\s*\{[^}]*backdrop-filter:\s*blur\(var\(--st-sable-blur,\s*14px\)\)/);
  assert.match(css, /\.st-sable-card\s*\{[^}]*border-radius:\s*var\(--st-sable-radius,\s*18px\)/);
  assert.match(css, /\.st-sable-card::before\s*\{[^}]*background:\s*var\(--st-sable-accent,\s*rgb\(var\(--st-sable-ink-rgb,\s*245,244,238\)\)\)/);
  assert.match(css, /\.st-sable-mode\[data-mode="inject"\]\s*\{[^}]*color:\s*rgb\(var\(--st-sable-accent-ink-rgb,\s*0,0,0\)\);\s*background:\s*var\(--st-sable-accent,[^;]*;\s*border-color:\s*rgba\(var\(--st-sable-ink-rgb,\s*255,255,255\),\s*\.45\)/);
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

test('ink: black or white by WCAG contrast; accent ink for text on a solid accent fill', () => {
  assert.equal(inkFor('#ffffff'), '0,0,0');
  assert.equal(inkFor('#0e0e12'), '255,255,255');
  // Crossover where both contrast ratios are equal: luminance ≈ 0.179, between these two greys.
  assert.ok(luminance('#757575') < 0.1791 && luminance('#767676') > 0.1791);
  assert.equal(inkFor('#757575'), '255,255,255');
  assert.equal(inkFor('#767676'), '0,0,0');
  // A pastel light-theme base (luminance ≈ 0.39) gets black ink: 8.8:1 instead of 2.4:1 with white.
  assert.ok(luminance('#b39ddb') > 0.35 && luminance('#b39ddb') < 0.5);
  assert.equal(inkFor('#b39ddb'), '0,0,0');
  assert.equal(inkFor('#8a6d1e'), '255,255,255');
  assert.equal(inkFor('#f5f4ee'), '0,0,0');
  assert.equal(visualColors({ accent: '#8a6d1e' })['accent-ink-rgb'], '255,255,255', 'dark gold chip gets white text');
  assert.equal(visualColors({ accent: '#f5f4ee' })['accent-ink-rgb'], '0,0,0');
  assert.equal(visualColors({ base: '#ffffff' })['accent-ink-rgb'], '255,255,255', 'default accent follows the black ink');
  assert.equal(visualColors({ base: '#ffffff', text: '#444444' })['ink-rgb'], '0,0,0', 'text colour never changes the overlay ink');
});

test('base and text colours set ink variables and tone on the drawer and the tab; auto removes them', t => {
  const { ui, query, runtime } = setup(t);
  const tab = query('.st-sable-tab');
  const colors = element => Object.fromEntries(['base-rgb', 'ink-rgb', 'accent', 'accent-ink-rgb', 'text']
    .map(name => [name, element.style.getPropertyValue(`--st-sable-${name}`)]).concat([['tone', element.dataset.stSableTone ?? '']]));
  const auto = { 'base-rgb': '', 'ink-rgb': '', accent: '', 'accent-ink-rgb': '0,0,0', text: '', tone: '' };
  assert.deepEqual(colors(ui.element), auto, 'no base: dark glass, theme text');
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, base: '#FDF6E3' } });
  const light = { 'base-rgb': '253,246,227', 'ink-rgb': '0,0,0', accent: '', 'accent-ink-rgb': '255,255,255', text: 'rgb(0,0,0)', tone: 'light' };
  assert.deepEqual(colors(ui.element), light);
  assert.deepEqual(colors(tab), light, 'the tab matches the panel');
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, base: '#fdf6e3', text: '#5b4636', accent: '#8a6d1e' } });
  assert.deepEqual(colors(ui.element), { ...light, text: '#5b4636', accent: '#8a6d1e', 'accent-ink-rgb': '255,255,255' });
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, base: '#1d2430' } });
  assert.deepEqual([colors(tab)['ink-rgb'], colors(tab).tone, colors(tab).text], ['255,255,255', 'dark', 'rgb(255,255,255)']);
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, text: '#ffcc00' } });
  assert.deepEqual(colors(ui.element), { ...auto, text: '#ffcc00' }, 'a text colour alone keeps the dark glass');
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS } });
  assert.deepEqual(colors(ui.element), auto);
  assert.equal(ui.element.hasAttribute('data-st-sable-tone'), false);
});

test('drawer and tab overlays read the ink variable; only the reply panel and settings keep theme colours', () => {
  const drawerCss = css.slice(0, css.indexOf('/* Compact scene strip'));
  const white = drawerCss.replaceAll('var(--st-sable-ink-rgb, 255,255,255)', 'INK').match(/rgba?\(\s*255\s*,\s*255\s*,\s*255/g);
  assert.equal(white, null, 'no hard-coded white overlay left in the drawer or tab');
  assert.ok((drawerCss.match(/rgba\(var\(--st-sable-ink-rgb, 255,255,255\), \.\d+\)/g) ?? []).length >= 25);
  assert.match(drawerCss, /\.st-sable-drawer\s*\{[^}]*color:\s*var\(--st-sable-text,\s*var\(--SmartThemeBodyColor/);
  assert.match(drawerCss, /\.st-sable-tab\s*\{[^}]*color:\s*var\(--st-sable-text,[^}]*background:\s*rgba\(var\(--st-sable-base-rgb,\s*24,24,30\),\s*\.7\)/);
  assert.match(drawerCss, /\.st-sable-tab\[aria-expanded="true"\]\s*\{[^}]*rgba\(var\(--st-sable-base-rgb,\s*14,14,18\),\s*var\(--st-sable-opacity,\s*\.93\)\)/);
  assert.match(drawerCss, /\.st-sable-bar-fill\s*\{[^}]*rgba\(var\(--st-sable-ink-rgb,\s*245,244,238\),\s*\.82\)/);
  for (const rule of ['.st-sable-up', '.st-sable-down', '.st-sable-bar', ':is(.st-sable-dot']) {
    assert.ok(css.includes(`.st-sable-drawer[data-st-sable-tone="light"] ${rule}`), `light-base rule for ${rule}`);
  }
});

test('list and meta markers follow visual.icons: Font Awesome by default, emoji on request', t => {
  const { card, runtime } = setup(t);
  const story = () => card('story');
  assert.ok(story().querySelector('.st-sable-glyph > i.fa-solid.fa-seedling'));
  assert.ok(story().querySelector('.st-sable-glyph > i.fa-solid.fa-hourglass-half'));
  assert.equal(/🌱|⏳/.test(story().textContent), false, 'no emoji markers in FA mode');
  assert.deepEqual([...card('world').querySelectorAll('.st-sable-meta-item > i.fa-solid')].map(item => item.classList[1]),
    ['fa-clock', 'fa-location-dot', 'fa-cloud-sun-rain']);
  runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS, icons: 'emoji' } });
  assert.deepEqual([...story().querySelectorAll('.st-sable-glyph')].map(item => item.textContent), ['🌱', '⏳']);
  assert.equal(story().querySelector('.st-sable-glyph .fa-solid'), null);
  assert.deepEqual([...card('world').querySelectorAll('.st-sable-meta-item > .st-sable-emoji')].map(item => item.textContent), ['🕒', '📍', '🌦️']);
});

function spyEdits(runtime) {
  const calls = [], original = runtime.editState;
  runtime.editState = (...args) => { calls.push(structuredClone(args)); return original(...args); };
  return calls;
}
const field = (root, caption) => [...root.querySelectorAll('.st-sable-editor-field, .st-sable-editor-check')]
  .find(row => row.querySelector('.st-sable-editor-label').textContent === caption)?.querySelector('input, textarea, select');
function type(document, element, value) {
  element.value = value;
  element.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
  element.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
}

test('editor: threads edit, add and remove rows, save sanitizes through runtime.editState and re-injects', t => {
  const { card, runtime, fake, document, ui } = setup(t);
  const calls = spyEdits(runtime);
  const world = card('world');
  const edit = card('threads').querySelector('[data-control="edit"]');
  assert.equal(edit.getAttribute('aria-label'), 'Редактировать: Открытые нити');
  edit.click();
  assert.equal(card('world'), world, 'opening an editor leaves the other cards alone');
  const editor = card('threads').querySelector('.st-sable-editor');
  assert.ok(editor);
  assert.equal(card('threads').querySelector('[data-control="edit"]').getAttribute('aria-pressed'), 'true');
  let rows = editor.querySelectorAll('.st-sable-editor-item');
  assert.equal(rows.length, 3);
  const first = field(rows[0], 'Текст');
  assert.equal(first.tagName, 'TEXTAREA');
  assert.equal(first.rows, 2);
  assert.equal(field(rows[0], 'Важность').value, 'high');
  assert.deepEqual([...field(rows[0], 'Важность').options].map(option => option.textContent), ['важно', 'средне', 'фон']);
  type(document, first, '  Who cut the rope, and when?  ');
  rows[2].querySelector('.st-sable-editor-remove').click();
  editor.querySelector('.st-sable-editor-add').click();
  rows = editor.querySelectorAll('.st-sable-editor-item');
  assert.equal(rows.length, 3);
  assert.equal(document.activeElement, field(rows[2], 'Текст'), 'a new row takes focus');
  type(document, field(rows[2], 'Текст'), 'A second boat was seen');
  type(document, field(rows[2], 'Важность'), 'high');
  editor.querySelector('.st-sable-editor-add').click();
  assert.equal(editor.querySelectorAll('.st-sable-editor-item').length, 4, 'an empty row is allowed while editing');
  for (let index = 0; index < 3; index++) editor.querySelector('.st-sable-editor-add').click();
  assert.equal(editor.querySelectorAll('.st-sable-editor-item').length, 6);
  assert.equal(editor.querySelector('.st-sable-editor-add').disabled, true, 'the schema max (6) caps rows');
  editor.querySelector('.st-sable-editor-save').click();
  const expected = [{ text: 'Who cut the rope, and when?', priority: 'high' }, { text: 'The missing logbook page', priority: 'mid' },
    { text: 'A second boat was seen', priority: 'high' }];
  assert.deepEqual(calls, [['threads', expected]], 'editState receives the schema-sanitized value');
  assert.deepEqual(runtime.snapshot().entry.state.threads, expected, 'rows without text are dropped by the schema');
  assert.equal(card('threads').querySelector('.st-sable-editor'), null, 'saving closes the editor');
  assert.ok(card('threads').textContent.includes('A second boat was seen'));
  assert.ok(fake.calls.prompts.at(-1)[1].includes('A second boat was seen'));
  assert.equal(fake.calls.prompts.at(-1)[1].includes('lamp failed'), false);
  assert.ok(runtime.snapshot().entry.state.meta.editedAt);
  assert.equal(runtime.snapshot().entry.stale, undefined, 'a manual edit clears the outdated mark');
  assert.equal(ui.element.querySelector('img, script'), null);
});

test('editor: cancel restores, a draft survives runtime notifications, and a changed state shows a warning', t => {
  const { card, runtime, document } = setup(t);
  const calls = spyEdits(runtime);
  card('world').querySelector('[data-control="edit"]').click();
  const editor = card('world').querySelector('.st-sable-editor');
  const location = field(editor, 'Место');
  assert.equal(location.value, "lighthouse keeper's cottage");
  assert.equal(field(editor, 'Кратко').value, 'Maren shows {{user}} the torn logbook by the stove.', 'raw text, macros kept');
  assert.equal(field(editor, 'Одежда').value, 'oilskin coat', 'nested pc object recurses');
  location.focus();
  location.value = 'the chapel';
  runtime.publish();
  assert.equal(card('world').querySelector('.st-sable-editor'), editor, 'the editor node survives a render');
  assert.equal(location.value, 'the chapel');
  assert.equal(document.activeElement, location, 'focus stays in the draft');
  assert.equal(editor.querySelector('.st-sable-editor-note').hidden, true);
  card('world').querySelector('.st-sable-mode').click();
  card('world').querySelector('.st-sable-mode-option[data-mode="show"]').click();
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'show');
  assert.equal(card('world').querySelector('.st-sable-editor'), editor, 'the mode chip still works on an editing card');
  runtime.editState('threads', []);
  assert.equal(editor.querySelector('.st-sable-editor-note').hidden, true, 'another section changing is not a conflict');
  runtime.editState('world', { location: 'Harbour' });
  assert.equal(editor.querySelector('.st-sable-editor-note').hidden, false, 'warn when this section changed underneath');
  assert.equal(location.value, 'the chapel', 'the draft is kept');
  editor.querySelector('.st-sable-editor-cancel').click();
  assert.equal(card('world').querySelector('.st-sable-editor'), null);
  assert.ok(card('world').textContent.includes('Harbour'));
  assert.equal(card('world').textContent.includes('the chapel'), false);
  assert.deepEqual(calls.map(call => call[0]), ['threads', 'world'], 'cancel does not save');
  card('world').querySelector('[data-control="edit"]').click();
  card('world').querySelector('[data-control="edit"]').click();
  assert.equal(card('world').querySelector('.st-sable-editor'), null, 'the pen toggles the editor off');
});

test('editor: scores clamp, empty score is unknown, changes are read-only; a folded card unfolds to edit', t => {
  const { card, runtime, document } = setup(t);
  runtime.updateSettings({ folded: { bonds: true } });
  card('bonds').querySelector('[data-control="edit"]').click();
  assert.equal(runtime.snapshot().settings.folded.bonds, false);
  const editor = card('bonds').querySelector('.st-sable-editor');
  assert.equal(editor.querySelector('.st-sable-editor-id').textContent, 'id: maren');
  assert.ok(editor.querySelector('.st-sable-editor-grid'), 'scales use a compact grid');
  const trust = field(editor, 'Доверие'), fear = field(editor, 'Страх'), desire = field(editor, 'Влечение');
  assert.deepEqual([trust.type, trust.min, trust.max, desire.value], ['number', '0', '100', '']);
  type(document, trust, '150');
  assert.equal(trust.value, '100', 'clamped on change');
  type(document, fear, '-4');
  assert.equal(fear.value, '0');
  assert.ok(editor.querySelector('.st-sable-editor-readonly').textContent.includes('you gave her the key'));
  editor.querySelector('.st-sable-editor-save').click();
  const [bond] = runtime.snapshot().entry.state.bonds;
  assert.equal(bond.id, 'maren');
  assert.deepEqual(bond.stats, { affection: 22, trust: 100, desire: null, love: null, reputation: 40, suspicion: 45, respect: 38, fear: 0, grudge: 0, tension: 60 });
  assert.deepEqual(bond.changes, { trust: { delta: 5, reason: 'you gave her the key' } }, 'changes pass through untouched');
});

test('editor: custom kv sections and NPC booleans are editable', t => {
  const { card, runtime, fake, document } = setup(t);
  runtime.updateSettings({ customSections: [{ id: 'c_0123abcd', title: 'Clues', shape: 'kv', max: 3, mode: 'inject', period: 1 }] });
  card('c_0123abcd').querySelector('[data-control="edit"]').click();
  const editor = card('c_0123abcd').querySelector('.st-sable-editor');
  editor.querySelector('.st-sable-editor-add').click();
  type(document, field(editor, 'Ключ'), 'Knife');
  type(document, field(editor, 'Значение'), 'under the stove');
  editor.querySelector('.st-sable-editor-save').click();
  assert.deepEqual(runtime.snapshot().entry.state.c_0123abcd, [{ key: 'Knife', value: 'under the stove' }]);
  assert.ok(fake.calls.prompts.at(-1)[1].includes('CLUES: Knife: under the stove'));
  assert.ok(card('c_0123abcd').textContent.includes('under the stove'));
  card('npcs').querySelector('[data-control="edit"]').click();
  const npcs = card('npcs').querySelector('.st-sable-editor');
  const [maren, tomas] = npcs.querySelectorAll(':scope > .st-sable-editor-array > .st-sable-editor-items > .st-sable-editor-item');
  const present = field(tomas, 'В сцене');
  assert.deepEqual([field(maren, 'В сцене').checked, present.type, present.checked], [true, 'checkbox', false]);
  present.checked = true;
  npcs.querySelector('.st-sable-editor-add').click();
  const rows = npcs.querySelectorAll(':scope > .st-sable-editor-array > .st-sable-editor-items > .st-sable-editor-item');
  type(document, field(rows.at?.(-1) ?? rows[rows.length - 1], 'Имя'), 'Old Ilse');
  npcs.querySelector('.st-sable-editor-save').click();
  const saved = runtime.snapshot().entry.state.npcs;
  assert.equal(saved.find(npc => npc.id === 'tomas').present, true);
  assert.deepEqual(saved.at(-1), { id: 'old_ilse', name: 'Old Ilse', present: false }, 'a new NPC derives its id from the name');
});

test('mode menu checks current mode, supports keyboard selection and restores chip focus', t => {
  const { card, query, runtime, document, ui, styled } = setup(t);
  ui.open();
  const chip = () => card('world').querySelector('[data-control="mode"]');
  const key = (element, key) => element.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  assert.equal(chip().getAttribute('aria-haspopup'), 'menu');
  assert.equal(chip().getAttribute('aria-expanded'), 'false');
  chip().focus(); key(chip(), 'ArrowDown');
  assert.equal(runtime.snapshot().modes.world, 'inject', 'opening never writes a mode');
  assert.equal(chip().getAttribute('aria-expanded'), 'true');
  const choices = [...query('[role="menu"]').children];
  assert.deepEqual(choices.map(item => item.textContent), ['в промпт', 'показ', 'выкл']);
  assert.deepEqual(choices.map(item => item.getAttribute('aria-checked')), ['true', 'false', 'false']);
  assert.ok(choices[0].querySelector('.fa-check'));
  assert.equal(document.activeElement, choices[0]);
  key(document.activeElement, 'ArrowUp'); assert.equal(document.activeElement, choices[2]);
  key(document.activeElement, 'ArrowDown'); assert.equal(document.activeElement, choices[0]);
  key(document.activeElement, 'End'); assert.equal(document.activeElement, choices[2]);
  key(document.activeElement, 'Home'); assert.equal(document.activeElement, choices[0]);
  key(document.activeElement, 'ArrowDown'); key(document.activeElement, 'Enter');
  assert.equal(runtime.snapshot().modes.world, 'show');
  assert.equal(query('[role="menu"]'), null);
  assert.equal(document.activeElement, chip());
  chip().click(); key(document.activeElement, 'Escape');
  assert.equal(query('[role="menu"]'), null);
  assert.equal(document.activeElement, chip());
  assert.equal(ui.element.hidden, false, 'Escape closes the menu before the drawer');
  chip().click();
  const computed = styled();
  for (const item of query('[role="menu"]').children) {
    assert.ok(parseFloat(computed(item).minHeight) >= 36);
    assert.ok(parseFloat(computed(item).minWidth) >= 44);
  }
  assert.equal(computed(query('[role="menu"]')).right, '0px', 'menu aligns to chip right edge');
  assert.equal(card('world').querySelector('.st-sable-card-header').children.length, 4, 'no fifth header control');
});

test('mode menu closes outside, on second tap, drawer close and render; only one opens', t => {
  const { card, query, runtime, document, pointer, ui } = setup(t);
  ui.open();
  const chip = id => card(id).querySelector('[data-control="mode"]');
  chip('world').click(); chip('threads').click();
  assert.equal(document.querySelectorAll('[role="menu"]').length, 1);
  assert.equal(chip('world').getAttribute('aria-expanded'), 'false');
  assert.equal(chip('threads').getAttribute('aria-expanded'), 'true');
  chip('threads').click(); assert.equal(query('[role="menu"]'), null);
  chip('world').click(); pointer(query('.st-sable-status'), 'pointerdown', 0, 0);
  assert.equal(query('[role="menu"]'), null);
  assert.equal(ui.element.hidden, false);
  chip('world').click(); query('.st-sable-status').click(); assert.equal(query('[role="menu"]'), null);
  chip('world').click(); runtime.publish(); assert.equal(query('[role="menu"]'), null);
  assert.equal(document.activeElement, chip('world'));
  chip('world').click(); ui.close(); assert.equal(query('[role="menu"]'), null);
});

test('whole header folds except controls; off cards cannot fold', t => {
  const { card, query, runtime } = setup(t);
  const header = () => card('world').querySelector('.st-sable-card-header');
  header().querySelector('.st-sable-card-icon').click();
  assert.equal(runtime.snapshot().settings.folded.world, true);
  assert.equal(header().getAttribute('role'), null);
  header().click(); assert.equal(runtime.snapshot().settings.folded.world, false);
  header().querySelector('.st-sable-handle').click();
  header().querySelector('[data-control="mode"]').click();
  query('[role="menu"]').click();
  query('.st-sable-mode-option[data-mode="show"]').click();
  assert.equal(runtime.snapshot().settings.folded.world, false);
  header().querySelector('[data-control="fold"]').click();
  assert.equal(runtime.snapshot().settings.folded.world, true, 'chevron toggles once');
  runtime.updateSettings({ hideOff: false, folded: { world: false } });
  runtime.setMode('world', 'off'); header().click();
  assert.equal(runtime.snapshot().settings.folded.world, false);
  assert.equal(header().querySelector('[data-control="fold"]').disabled, true);
});

test('off sections use effective modes, reveal in order, survive renders and drop editors', t => {
  const { runtime, card, query, document, ui } = setup(t);
  ui.open();
  card('world').querySelector('[data-control="edit"]').click();
  const draft = card('world').querySelector('.st-sable-editor');
  runtime.updateSettings({ perChatOverrides: true });
  runtime.setMode('world', 'off'); runtime.setMode('threads', 'off');
  assert.equal(runtime.snapshot().settings.sections.world.mode, 'inject');
  assert.equal(card('world'), null); assert.equal(card('threads'), null);
  assert.equal(draft.isConnected, false);
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Скрыто: 2');
  const before = JSON.stringify(runtime.snapshot().settings);
  query('.st-sable-hidden-toggle').click();
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Скрыть');
  assert.equal(query('.st-sable-hidden-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(JSON.stringify(runtime.snapshot().settings), before, 'reveal is transient');
  assert.deepEqual([...query('.st-sable-cards').children].map(el => el.dataset.section), runtime.snapshot().settings.order);
  assert.ok(card('world').classList.contains('st-sable-off'));
  assert.equal(card('world').querySelector('.st-sable-editor'), null);
  runtime.publish(); assert.ok(card('world'));
  card('world').querySelector('[data-control="mode"]').click();
  query('.st-sable-mode-option[data-mode="inject"]').click();
  assert.equal(document.activeElement, card('world').querySelector('[data-control="mode"]'));
  query('.st-sable-hidden-toggle').click();
  assert.ok(card('world')); assert.equal(card('threads'), null);
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Скрыто: 1');
  runtime.updateSettings({ language: 'en' });
  assert.equal(query('.st-sable-hidden-toggle').textContent, 'Hidden: 1');
  query('.st-sable-hidden-toggle').click(); assert.equal(query('.st-sable-hidden-toggle').textContent, 'Hide');
  runtime.setMode('threads', 'show'); assert.equal(query('.st-sable-hidden-row').hidden, true);
  runtime.setMode('threads', 'off'); runtime.updateSettings({ hideOff: false });
  assert.ok(card('threads')); assert.equal(query('.st-sable-hidden-row').hidden, true);
});

test('switching a card off from menu focuses reveal button and drag preserves hidden slots', t => {
  const { runtime, card, query, pointer, document, ui } = setup(t);
  ui.open();
  card('offscreen').querySelector('[data-control="mode"]').click();
  query('.st-sable-mode-option[data-mode="off"]').click();
  assert.equal(document.activeElement, query('.st-sable-hidden-toggle'));
  for (const [index, item] of [...query('.st-sable-cards').children].entries()) {
    item.getBoundingClientRect = () => ({ top: index * 100, height: 100 });
  }
  pointer(card('world').querySelector('.st-sable-handle'), 'pointerdown', 10, 25);
  pointer(document, 'pointermove', 10, 180);
  pointer(document, 'pointerup', 10, 180);
  assert.deepEqual(runtime.snapshot().settings.order.slice(0, 3), ['threads', 'offscreen', 'world']);
  pointer(card('world').querySelector('.st-sable-handle'), 'pointerdown', 10, 25);
  pointer(document, 'pointermove', 10, 2000);
  pointer(document, 'pointercancel', 10, 2000);
  assert.deepEqual([...query('.st-sable-cards').children].map(el => el.dataset.section), runtime.snapshot().settings.order.filter(id => id !== 'offscreen'));
  assert.equal(query('.st-sable-cards').textContent.includes('null'), false);
});

test('drawer shows running and skipped status, with refresh busy state and optional motion', async t => {
  const { runtime, fake, query, styled } = setup(t);
  let finish;
  fake.respond(() => new Promise(resolve => { finish = resolve; }));
  const running = runtime.refresh();
  const refresh = query('.st-sable-header .fa-rotate').parentElement;
  assert.equal(query('.st-sable-status-text').textContent, 'обновляется…');
  assert.ok(query('.st-sable-status-dot.st-sable-busy'));
  assert.equal(refresh.getAttribute('aria-busy'), 'true');
  assert.ok(refresh.querySelector('.fa-spin'));
  refresh.click(); assert.equal(fake.calls.requests.length, 1);
  runtime.updateSettings({ visual: { effects: 'off' } });
  assert.equal(refresh.querySelector('.fa-spin'), null);
  assert.equal(styled()(query('.st-sable-busy')).animation, 'none');
  finish('<sable_state>{"world":{"location":"Dome"}}</sable_state>'); await running;
  assert.equal(refresh.getAttribute('aria-busy'), 'false');
  assert.equal(query('.st-sable-busy'), null);
  fake.ctx.chatMetadata.sableTrackers.lastRun = { at: Date.now(), ok: true, skipped: true, ms: 999, inTok: 123 };
  runtime.publish();
  assert.match(query('.st-sable-status-text').textContent, / · готово · без запроса$/);
  assert.doesNotMatch(query('.st-sable-status-text').textContent, /999|123|токены|мс/);
  runtime.updateSettings({ language: 'en' });
  assert.match(query('.st-sable-status-text').textContent, / · ok · no request$/);
});

test('card colours scope accent and ink and clear on publish, including retained editors', t => {
  const { runtime, card } = setup(t);
  const check = (id, color) => {
    assert.equal(card(id).style.getPropertyValue('--st-sable-accent'), color ?? '');
    assert.equal(card(id).style.getPropertyValue('--st-sable-accent-ink-rgb'), color ? inkFor(color) : '');
    assert.equal(card(id).getAttribute('data-st-sable-tinted'), color ? '1' : null);
    assert.equal(card(id).style.color, '');
  };
  runtime.updateSettings({ visual: { cardColors: { world: '#abcdef' } } });
  check('world', '#abcdef'); check('threads');
  runtime.updateSettings({ visual: { cardColors: {} } }); runtime.publish(); check('world');
  card('world').querySelector('[data-control="edit"]').click();
  const retained = card('world');
  runtime.updateSettings({ visual: { cardColors: { world: '#123456' } } });
  assert.equal(card('world'), retained); check('world', '#123456');
  runtime.updateSettings({ visual: { cardColors: {} } }); runtime.publish();
  assert.equal(card('world'), retained); check('world');
});
