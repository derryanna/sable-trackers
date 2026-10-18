import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SECRETS_TAG, LIVE_CAP, emptySecrets, isLive, liveTruths, pastTruths,
  cutSecrets, parseSecretsBlock, applySecrets, clueFound,
  editTruth, revealTruth, forgetTruth, restoreTruth,
} from '../src/secrets.js';
import { sanitizeSection } from '../src/parse.js';
import { getSection } from '../src/sections.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Lighthouse-keeper story: live truth with two clues, one not found. */
function makeTruth(overrides = {}) {
  return {
    id: 'T1', text: 'Maren knows who cut the rope',
    hiddenFrom: ['Tomas'], when: 'when Tomas returns', changes: 'shifts the suspicion',
    clues: [
      { text: 'the frayed rope end', mesId: 2, found: true },
      { text: 'the missing knife', mesId: 3, found: false },
    ],
    createdMesId: 1, revealedMesId: null,
    ...overrides,
  };
}

function makeLiveSecrets(n = 1) {
  const truths = [];
  for (let i = 0; i < n; i++) {
    truths.push(makeTruth({ id: `T${i + 1}`, text: `Secret ${i + 1}`, hiddenFrom: ['Tomas'] }));
  }
  return { next: n + 1, truths };
}

// ─── exports and constants ───────────────────────────────────────────────────

test('exported constants', () => {
  assert.equal(SECRETS_TAG, 'sable_secrets');
  assert.equal(LIVE_CAP, 3);
  assert.deepEqual(emptySecrets(), { next: 1, truths: [] });
});

test('isLive, liveTruths, pastTruths', () => {
  const live = makeTruth();
  const revealed = makeTruth({ revealedHow: 'out', revealedMesId: 5 });
  assert.equal(isLive(live), true);
  assert.equal(isLive(revealed), false);
  assert.equal(isLive(null), false);
  const secrets = { next: 3, truths: [live, revealed] };
  assert.deepEqual(liveTruths(secrets), [live]);
  assert.deepEqual(pastTruths(secrets), [revealed]);
  assert.deepEqual(liveTruths({}), []);
  assert.deepEqual(pastTruths(null), []);
});

// ─── cutSecrets ──────────────────────────────────────────────────────────────

test('cutSecrets: closed block', () => {
  const input = 'Maren found the logbook.\n<sable_secrets>\n+ T1: rope | hidden from: Tomas\n</sable_secrets>\nEnd.';
  const { text, block } = cutSecrets(input);
  // The \n before and after the tag are kept; only runs of 3+ newlines collapse.
  assert.equal(text, 'Maren found the logbook.\n\nEnd.');
  assert.equal(block, '+ T1: rope | hidden from: Tomas');
});

test('cutSecrets: unclosed tail', () => {
  const input = 'Tomas arrived.\n<sable_secrets>\nout T1';
  const { text, block } = cutSecrets(input);
  assert.equal(text, 'Tomas arrived.');
  assert.equal(block, 'out T1');
});

test('cutSecrets: two blocks joined', () => {
  const input = 'A<sable_secrets>line1</sable_secrets>B<sable_secrets>line2</sable_secrets>C';
  const { text, block } = cutSecrets(input);
  assert.equal(text, 'ABC');
  assert.equal(block, 'line1\nline2');
});

test('cutSecrets: block mid-text, prose byte-identical before the block', () => {
  const prose = 'The lighthouse beam swept the bay.';
  const input = prose + '\n<sable_secrets>clue T1: the beam</sable_secrets>';
  const { text, block } = cutSecrets(input);
  assert.equal(text, prose);
  assert.equal(block, 'clue T1: the beam');
});

test('cutSecrets: idempotent', () => {
  const input = 'Text.<sable_secrets>op</sable_secrets>';
  const first = cutSecrets(input);
  assert.equal(cutSecrets(first.text).block, '');
});

test('cutSecrets: non-string input', () => {
  assert.deepEqual(cutSecrets(42), { text: 42, block: '' });
  assert.deepEqual(cutSecrets(null), { text: null, block: '' });
});

// ─── parseSecretsBlock ───────────────────────────────────────────────────────

