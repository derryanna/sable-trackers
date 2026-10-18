// Tests for the secrets card (SPEC §36, T37-ui).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDrawer } from '../src/ui/drawer.js';
import { createRuntime } from '../src/run.js';
import { forgetTruth, revealTruth } from '../src/secrets.js';
import { createFakeST } from './fakes/st.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/state-full.json', import.meta.url), 'utf8'));

function setup(t, state = structuredClone(fixture)) {
  const dom = new JSDOM(
    '<body><div id="extensions-settings-button"><button class="drawer-toggle"><span class="closedIcon"></span></button></div><div id="extensionsMenu"></div><textarea></textarea></body>',
    { pretendToBeVisual: true },
  );
  const fake = createFakeST(); fake.add();
  fake.ctx.chatMetadata.sableTrackers = {
    ring: [{ mesId: 0, swipeId: 0, turn: 14, state, stale: true }],
    lastRun: { at: 1234567890000, ok: true, ms: 250, inTok: 123, outTok: 45 },
  };
  const runtime = createRuntime(fake.getContext); runtime.start();
  const ui = createDrawer(runtime, { document: dom.window.document });
  t.after(() => { ui.dispose(); runtime.dispose(); dom.window.close(); });
  const document = dom.window.document;
  const query = sel => document.querySelector(sel);
  const card = id => query(`[data-section="${id}"]`);
  return { dom, document, fake, runtime, ui, query, card };
}

test('secrets card hidden when mode is off (default); count + paused hint appear in show mode', t => {
  const { runtime, card, query, ui } = setup(t);
  ui.open();
  // Default mode is off; hideOff=true → card not in DOM.
  assert.equal(card('secrets'), null, 'secrets card hidden when off');
  // Switch to 'show' → card appears.
  runtime.setMode('secrets', 'show');
  assert.ok(card('secrets'), 'card appears in show mode');
  const body = card('secrets').querySelector('.st-sable-card-body');
  assert.ok(body, 'card body present');
  // Count line: 1 live (T1), 1 revealed (T2).
  const countEl = body.querySelector('.st-sable-secrets-count');
  assert.ok(countEl, 'count element present');
  assert.ok(countEl.textContent.includes('1'), 'count shows some number');
  // Paused hint present in 'show' mode.
  const hints = [...body.querySelectorAll('p')].filter(p => p.classList.contains('st-sable-hint'));
  assert.ok(hints.length > 0, 'paused hint shown in show mode');
  assert.ok(hints[0].textContent.trim().length > 0, 'hint has text');
  // Switch to 'inject' → paused hint disappears.
  runtime.setMode('secrets', 'inject');
  assert.ok(card('secrets'), 'card visible in inject mode');
  const hintsAfter = [...card('secrets').querySelectorAll('p.st-sable-hint')];
  assert.equal(hintsAfter.length, 0, 'no paused hint in inject mode');
});

test('secrets card renders live truth with text, kv and clues; clue "not found" pill for unmatched clue', t => {
  const { runtime, card, ui } = setup(t);
  ui.open();
  runtime.setMode('secrets', 'inject');
  // Spoilers on by default: truths are in the spoiler list (but DOM is still present).
  const body = card('secrets').querySelector('.st-sable-card-body');
  // Past truths are inside a <details> element; live truths are not.
  const truths = [...body.querySelectorAll('.st-sable-truth')].filter(el => !el.closest('details'));
  assert.equal(truths.length, 1, '1 live truth from fixture (T1; T2 is past)');
  const t1 = truths[0];
  assert.ok(t1.querySelector('strong').textContent.includes("Maren cut"), 'truth text shown');
  // kv rows: hiddenFrom and when.
  const dts = [...t1.querySelectorAll('dt')];
  assert.ok(dts.length >= 2, 'hiddenFrom and when dt rows present');
  // 2 clues from T1.
  const items = t1.querySelectorAll('li');
  assert.equal(items.length, 2, '2 clues listed');
  // Second clue (found=false) has the not-found pill.
  const notFound = t1.querySelector('.st-sable-missing');
  assert.ok(notFound, 'not-found pill for the unfound clue');
  assert.ok(notFound.textContent.trim().length > 0);
});

test('secrets card has a pencil button per live truth with reveal / forget / edit options', t => {
  const { runtime, card, query, ui } = setup(t);
  ui.open();
  runtime.setMode('secrets', 'inject');
  const t1 = card('secrets').querySelector('.st-sable-truth');
  assert.ok(t1, 'truth element found');
  const pencil = t1.querySelector('[data-control="truth-menu"]');
  assert.ok(pencil, 'pencil button present');
  assert.equal(pencil.getAttribute('aria-haspopup'), 'menu');
  pencil.click();
  // Menu options use data-mode attribute (same as the mode menu pattern).
  const opts = [...(query('.st-sable-mode-menu')?.querySelectorAll('[data-mode]') ?? [])];
  const texts = opts.map(o => o.textContent.trim());
  assert.ok(texts.some(s => /reveal|раскрыть/i.test(s)), 'reveal option');
  assert.ok(texts.some(s => /forget|забыть/i.test(s)), 'forget option');
  assert.ok(texts.some(s => /edit|редакт/i.test(s)), 'edit option');
});