test('parse: English markers', () => {
  const { ops, notes } = parseSecretsBlock([
    '+ T1: Maren hid the letter | hidden from: Tomas | comes out when: he finds the chest | changes: breaks their trust',
    'clue T1: the locked chest',
    'learned T1: Maren',
    'out T1',
  ].join('\n'));
  assert.equal(ops.length, 4);
  assert.equal(ops[0].op, 'new');
  assert.equal(ops[0].ref, 'T1');
  assert.equal(ops[0].text, 'Maren hid the letter');
  assert.deepEqual(ops[0].hiddenFrom, ['Tomas']);
  assert.equal(ops[0].when, 'he finds the chest');
  assert.equal(ops[0].changes, 'breaks their trust');
  assert.equal(ops[1].op, 'clue'); assert.equal(ops[1].ref, 'T1'); assert.equal(ops[1].text, 'the locked chest');
  assert.equal(ops[2].op, 'learned'); assert.equal(ops[2].ref, 'T1');
  assert.equal(ops[3].op, 'out'); assert.equal(ops[3].ref, 'T1');
  assert.equal(notes.length, 0);
});

test('parse: Russian markers', () => {
  const { ops, notes } = parseSecretsBlock([
    'новая T2: Томас боится темноты | скрыто от: Марен | выйдет: когда погаснет лампа | меняет: он убегает',
    'подсказка T2: дрожащие руки',
    'узнала T2: Марен',
    'вышла T2',
  ].join('\n'));
  assert.equal(ops.length, 4);
  assert.equal(ops[0].op, 'new'); assert.equal(ops[0].ref, 'T2');
  assert.equal(ops[0].text, 'Томас боится темноты');
  assert.deepEqual(ops[0].hiddenFrom, ['Марен']);
  assert.equal(ops[0].when, 'когда погаснет лампа');
  assert.equal(ops[0].changes, 'он убегает');
  assert.equal(ops[1].op, 'clue'); assert.equal(ops[1].ref, 'T2');
  assert.equal(ops[2].op, 'learned'); assert.equal(ops[2].ref, 'T2');
  assert.equal(ops[3].op, 'out'); assert.equal(ops[3].ref, 'T2');
  assert.equal(notes.length, 0);
});

test('parse: bullets, bold markers, stray spaces', () => {
  const block = [
    '- + T3: Tomas planted the evidence | hidden from: Maren',
    '** clue T3: the ink stains',
    '1. learned T3: Maren',
    '• out T3',
  ].join('\n');
  const { ops } = parseSecretsBlock(block);
  assert.equal(ops.length, 4);
  assert.equal(ops[0].op, 'new'); assert.equal(ops[0].ref, 'T3');
  assert.equal(ops[1].op, 'clue'); assert.equal(ops[1].ref, 'T3');
  assert.equal(ops[2].op, 'learned'); assert.equal(ops[2].ref, 'T3');
  assert.equal(ops[3].op, 'out'); assert.equal(ops[3].ref, 'T3');
});

test('parse: copied <sable_secrets> remnant → note; empty lines skipped', () => {
  const { ops, notes } = parseSecretsBlock('<sable_secrets>\n\n+ T1: secret | hidden from: Tomas\n');
  assert.equal(ops.length, 1);
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes('sable_secrets'));
});

test('parse: tolerant T<n> ids', () => {
  const { ops } = parseSecretsBlock([
    'clue **T3**: the brass key',
    'out t 4',
    'learned T#5: Maren',
  ].join('\n'));
  assert.equal(ops[0].ref, 'T3');
  assert.equal(ops[1].ref, 'T4');
  assert.equal(ops[2].ref, 'T5');
});

test('parse: узнали variant', () => {
  const { ops } = parseSecretsBlock('узнали T1: Tomas and Maren');
  assert.equal(ops[0].op, 'learned');
  assert.deepEqual(ops[0].names, ['Tomas', 'Maren']);
});

test('parse: раскрыта variant', () => {
  const { ops } = parseSecretsBlock('раскрыта T1');
  assert.equal(ops[0].op, 'out');
});

// ─── applySecrets ────────────────────────────────────────────────────────────

test('applySecrets: basic new truth', () => {
  const ops = parseSecretsBlock('+ T1: Maren hid the logbook page | hidden from: Tomas').ops;
  const { secrets, notes } = applySecrets(null, ops, { mesId: 1 });
  assert.equal(secrets.truths.length, 1);
  assert.equal(secrets.truths[0].id, 'T1');
  assert.equal(secrets.truths[0].text, 'Maren hid the logbook page');
  assert.deepEqual(secrets.truths[0].hiddenFrom, ['Tomas']);
  assert.equal(secrets.truths[0].createdMesId, 1);
  assert.equal(secrets.truths[0].revealedMesId, null);
  assert.equal('revealedHow' in secrets.truths[0], false);
  assert.equal(secrets.next, 2);
  assert.equal(notes.length, 0);
});

test('applySecrets: new truth with no hiddenFrom → note', () => {
  const ops = parseSecretsBlock('+ T1: secret | hidden from:').ops;
  const { secrets, notes } = applySecrets(null, ops, { mesId: 1 });
  assert.equal(secrets.truths.length, 0);
  assert.ok(notes.some(n => n.includes('hidden from no one')));
});

test('applySecrets: LIVE_CAP enforced', () => {
  const previous = makeLiveSecrets(LIVE_CAP);
  const ops = parseSecretsBlock('+ T99: another secret | hidden from: Maren').ops;
  const { secrets, notes } = applySecrets(previous, ops, { mesId: 10 });
  assert.equal(liveTruths(secrets).length, LIVE_CAP);
  assert.ok(notes.some(n => n.includes('are already live')));
});

test('applySecrets: same-text dedup maps ref, no note', () => {
  const previous = { next: 2, truths: [makeTruth({ id: 'T1', text: 'Maren knows who cut the rope' })] };
  const ops = parseSecretsBlock('+ T9: Maren knows who cut the rope | hidden from: Tomas\nclue T9: the knife').ops;
  const { secrets, notes } = applySecrets(previous, ops, { mesId: 5 });
  assert.equal(secrets.truths.length, 1); // no new truth added
  assert.equal(notes.length, 0);
  // clue T9 resolved to T1
  assert.equal(secrets.truths[0].clues.length, 3); // two original + one new
});

test('applySecrets: ref equals existing truth id → mapped, no note (coordinator §1)', () => {
  const previous = { next: 2, truths: [makeTruth({ id: 'T1', text: 'Maren hid the letter' })] };
  const ops = parseSecretsBlock('+ T1: New text for T1 | hidden from: Tomas\nclue T1: a clue').ops;
  const { secrets, notes } = applySecrets(previous, ops, { mesId: 5, prose: 'Maren found a clue near the dock.' });
  assert.equal(secrets.truths.length, 1); // T1 already exists, not duplicated
  assert.equal(notes.length, 0);
  assert.equal(secrets.truths[0].clues.length, 3); // original 2 + 1 new clue via T1 ref
});

test('applySecrets: placeholder mapping (+ T9 → T1, clue T9 applies to T1)', () => {
  const ops = parseSecretsBlock([
    '+ T9: Maren fears the sea | hidden from: Tomas',
    'clue T9: she avoids the shore',
  ].join('\n')).ops;
  const { secrets } = applySecrets(null, ops, { mesId: 3, prose: 'she avoids the shore and the water' });
  assert.equal(secrets.truths[0].id, 'T1');
  assert.equal(secrets.truths[0].clues.length, 1);
  assert.equal(secrets.truths[0].clues[0].text, 'she avoids the shore');
});

test('applySecrets: first wins (clue/learned/out)', () => {
  const ops = parseSecretsBlock([
    '+ T1: Maren hid the key | hidden from: Tomas',
    'clue T1: first clue',
    'clue T1: second clue (ignored)',
  ].join('\n')).ops;
  const { secrets } = applySecrets(null, ops, { mesId: 4 });
  assert.equal(secrets.truths[0].clues.length, 1);
  assert.equal(secrets.truths[0].clues[0].text, 'first clue');
});

test('applySecrets: learned removes names, reveals when empty', () => {
  const previous = { next: 2, truths: [makeTruth({ id: 'T1', hiddenFrom: ['Tomas', 'Maren'] })] };
  const ops1 = parseSecretsBlock('learned T1: Tomas').ops;
  const { secrets: s1, notes: n1 } = applySecrets(previous, ops1, { mesId: 10 });
  assert.deepEqual(s1.truths[0].hiddenFrom, ['Maren']);
  assert.equal(isLive(s1.truths[0]), true); // still live
  assert.equal(n1.length, 0);

  const ops2 = parseSecretsBlock('learned T1: Maren').ops;
  const { secrets: s2 } = applySecrets(s1, ops2, { mesId: 11 });
  assert.equal(s2.truths[0].revealedHow, 'learned');
  assert.equal(s2.truths[0].revealedMesId, 11);
  assert.equal(isLive(s2.truths[0]), false);
});

test('applySecrets: unknown name in learned → note', () => {
  const previous = { next: 2, truths: [makeTruth({ id: 'T1', hiddenFrom: ['Tomas'] })] };
  const ops = parseSecretsBlock('learned T1: Maren').ops;
  const { notes } = applySecrets(previous, ops, { mesId: 7 });
  assert.ok(notes.some(n => n.includes('Maren') && n.includes('not on its hidden-from list')));
});

test('applySecrets: op on unknown ref → note', () => {
  const { notes } = applySecrets(null, parseSecretsBlock('clue T99: a clue').ops, { mesId: 1 });
  assert.ok(notes.some(n => n.includes('T99') && n.includes('unknown')));
});