test('forget calls editState with forgetTruth result and undo pill appears', t => {
  const { runtime, card, query, ui } = setup(t);
  ui.open();
  runtime.setMode('secrets', 'inject');
  const calls = [], original = runtime.editState;
  runtime.editState = (...args) => { calls.push(structuredClone(args)); return original(...args); };
  const secrets = runtime.snapshot().entry.state.secrets;
  card('secrets').querySelector('[data-control="truth-menu"]').click();
  const forgetOpt = [...(query('.st-sable-mode-menu')?.querySelectorAll('[data-mode]') ?? [])].find(o => /forget|забыть/i.test(o.textContent));
  assert.ok(forgetOpt, 'forget option');
  forgetOpt.click();
  const expected = forgetTruth(secrets, 'T1');
  assert.equal(calls.length, 1, 'editState called once');
  assert.equal(calls[0][0], 'secrets');
  assert.deepEqual(calls[0][1], expected);
  // Undo pill appears somewhere in the drawer.
  const pill = query('.st-sable-undo-pill') ?? query('[data-control="undo"]');
  assert.ok(pill, 'undo pill shown');
});

test('reveal calls editState with revealTruth result', t => {
  const { runtime, card, query, ui } = setup(t);
  ui.open();
  runtime.setMode('secrets', 'inject');
  const calls = [], original = runtime.editState;
  runtime.editState = (...args) => { calls.push(structuredClone(args)); return original(...args); };
  const secrets = runtime.snapshot().entry.state.secrets;
  const mesId = runtime.snapshot().entry.mesId;
  card('secrets').querySelector('[data-control="truth-menu"]').click();
  const revealOpt = [...(query('.st-sable-mode-menu')?.querySelectorAll('[data-mode]') ?? [])].find(o => /reveal|раскрыть/i.test(o.textContent));
  assert.ok(revealOpt, 'reveal option');
  revealOpt.click();
  const expected = revealTruth(secrets, 'T1', mesId);
  assert.equal(calls.length, 1, 'editState called once');
  assert.equal(calls[0][0], 'secrets');
  assert.deepEqual(calls[0][1], expected);
});

test('edit option opens inline form; save calls editState with updated text; cancel removes form', t => {
  const { dom, runtime, card, query, ui } = setup(t);
  ui.open();
  runtime.setMode('secrets', 'inject');
  const calls = [], original = runtime.editState;
  runtime.editState = (...args) => { calls.push(structuredClone(args)); return original(...args); };
  card('secrets').querySelector('[data-control="truth-menu"]').click();
  const editOpt = [...(query('.st-sable-mode-menu')?.querySelectorAll('[data-mode]') ?? [])].find(o => /edit|редакт/i.test(o.textContent));
  assert.ok(editOpt, 'edit option');
  editOpt.click();
  const form = card('secrets').querySelector('.st-sable-truth-form');
  assert.ok(form, 'truth edit form rendered');
  const textInput = form.querySelector('textarea[name="text"], input[name="text"]');
  assert.ok(textInput, 'text field present');
  assert.ok(textInput.value.includes('Maren cut'), 'form shows existing text');
  // Change text and save.
  textInput.value = 'Maren cut it deliberately';
  textInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  form.querySelector('[data-control="truth-form-save"]').click();
  assert.equal(calls.length, 1, 'editState called on save');
  assert.equal(calls[0][0], 'secrets');
  const saved = calls[0][1].truths.find(t => t.id === 'T1');
  assert.ok(saved, 'T1 in result');
  assert.equal(saved.text, 'Maren cut it deliberately', 'edited text in result');
  assert.equal(card('secrets').querySelector('.st-sable-truth-form'), null, 'form removed after save');
  // Cancel reopens and dismisses.
  card('secrets').querySelector('[data-control="truth-menu"]').click();
  [...(query('.st-sable-mode-menu')?.querySelectorAll('[data-mode]') ?? [])].find(o => /edit|редакт/i.test(o.textContent))?.click();
  assert.ok(card('secrets').querySelector('.st-sable-truth-form'), 'form reopens');
  card('secrets').querySelector('[data-control="truth-form-cancel"]').click();
  assert.equal(card('secrets').querySelector('.st-sable-truth-form'), null, 'form gone after cancel');
});

test('past truths appear in a collapsible «Revealed» block with a restore button', t => {
  const { runtime, card, ui } = setup(t);
  ui.open();
  runtime.setMode('secrets', 'inject');
  const body = card('secrets').querySelector('.st-sable-card-body');
  // Count includes the revealed truth.
  const countEl = body.querySelector('.st-sable-secrets-count');
  assert.ok(countEl, 'count element present');
  // Collapsible past block (a details element).
  const pastDetails = [...body.querySelectorAll('details')].find(d => d.textContent.includes('Revealed') || d.textContent.includes('Отыграно'));
  assert.ok(pastDetails, 'past truths details block present');
  assert.ok(pastDetails.textContent.includes('the chapel key opens the lamp room'), 'past truth text shown');
  // Restore button inside past block.
  const restore = pastDetails.querySelector('[data-control="secrets-restore"]');
  assert.ok(restore, 'restore button present in past block');
});

test('spoiler toggle hides and reveals live truths', t => {
  const { runtime, card, ui } = setup(t);
  ui.open();
  runtime.setMode('secrets', 'inject');
  // Spoilers on by default: truths list is hidden.
  assert.equal(runtime.snapshot().settings.spoilers, true);
  const spoilerList = card('secrets').querySelector('.st-sable-truth-list');
  assert.ok(spoilerList, 'spoiler truth list container present');
  assert.equal(spoilerList.hidden, true, 'truths hidden initially');
  // Spoiler toggle button.
  const toggle = card('secrets').querySelector('[data-control="spoiler"]');
  assert.ok(toggle, 'spoiler toggle button');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  assert.equal(card('secrets').querySelector('.st-sable-truth-list').hidden, false, 'truths shown after toggle');
  assert.equal(card('secrets').querySelector('[data-control="spoiler"]').getAttribute('aria-expanded'), 'true');
  // Toggle again → hidden.
  card('secrets').querySelector('[data-control="spoiler"]').click();
  assert.equal(card('secrets').querySelector('.st-sable-truth-list').hidden, true, 'truths hidden again');
});