test('applySecrets: op on already-revealed truth → note', () => {
  const previous = { next: 2, truths: [makeTruth({ id: 'T1', revealedHow: 'out', revealedMesId: 5 })] };
  const ops = parseSecretsBlock('clue T1: after the reveal').ops;
  const { notes } = applySecrets(previous, ops, { mesId: 6 });
  assert.ok(notes.some(n => n.includes('T1') && n.includes('already revealed')));
});

test('applySecrets: out sets revealedHow=out', () => {
  const previous = { next: 2, truths: [makeTruth({ id: 'T1', hiddenFrom: ['Tomas'] })] };
  const ops = parseSecretsBlock('out T1').ops;
  const { secrets } = applySecrets(previous, ops, { mesId: 8 });
  assert.equal(secrets.truths[0].revealedHow, 'out');
  assert.equal(secrets.truths[0].revealedMesId, 8);
});

test('applySecrets: applied dedupe prevents re-application', () => {
  const block = '+ T1: Maren hid the journal | hidden from: Tomas\nclue T1: ink stains';
  const ops = parseSecretsBlock(block).ops;
  const first = applySecrets(null, ops, { mesId: 1 });
  assert.equal(first.secrets.truths.length, 1);

  // Second call with same ops and applied list from first: nothing new
  const second = applySecrets(first.secrets, ops, { mesId: 2, applied: first.applied });
  assert.equal(second.secrets.truths.length, 1);
  assert.equal(second.secrets.truths[0].clues.length, 1); // no duplicate clue
  assert.deepEqual(second.notes, []);
});

test('applySecrets: pure — does not mutate previous', () => {
  const previous = emptySecrets();
  const ops = parseSecretsBlock('+ T1: test | hidden from: Tomas').ops;
  applySecrets(previous, ops, { mesId: 1 });
  assert.deepEqual(previous, emptySecrets());
});

test('applySecrets: learned name match by 5-letter prefix', () => {
  const previous = { next: 2, truths: [makeTruth({ id: 'T1', hiddenFrom: ['Томас'] })] };
  const ops = parseSecretsBlock('learned T1: Томасе').ops; // inflected form
  const { secrets, notes } = applySecrets(previous, ops, { mesId: 5 });
  // First words: Томас / Томасе → both 5+ chars, first 5 chars = Томас = Томас → match
  assert.deepEqual(secrets.truths[0].hiddenFrom, []);
  assert.equal(notes.filter(n => n.includes('not on its hidden-from list')).length, 0);
});

// ─── clueFound ───────────────────────────────────────────────────────────────

test('clueFound: found by exact word', () => {
  assert.equal(clueFound('the brass key', 'Maren took the brass key from the chest'), true);
});

test('clueFound: short word exact prefix — ключ/ключа → one-word true', () => {
  // ключ(4 chars) shares 4/4=100% with ключа(5) on shorter, so prefix rule applies.
  assert.equal(clueFound('ключ', 'Марен держала ключа в руке'), true);
});

test('clueFound: ржавый/ржавого — shares 4 of 6 (67 %) < 80 % of shorter → false; two-word clue needs both', () => {
  // ржавый(6)/ржавого(7): shared 4 chars, 4/min(6,7)=67% < 80% → no prefix match.
  // "ржавый ключ" has 2 clue tokens; only ключ matches ключа → 1/2 → false.
  assert.equal(clueFound('ржавый ключ', 'Марен держала ржавого ключа в руке'), false);
});

test('clueFound: серебряного/серебряный → true (coordinator example)', () => {
  assert.equal(clueFound('серебряного ключа', 'серебряный ключ лежал на столе'), true);
});

test('clueFound: охранник vs охранный → false (coordinator example)', () => {
  assert.equal(clueFound('охранник', 'охранный пост'), false);
});

test('clueFound: one-word clue matches → true', () => {
  assert.equal(clueFound('lighthouse', 'Tomas walked toward the lighthouse at dusk'), true);
});

test('clueFound: two-word clue, only one matches → false (coordinator)', () => {
  assert.equal(clueFound('brass lantern', 'Maren set down the brass object'), false);
});

test('clueFound: empty prose → false', () => {
  assert.equal(clueFound('the frayed rope', ''), false);
});

test('clueFound: stop words and short words ignored', () => {
  // Only stop/short words in clue → no content tokens → false
  assert.equal(clueFound('this that with', 'some unrelated prose'), false);
});

test('clueFound: stop words Russian → false', () => {
  assert.equal(clueFound('когда если', 'Марен пришла к маяку вечером'), false);
});

// ─── user ops ────────────────────────────────────────────────────────────────

test('editTruth: updates fields', () => {
  const secrets = { next: 2, truths: [makeTruth({ id: 'T1' })] };
  const next = editTruth(secrets, 'T1', { text: 'Updated secret', when: 'at dawn' });
  assert.equal(next.truths[0].text, 'Updated secret');
  assert.equal(next.truths[0].when, 'at dawn');
  assert.equal(secrets.truths[0].text, 'Maren knows who cut the rope'); // not mutated
});

test('editTruth: unknown id → null', () => {
  assert.equal(editTruth(emptySecrets(), 'T99', { text: 'x' }), null);
});

test('editTruth: emptying hiddenFrom on live truth → revealedHow=user, revealedMesId stays null', () => {
  const secrets = { next: 2, truths: [makeTruth({ id: 'T1', hiddenFrom: ['Tomas'] })] };
  const next = editTruth(secrets, 'T1', { hiddenFrom: [] });
  assert.equal(next.truths[0].revealedHow, 'user');
  assert.equal(next.truths[0].revealedMesId, null);
});

test('revealTruth: sets revealedHow=user and mesId', () => {
  const secrets = { next: 2, truths: [makeTruth({ id: 'T1' })] };
  const next = revealTruth(secrets, 'T1', 12);
  assert.equal(next.truths[0].revealedHow, 'user');
  assert.equal(next.truths[0].revealedMesId, 12);
});

test('revealTruth: unknown id → null', () => {
  assert.equal(revealTruth(emptySecrets(), 'T1', 1), null);
});

test('forgetTruth: removes the truth', () => {
  const secrets = { next: 3, truths: [makeTruth({ id: 'T1' }), makeTruth({ id: 'T2' })] };
  const next = forgetTruth(secrets, 'T1');
  assert.equal(next.truths.length, 1);
  assert.equal(next.truths[0].id, 'T2');
  assert.equal(secrets.truths.length, 2); // not mutated
});

test('forgetTruth: unknown id → null', () => {
  assert.equal(forgetTruth(emptySecrets(), 'T1'), null);
});

test('restoreTruth: restores a past truth', () => {
  const secrets = { next: 2, truths: [makeTruth({ id: 'T1', revealedHow: 'out', revealedMesId: 5 })] };
  const next = restoreTruth(secrets, 'T1');
  assert.equal(isLive(next.truths[0]), true);
  assert.equal('revealedHow' in next.truths[0], false);
  assert.equal(next.truths[0].revealedMesId, null);
});

test('restoreTruth: unknown id → null', () => {
  assert.equal(restoreTruth(emptySecrets(), 'T1'), null);
});

test('restoreTruth: already live → null', () => {
  const secrets = { next: 2, truths: [makeTruth({ id: 'T1' })] };
  assert.equal(restoreTruth(secrets, 'T1'), null);
});

test('restoreTruth: refused when LIVE_CAP live truths', () => {
  const truths = Array.from({ length: LIVE_CAP }, (_, i) => makeTruth({ id: `T${i + 1}` }));
  truths.push(makeTruth({ id: `T${LIVE_CAP + 1}`, revealedHow: 'out', revealedMesId: 5 }));
  const secrets = { next: LIVE_CAP + 2, truths };
  assert.equal(restoreTruth(secrets, `T${LIVE_CAP + 1}`), null);
});

// ─── schema compatibility ─────────────────────────────────────────────────────

test('sanitizeSection roundtrip: applySecrets output survives the schema', () => {
  const block = [
    '+ T1: Maren knows the harbour master | hidden from: Tomas | comes out when: the ship arrives | changes: Tomas leaves',
    'clue T1: a letter in her coat',
    '+ T2: Tomas carries guilt about the lamp | hidden from: Maren',
  ].join('\n');
  const ops = parseSecretsBlock(block).ops;
  const { secrets } = applySecrets(null, ops, { mesId: 1, prose: 'Maren tucked a letter into her coat.' });

  const section = getSection('secrets');
  const sanitized = sanitizeSection(section, secrets);
  assert.deepEqual(sanitized, secrets,
    'sanitizeSection should return a deep-equal object; if it drops fields, report it rather than changing the schema');
});

test('sanitizeSection roundtrip: with revealed truth', () => {
  const secrets = {
    next: 3,
    truths: [
      makeTruth({ id: 'T1' }),
      makeTruth({ id: 'T2', revealedHow: 'learned', revealedMesId: 7 }),
    ],
  };
  const section = getSection('secrets');
  const sanitized = sanitizeSection(section, secrets);
  assert.deepEqual(sanitized, secrets);
});
