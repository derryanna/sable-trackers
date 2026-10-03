# Tasks

One task = one PR. Tick the box when merged-ready. Keep notes short.
Each task must leave `npm test` green.

## T1 — Pure core  [x]
`src/sections.js`, `src/clean.js`, `src/prompt.js`, `src/parse.js`,
`src/merge.js`, `src/digest.js`, `src/i18n.js` (labels used by these), plus
`package.json` scripts and tests. No browser globals.
Done when:
- the prompt builder includes only enabled + due sections; dossiers get names only; the
  cleaner strips plan/think/checklist/Blocks/details/HTML (also unclosed);
- the parser survives `fixtures/side-output-messy.txt` and rejects garbage without throwing;
- merge keeps skipped/invalid sections, recomputes bond deltas, keeps dossiers
  append-only and caps the banlist at 8;
- the digest output for `fixtures/state-full.json` in inject/show mixes matches
  a snapshot test; it stays under 6000 chars.

## T2 — Glue: settings, store, run, injection  [x]
`src/settings.js`, `src/store.js`, `src/run.js`, `index.js` (wiring only),
`test/fakes/st.mjs`. Event handling per SPEC §3–§5, AbortController,
per-message debounce, swipe/delete/edit rules, WORLD_INFO_ACTIVATED capture,
`setExtensionPrompt` on every state change and CHAT_CHANGED.
Done when fake-driven tests cover: reply → request built → fake response → ring
updated → injection text set; swipe → base state used; delete → ring pruned;
no profile set → no request plus a single warning.

## T3 — Drawer UI  [x]
`src/ui/drawer.js`, `style.css`, the floating button and the wand-menu entry. Section
cards with drag reorder, fold, mode chip (cycles inject→show→off), header
buttons (refresh, pin, settings, close), status line. See SPEC §6 and
`docs/drawer-reference.jpg` for the look (dark glass, rounded cards, white
left accent bar). Escaping is mandatory.
Done when: jsdom test renders `fixtures/state-full.json` with all sections,
toggling a chip changes settings and the digest, and an XSS string in a fixture
field shows up as text.

## T4 — Panel under the last reply + legacy seeding  [x]
`src/ui/panel.js` (SPEC §7) and the legacy seed (SPEC §9) using
`docs/LEGACY-SABLE-RENDER.md` and `fixtures/legacy-message.json`.
Done when: the panel moves to the newest character message on each render and
never touches `mes`/`extra`; seeding maps the legacy fixture into ring[0].

## T5 — Settings panel + README  [x]
`src/ui/settings.js` (+ `settings.html` if you prefer), all SPEC §8 fields,
connection-profile select filled from `connectionManager.profiles`, and
README install/usage for a stranger (English + short Russian section).

## T7 — custom sections [x]
Custom registry, shape validation, replacement merge, digest, settings normalization,
runtime cadence/modes, and safe drawer cards implemented with fixture and regression tests.
Settings-tab editor is intentionally excluded; `src/ui/settings.js` is untouched.
Editor integration: save `customSections` through `runtime.updateSettings`; item `mode`
and `period` are authoritative. `runtime.setMode` also supports custom ids and chat overrides.
Unknown settings keys (including `visual`) survive normalization. Removed definitions
disappear from prompts/drawer/digest while historical state values remain in the ring.
Validation: all 55 tests pass, changed JavaScript syntax checks pass. No commit requested.

## Round 3 — drawer behaviour [x]
Mode menu with keyboard support, header folding, hideOff with transient reveal, and ordered built-in/custom settings rows with move buttons. README updated in English and Russian. Appearance-owned code untouched. Working-tree delivery only; no commit. Validation: 80 tests and changed JavaScript syntax checks pass; physical phone layout remains unverified.

## Round 4a — in-flight request robustness [x]
Cosmetic settings and modes preserve requests; refresh shares active work and forces all enabled sections due. Requests survive metadata replacement, report discarded/skipped results, and publish busy status with motion controls. MESSAGE_RECEIVED no longer blocks listeners; runtime.idle() supports explicit waits. Validation: 101 tests and changed JavaScript syntax checks pass. Live SillyTavern/Android verification remains manual. Working-tree delivery only; no commit.

## Round 4b — per-card colours [x]
Normalized per-card colours, preset preservation and theme round-trips; ordered built-in/custom colour controls with auto reset and live preview; scoped drawer accents and borders, including retained editors. English/Russian labels and README updated. Validation: 106 tests pass and changed JavaScript syntax checks pass. Live Android layout remains unverified. Working-tree delivery only; no commit.

## Round 5 — danger zone [x]
Editable built-in prompt instructions with normalized partial overrides and resets; shared request preparation for exact Run now previews; runtime-only five-entry request log retaining raw invalid and dropped responses. Closed settings group includes safe text dumps, copy/select fallback, JSON download and clear, with English/Russian labels and documentation. Validation: 115 tests pass, all changed JavaScript syntax checks and diff whitespace checks pass. Live SillyTavern/Android layout and native clipboard permissions remain unverified. Working-tree delivery only; no commit.

## T8a — Packs core (pure)  [x]
Shipped full provisional combat/intimacy definitions, user-pack IO, stats/tags, scope-aware prompts, global settings, per-chat runtime toggles and local dice; covered by pure and fake-runtime tests.
SPEC §15 without UI. `src/packs/` with the pack registry (`getPacks(settings)` =
built-ins + user packs), `normalizePacks`, `src/packs/io.js` (export/import of
`sable-pack.json`), `getSections(settings, enabledPacks)`, the `stats` and `tags`
shapes in sanitize/merge/digest (stats `delta` computed on merge), pack `rules` in
the prompt builder, `chat_metadata.sableTrackers.packs` and `settings.packDefaults`
in store/settings, `runtime.setPack(id, on)` and `snapshot().packs`. `roll(chance, random)`.
Built-in packs may be stubs here (one section each) if the content task comes later.
Done when: tests cover shapes, delta, digest lines, pack rules appended once, pack off →
nothing requested/injected, import of a colliding user id, refusal of built-in ids.

## T8b — Packs UI  [x]
Done: header pack button + sheet with per-chat switches and scope toggle, stats/tags cards, dice on "%" rows, status chips, Packs settings group (defaults, copy, export/import, user-pack editor, Danger zone pack rules); 142 tests.
Drawer: 🎒 header button + packs sheet with ≥ 36 px switches; `stats` renderer (bars via the
bond bar markup, counters as numbers, delta badges with `note`), `tags` renderer (chips),
dice button on `%` rows writing `<pack>_roll` through `runtime.editState`. Settings: "Packs"
group (list, default-for-new-chats, export/import, user-pack editor reusing the custom-block
editor). i18n ru/en. Done when: jsdom test toggles a pack on → cards appear, XSS in a stat key
stays text, a roll writes the roll line and the digest contains it. The Packs settings group follows §17 (collapsible).

## T8c — Built-in pack content  [x]
`combat` and `intimacy` per SPEC §15 (sections, instructions, rules, i18n titles), fixtures
with synthetic states, digest snapshot tests, README section (en + ru). Instructions reuse the
canon-safe rules; the intimacy pack keeps the adults-only guard. No real RP content in fixtures.

## T9 — Live cards  [x]
Done: `visual.effects` level with `motion` migration, composable `visual.fx` (glow, shimmer, rain, ticks, value colour, dice, card glow), keyed persistent bond/stat rows with sliding bars, change flags and title dots, note on tap, pack lines in the reply panel, Effects settings sub-block; 157 tests.
SPEC §16: `visual.effects` level (off/subtle/full) replacing the `motion` boolean with migration,
keyed reconcile of bond/stat rows, `scaleX` bar transition, change flash and title dot, note tap
on stat rows, pack line in the reply panel; `full` adds number ticks, value-coloured bars, dice
animation and card glow. Everything gated by the level and reduced-motion. Done when: jsdom test
shows the same bar node surviving a re-render with a new value and `data-st-sable-changed` set
only on changed rows; CSS test confirms the off selectors cover every new transition and that
`full`-only rules are scoped to `data-st-sable-effects="full"`. Effects are the composable `visual.fx` set of SPEC §16. Built as a comparison round: two independent implementations on two branches, reviewed side by side.

## T11 — Collapsible settings groups  [x]
Done: persistent collapsible groups, shared Danger zone rendering and regression coverage; 136 tests and changed JavaScript syntax checks pass. No dependencies or commit.
SPEC §17: every settings group becomes a `<details>` with its heading in `<summary>`; open state in
`settings.groups` (Connection open by default, the rest closed), merged per key by `saveSettings` like
`folded`; the Danger zone keeps its look and joins the same path. Done when: jsdom test toggles a group
and the flag persists through `runtime.updateSettings`; a re-render for an unrelated setting keeps open
groups open; unknown group ids and non-boolean flags are dropped idempotently; the Danger zone still
renders its sub-blocks inside its details; the narrow-container layout test still passes.

## T10 — Ring survives swipes; injection role  [x]
Bug (verified with `store.js`): `putEntry` caps the ring at `keep` entries in total, so three new
swipes of one reply evict the state before it (ring `5/1 5/2 5/3`, base NONE). The fourth swipe
then generates with **no injection at all** and its side-model run starts from an empty previous
state, which reads as the trackers forgetting the scene. Fix: keep the newest `keep` distinct
`mesId`s and at most 6 swipes per message (oldest dropped); `currentEntry`/`findEntry` unchanged.
Tests: four swipes keep the base and the injection; swiping back restores the cached swipe;
`MESSAGE_DELETED` pruning still works. Separately add `settings.role` (system | user | assistant,
default system) next to depth and pass it to `setExtensionPrompt`, for models that copy a
system note into the reply; label it in i18n and README as the knob to try when the state block
shows up in replies.
Done: `putEntry` keeps the newest `keep` distinct `mesId`s with up to `SWIPES_PER_MESSAGE` (6) swipes each; `settings.role`
(system | user | assistant) is normalized, passed to `setExtensionPrompt` on every call and editable in Context next to depth; hint, README and SPEC §4/§5 updated; store, glue and settings-UI tests added.

## T12 — Dice as an integration; scope «others»; intimacy defaults  [x]
SPEC §15 after the 2 Oct evening decisions. (1) Scope gains `others` (everyone except `{{user}}`) with a
per-pack `scopeDefault`; combat `all`, intimacy `others`; `settings.packScope` accepts the three values,
the drawer segment and the settings select offer «все / только я / кроме меня»; the `{{scope}}` sentence
for `others` says the user's state, feelings and responses are never recorded or implied. (2) The
`combat_roll` section is removed (old values in rings are ignored); the roll lives in
`chat_metadata.sableTrackers.roll`, set by `runtime.rollDice(sectionId, key, chance)`, shown inline on
the "%" row, injected as the last digest line for the next generation only and consumed when a character
reply arrives after `forMesId`; 🎲 appears on any "%" row of a stats/kv section. (3) The intimacy pack's
descriptions (ru/en) drop the dice mention; combat's keep one short clause. Done when: tests cover the
three scopes in the prompt, the default per pack, the roll lifecycle (set → injected once → consumed →
greyed), the inline row result, and the absence of a roll card; README and SPEC examples updated.

T12 done: three scopes with per-pack defaults; chat-local dice with inline results and one-shot injection, consumed on receipt and retained across swipes; legacy roll cards removed. Fixtures and bilingual labels/docs updated; 164 tests, changed-JavaScript syntax checks and diff whitespace checks pass. No dependencies or commit. Live Android layout remains unverified.

- [x] T12b: record `consumedBy`; runtime-only swipe arming restores the consuming reply's ROLL line and pending row, cleared on receipt, MESSAGE_SENT, deletion, chat change or a new roll without clearing `consumedAt`. Lifecycle and drawer regressions pass (168 tests); no dependencies or commit.

## T13 — Packs as groups in the drawer  [x]
SPEC §15 "Drawer" and §6: one `section.st-sable-group[data-pack]` per enabled pack among the flat cards; header = handle /
pack glyph + `packTitle()` (18+ badge) / group mode chip / fold, no pack switch. The chip shows the members' common mode or
«смешано», and its menu (the card menu, generalised to a `{ current, apply, gone }` target) writes every member through
`runtime.setPackMode(packId, mode)` (same chat-override semantics as `setMode`, one write, one render). Group fold =
`settings.folded['pack:<id>']`, kept by the normaliser. Members are the unchanged cards, nested and lighter; cards and group
containers persist across renders. `groupedOrder(order, sections, packs)` in `src/sections.js` keeps `settings.order` flat
but reads a pack's ids as one contiguous block at the first member (packs with no entry still append in registry order, as
in T8a). The group handle and its ↑/↓ move the block among the top-level items, a member handle moves it inside its block
only; touch drag (`beginDrag`) works at both levels because the parent element bounds the move, and a cancelled drag simply
re-renders. hideOff hides off members inside their group and a group whose members are all off. Decisions: the settings
panel already uses `.st-sable-group` for its collapsible `<details>`, so every group rule in `style.css` is scoped under
`.st-sable-drawer`; a glow rule in the Full block keeps the glow on the container, not the members. Validation: 175 tests,
syntax checks, headless Chromium renders of `dev/phone.html` and `dev/preview.html` (both still load).

## T14 — Edited replies: stale state leaves the injection and the base  [x]
SPEC §4 (2 Oct 2026 live report: the user trims the end of a reply, sends the next message, and the
main model still gets the state computed from the deleted text). A stale entry (the latest reply was
edited) stays in the drawer with the ↻ hint, but `publish()` injects the entry before it and `prepare()`
takes that earlier entry as the base, so the next run recomputes from the edited text. New
`settings.recomputeOnEdit` (boolean, default false; Context group, ru «Пересчитывать после правки
ответа», en "Recompute after editing a reply") starts one run right after the edit. Done when: tests show
the injection switching to the earlier state after `MESSAGE_EDITED` and back after a refresh, the next
run's request carrying the earlier state as its previous state, the drawer still showing the stale entry
with the hint, and the setting firing exactly one run per edit.

T14 edited replies: live-entry fallback drives injection and request bases; the drawer retains stale state, and optional recomputation runs once per edit. Regression coverage includes refresh, cancellation and settings.

## T15 — Instruction list grouped by pack; playful intimacy cards  [x]
Danger zone (3 Oct 2026, maintainer's phone screenshot: «паки тоже сделать с разбивкой»): the "Model instructions" list
was flat, with the pack rules dangling after every section. Now the built-in sections stay flat and every built-in pack is
one nested `details.st-sable-prompt-pack[data-prompt-pack]` (pack glyph, `packTitle()` with the 18+ badge, a «Набор»
hint, and a `[data-pack-changed]` badge while the rules or any member differ from default), holding the pack rules row
(`[data-prompt-rules]`) first and then the pack's sections (`[data-prompt-section]`) in `settings.order`, the same
breakdown as the drawer groups (T13). `promptControls` entries carry their `container`, so `renderDanger()` reorders rows
inside the flat list or inside the pack body after its rules row. Intimacy pack: two cards shown by default and not
injected (`mode: 'show'`; the `section()` helper takes a mode argument): `intimacy_achievements` (tags, max 8: video-game
style badges unlocked only for explicit events, kept across replies in their wording) and `intimacy_commentary` (text:
one or two tongue-in-cheek sentences in a voice picked for the moment: sports commentator, nature documentary, tabloid
headline, dating show, trailer). Both keep the adult guard, neither uses `{{scope}}`, so the pack's group chip reads
«смешано» until the user aligns the modes. Validation: tests, headless Chromium render of the real-ST Danger zone.

## T16 — Folders: user groups of cards  [x]
SPEC §18 (3 Oct 2026, maintainer: «создавать из существующих группы, как в Дискорде»). `settings.folders`
(`{ id: f_…, title, icon, members }`, normalised, max 12, members = built-in or custom section ids, one folder
per section, fold keys `folder:<id>`), `groupedOrder(order, sections, packs, folders)`, `runtime.setFolderMode`,
the drawer's group container generalised to packs and folders (`data-folder`), the card footer «В группу…»
menu (folders / «Без группы» / «Новая группа…»), the folder footer editor (title, icon, two-tap delete),
empty-folder hint, hideOff inside folders, block and member moves as for packs, and the settings Sections
group button «Разложить по группам» (Мир / Люди / Сюжет). Membership writes rewrite `order` so the card lands
at the end of the target block. Done when: the tests of SPEC §18 pass (normaliser, groupedOrder with folders,
setFolderMode, the drawer flows above, the suggested layout), every existing test stays green, `dev/phone.html`
and `dev/preview.html` still load, README ru + en describe folders, SPEC §6 mentions them.

Done: normalized folders, shared pack/folder containers, membership menu and pure move helper, retained inline folder
editors, aggregate modes, folds, hideOff, bounded pointer/keyboard moves and suggested groups. Decisions: existing
title/icon/save/cancel labels are reused; full folders and creation at the 12-folder cap are disabled in the menu;
selecting the current folder is a no-op; a first member gives an empty folder the card's current position. Suggested
groups replace only the folder array, leaving raw order intact. Membership preserves explicit disabled-pack positions
without adding absent pack cards. Folder menus scroll at 240px and wrap long titles for narrow screens. The phone
fixture shares the preview's two folders. Validation: 198 tests, changed-JavaScript syntax checks and diff whitespace
checks pass; the actual preview module loads in jsdom with both folders. Browser discovery returned no connected
browser, so real-browser/Android visual verification remains manual. No dependencies, commit or push.

## T17 — NPC underside: secret and truth behind a tap  [x]
SPEC §19 (3 Oct 2026, maintainer: «секрет я бы поменяла на тайну 🙊… мне нравится структура»). `npcs[].truth`
(string ≤ 160, a short phrase of what the NPC actually feels beneath the shown behaviour; instruction added to
`npcs`), neither `secret` nor `truth` in the digest, `settings.spoilers` (default true). Drawer: in each NPC row
`agenda` is labelled «Собирается» and comes first; `secret` and `truth` move behind a «Тайна» spoiler button
(`fa-eye-slash` / `fa-eye`, 🙊 in emoji mode, `data-control="spoiler"`, `aria-expanded`), revealed per NPC id in
memory until a new ring entry or a chat change; with the setting off both are plain fields. Settings → Sections:
the spoiler checkbox before «Разложить по группам». Labels ru/en: «Тайна» / "Secret", «На самом деле» /
"Deep down", «Собирается» / "About to", plus `field.truth` for the editor. Done when: schema and sanitize tests
cover `truth`, the digest snapshot tests are unchanged, drawer tests cover hidden-by-default, reveal, re-hide on
a new entry and on chat change, the setting off, present and absent rows, the editor field; README ru + en and
SPEC §2 table mention the field; `fixtures/state-full.json` carries a `truth` for one NPC.

Done: schema, canon-grounded instruction, localized spoiler/editor/setting, fixture and bilingual README updated; digest and reply panel unchanged.
Decisions: concealed values are absent from DOM text until revealed; only that spoiler block updates on tap. Entry keys are checked before rendering rows. Chat metadata identity also clears reveals, because different chats can share identical entry keys; replacing metadata conservatively hides them too. Existing row folds remain intact.
Validation: 203 tests pass, changed JavaScript syntax checks and diff whitespace check pass. No dependencies, commit or push; live Android/SillyTavern layout remains unverified.

Candidates noted the same day, not scheduled: a «по персонажам» layout (one card per NPC built from npcs,
thoughts, bonds and dossiers), signed −100…+100 bond scales with a centre line, a 12-point history sparkline per
scale (needs a small per-chat history store).

## T18 — Bond scales: switchable built-ins and custom scales  [x]
SPEC §20 (3 Oct 2026, outside feedback: «репутация и уважение похожи, объединила бы»; maintainer: «как в паках,
основные и допки вкл/выкл, добавить своё»). `settings.bondScales = { off, custom }` (normalised: `off` ⊂ built-in
keys, `custom` ≤ 6 of `{ key, title, hint, friction }` with slug keys that never collide with built-ins),
`bondScales(settings)` in `src/sections.js` (built-ins minus `off` in canonical order, then custom), the `bonds`
section built from it in `getSections` / `getAllSections` (stats schema fields = active keys; instructions = base
text + the active scales' definitions, byte-identical to today with default settings), `merge.js` recomputing over
the registry's active keys, `renderBonds` and the reply panel iterating the active scales with titles and friction
from the descriptors, a new settings group «Шкалы отношений» (`GROUP_IDS` + `scales`: a checkbox with a one-line
hint per built-in scale, the rebuild hint, custom scale rows with a two-tap delete and «Добавить шкалу»). Done
when: tests cover the normaliser, `bondScales`, the settings-dependent schema and instruction (default = today's
text), merge over active keys, digest and drawer showing active scales only, a custom scale with friction tint, the
settings group (toggle writes `off`, custom rows write `custom`), every existing test green, README ru + en and
SPEC §2 mention the group.

## T19 — Layout option: by people  [x]
SPEC §21 (3 Oct 2026, maintainer: «по персонажу делала бы как опцию»). `settings.layout` (`topics` | `people`,
select in Settings → Sections). In the people layout the four NPC-keyed sections (`npcs`, `thoughts`, `bonds`,
`dossiers`) render as one built-in group «Люди» (`[data-people]`, pack-group header with an aggregate chip over
the four modes, fold `folded.people`) holding one person card per NPC (`[data-person]`: presence dot + name +
mood header, fold `folded['person:<id>']`, body = npcs fields + spoiler, thought, bond rows as keyed
`scaleRow`s, matching dossier), unmatched dossiers as trailing person cards, no editor and no «В группу…» on
person cards, hideOff when all four are off; everything else renders as in the topics layout; storage, prompt
and digest untouched. Done when: tests cover the select, the group and its chip, person card order and content
per mode, the dossier match, keyed persistence of person cards and bond rows across renders, hideOff, folders
that list an NPC section, the topics layout unchanged (existing tests green); README ru + en mention the
option; `dev/preview.html` accepts `?layout=people`.

## T20 — Bond visuals: history sparklines and signed custom scales  [x]
SPEC §22 (3 Oct 2026, maintainer: «визуал я оч люблю»). `store.history[bondId][scale]` = up to 12
`{ mesId, value }` points written when a run result or a manual edit is stored (same `mesId` replaces, pruned
with the ring), `visual.sparklines` (default true) → a 12-bar `div.st-sable-spark` under a bond bar with ≥ 2
points, tinted like the bar; any scale can be signed per scale (`bondScales.signed` for built-ins, `signed`
on custom entries; range −100…+100, schema `score` with `min: -100`, the definition gets the signed sentence,
a centred bar with a hairline, signed numbers, warm tint for the negative side) in the drawer, the panel and
the §20 settings group (a second «−100…+100» checkbox per scale). Done when: tests cover history writes (append,
replace on the same mesId, cap 12, prune), the sparkline (hidden under 2 points, bar count and heights, the
visual toggle), signed parsing and clamping, the centred bar and signed labels, the settings checkbox; every
existing test green; README ru + en mention both; SPEC §12 lists `visual.sparklines`.

## T21 — Intimacy+ pack (18+)  [x]
SPEC §23 (3 Oct 2026, a reader's list of a thorough adult block; maintainer: «идея для второго пака… пиши»).
Built-in pack `intimacy_plus` («Интим+ (18+)», `fa-fire`, scope default `others`, the adult guard + explicit-facts
rules) with seven sections: `climax` (stats, inject), `contact` (kv, inject), `zones` (kv, show), `kinks` (tags,
inject), `limits` (tags, inject), `experience` (list, show), `after` (text, show), each instruction starting with
the adult guard and the empty-value rule. Content only: `src/packs/index.js`, i18n ru + en, fixtures, tests
(shape/cap list, scope set, digest snapshot, the fixture key list, the pack sheet count), README + SPEC §15.
Done when: `npm test` green with the new pack in every pack test, the fixture validates through `sanitizeSection`
for every new section, the digest snapshot includes the four inject sections, the sheet lists three packs.

## T22 — Drag between containers and the undo pill  [x]
SPEC §24 (3 Oct 2026, design round: «Undo хорош», «перенос — согласна»). One-level undo pill in the drawer
(`undo.show(text, restore)`, 5 s, in memory, used by drops, folder delete (now one tap) and «Разложить по группам»);
the handle drag detaches from its parent after 24 px of hysteresis and drops into user folders (header = end, gap =
index, folded = header, empty = hint row), into top-level gaps (no folder), never into packs or the People group
(dimmed, drop cancels); full folder badge; auto-scroll in 48 px bands; cancel on pointercancel / Escape / 40 px left of
the panel / no slot. `planDrop(settings, id, { folderId, index })` + `slotFor(rects, y)` in `src/folders.js`, pure and
tested; one `updateSettings({ folders, order })` per drop. Files: `src/folders.js`, `src/ui/drawer.js`, `style.css`,
i18n ru + en, tests, README (groups paragraph), DESIGN-NOTES (≤ 6 lines).
Done when: `npm test` green with `planDrop`, `slotFor` and undo-pill tests; `node --check` on changed files; the menu
«В группу…» unchanged; no behaviour change in run/store/prompt.

## T23 — Person card: pencil menu, edit form, delete, add  [ ]
SPEC §25 (3 Oct 2026: «просто добавить карандашик маленький и выбрать удалить/редактировать»). Builds on T22 (the
undo pill). `runtime.editSections(values)` batched all-or-nothing write (`editState` becomes a wrapper);
`applyPersonDraft(sections, person, draft)` pure and tested; a 36 px pencil in the person card header with a two-item
menu (Edit / Delete); the edit form generated from the four section schemas sliced to the person, with «+ Досье /
+ Отношения / + Мысль / + Персонаж» for missing parts, a «Данные обновились» bar on underlying change, sticky Save /
Cancel; delete = one `editSections` + the undo pill; «+ Человек» in the People group footer. Remove the footer hint.
Files: `src/run.js`, `src/ui/drawer.js` (or a new `src/ui/person.js` for the pure parts), `style.css`, i18n, tests,
README (people layout paragraph), SPEC §13/§21 cross-notes.
Done when: `npm test` green with `editSections` (invalid → false, nothing written; valid → one save, one history
record), `applyPersonDraft` (replace / add / remove / orphan dossier / no change → {}), form build from fixtures,
delete + undo round trip; `node --check`; topics-layout editors unchanged.

## T24 — Stat history and tap-to-jump  [x]
SPEC §26 (3 Oct 2026: «стату привязывать к сообщению» for people who re-read). `recordHistory` generalised to
`history[key][line]` for stats sections (items with numeric `max` only; lines absent from the fresh value are
dropped); sparkline under stats bars; every sparkline becomes a button: tap picks a bar, shows «ответ #N · HP 40»,
scrolls `#chat .mes[mesid="N"]` into view when rendered, «(не загружено)» otherwise; keyboard ←/→/Enter; checkbox
renamed «Мини-графики под полосками». Files: `src/store.js`, `src/run.js`, `src/ui/drawer.js`, `style.css`, i18n,
settings label, tests, README.
Done when: `npm test` green with store tests (stats recorded, counters without max ignored, absent lines dropped,
swipe replace, prune), a drawer test for the label and the active bar (jsdom; scrolling stubbed), the panel and the
digest untouched.

## T25 — First-run hints, missing-profile status, mode legend, stale recompute  [x]
SPEC §27 (3 Oct 2026: «мелкие всплывашки… проверь соединение, выбери что нравится и наслаждайся» + «галочка, чтобы
не показывало больше»). Three sequential hint popups in the drawer with «Больше не показывать», `settings.hints.done`
(set by the checkbox, the third hint, or the first successful run), «Показать подсказки снова» in Actions; a permanent
«Нет профиля модели → настроить» status button + disabled Run now when no usable profile; a three-line legend at the
bottom of every mode menu; `recomputeOnEdit` removed in favour of a «Состояние устарело · ⟳ Пересчитать» status
button and `st-sable-stale` on stale cards. Files: `src/settings.js`, `src/run.js` (snapshot flags), `src/ui/drawer.js`,
`src/ui/settings.js`, `style.css`, i18n, tests, README (setup steps + Context paragraph).
Done when: `npm test` green with normaliser tests (`hints`, `recomputeOnEdit` dropped), drawer tests for the hint
sequence and the status states (no profile / stale), the legend present in the menu; `node --check`.

## T26 — Settings in one tier  [ ]
SPEC §28 (3 Oct 2026: «один этаж, в заголовках перечислено содержимое, период в меню чипа, цвет в меню карточки,
импорт плашкой»). Folded group summary lines (`group.<id>.summary`); «Раз в N ответов» row in the mode menu writing
the global period; «Цвет…» in card footers with the Card colours swatches; the legacy import button leaves Actions
and becomes a drawer banner when `canSeedLegacy`, with a per-chat «Скрыть» (`legacyBannerHidden`). Files:
`src/ui/settings.js`, `src/ui/drawer.js`, `src/run.js` (banner flag), `style.css`, i18n, tests, README.
Done when: `npm test` green with tests for the summary lines, the period row (writes `sections[id].period`), the
colour row (writes the full `visual`), the banner (shown / hidden / imported); `node --check`; no change to prompt or
storage beyond the banner flag.

## Notes from previous tasks
(append here)
- T22: `planDrop(settings, id, { folderId, index })`, `slotFor(rects, y)`, `dropBlocks(settings, folderId, skip)` and
  `dropIndex(settings, id, folderId, anchorId)` in `src/folders.js`; `createUndoPill(document, label, timers?)` and
  `UNDO_MS` exported from `src/ui/drawer.js`; the drawer API gains `undo` (`ui.undo.show(text, restore)`), which §25
  person delete should reuse. Decisions: the slot stores the card it sits before (`anchor`), and `dropIndex` converts
  it to the `planDrop` index, so hidden cards, disabled packs in `order` and the People view do not shift the drop; a
  flat card's "parent box" is the top level, so it detaches when the pointer is 24 px deep inside a group (anywhere on a
  folded or empty one), while a member detaches 24 px outside its folder; a detached card stays in place (no ghost
  following the finger) and a drop that changes nothing writes nothing. «Разложить по группам» lives in the settings
  block, where the drawer's pill is out of sight, so the settings get their own pill instance under the button (same
  factory). Folder delete restores the fold state too. `lostpointercapture` first tries to re-capture (moving the card
  in the DOM may drop capture while the finger is down) and cancels only if that fails. The `folders.confirmDelete` /
  `folders.confirmSuggested` strings are unused now but left in `src/i18n.js` to keep parallel merges trivial; delete
  them in a cleanup. `test/effects.test.mjs` now ends the full-only CSS part at `/* End of full-only rules. */`, so
  later blocks appended to `style.css` may carry subtle-level rules. Real geometry (touch on Android Chrome, the 24 px
  feel, auto-scroll speed) is unverified outside jsdom.
- T25: `settings.hints = { done }` (normalised to a boolean, default false); `normalizeSettings` deletes `recomputeOnEdit`, so
  the stored key disappears on the next load. `profileIssue(ctx, settings)` (exported from `src/run.js`) returns null or
  the i18n key `profileRequired` / `profileUnsupported`; the snapshot carries it as `profileIssue` plus `profiles`
  (`{ id, name, cc }`, the hint's select source). `execute` uses it for the existing warnings and, after the first `ok`
  run, saves `hints: { done: true }`. `edited()` only marks the entry stale and saves; the drawer status offers «⟳
  Пересчитать» (`[data-control="recompute"]`, `runtime.run(entry.mesId, { type: 'edit' })`, disabled while running or
  without a profile). Drawer: `div.st-sable-hint[role=dialog]` sits between the legacy button and the cards; the step
  (0–2) is in memory and restarts when `done` goes back to false; controls `hint-profile` / `hint-never` / `hint-next`.
  The gear handler is now `openSettings(group)`: with a group it first writes `groups[group] = true` (the settings UI
  opens the details on render), then calls `onSettings(group)` or the Extensions-tab path, scrolling to that group.
  The status setup button is `[data-control="setup"]` (`st-sable-status-setup`); the ↻ header button is disabled with
  the same title while `profileIssue` is set, like Run now in Settings → Actions (next to it: «Показать подсказки снова»,
  `[data-control="hints-again"]`, disabled while the hints are still on). Decisions: the status «outdated» span was
  renamed `st-sable-status-stale` (cards now own `st-sable-stale`); the legend is appended only when every menu entry
  is a mode, so the folder picker that reuses `openModeMenu` has none; mode-menu tests now select
  `[role="menuitemradio"]` instead of the popup's children; `test/effects.test.mjs` ends the full-only CSS part at the
  first `/* T<n> */` marker so later task blocks can be appended after it.
- T20: `store.history[bondId][scale]` via `recordHistory(data, bonds, mesId, keys)` / `pruneHistory(data, keep)` (keep = a
  chat length or a Set of mesIds) and `HISTORY_POINTS = 12` in `src/store.js`; `run.js` records after a parsed run result is
  stored (not on a skipped run with no due sections) and after `editState('bonds')`, prunes in `deleted`. A point is
  written whenever the stored state carries the bond, also on replies where bonds were not due (the line then shows a
  flat step per reply). `settings.bondScales` is now `{ off, signed, custom }` (custom entries carry `signed`);
  `SIGNED_HINT` in `src/sections.js` is appended to signed definitions; a signed flag alone rebuilds the bonds section
  (the default text stays byte-identical). The common sentence "Known scores are integers 0-100" stays: the per-scale
  range sentence overrides it locally, and changing it would break the byte-identical default. `scaleRow` takes `signed`
  and `history`; the sparkline is the summary's last child (the first four children are read by position; CSS puts it
  in grid column 2, second row) so a closed `<details>` still shows it. The signed fill keeps the transform animation: it
  is half the track, anchored inline with `left: 50%` / `right: 50%` and scaled by |value|/100. Decisions: the negative
  side takes the opposite tint of the scale (warm for affinity scales, as SPEC says; the plain bar colour for a friction
  scale such as a signed fear), sparkline bars of negative points likewise; sparkline bars do not animate (the CSS test
  forbids height transitions, and §22 says static is fine); the reply panel badge of a signed scale appends the signed
  current value («Maren: +5 Trust → −40»), since the panel shows only deltas; the bond score column is 2.6em (was 2.1em)
  with `white-space: nowrap` so «−100» fits. The custom scale row's empty space came from `flex: 1 1 12em` on the hint
  field inside a column flex container (a 12em height); only the title grows now, inside the key/title line, gaps 8 px.
- T21: `intimacy_plus` follows `intimacy` in `BUILTIN_PACKS`; content only, no drawer or settings code changed (the
  machinery groups by `section.pack`, so the underscore in the id is harmless). Decisions: the pack rules name the empty
  value per section like the base pack does; `contact` may write `none` for an entry only when the text establishes there
  was none (so a paused scene can show an explicit zero, as the fixture does); `climax` points at the base pack for climax
  counts and resets to 0 after an explicit orgasm; `after` has no `{{scope}}` and describes everyone present, as §23 says;
  the ru/en descriptions end with "works alone or with Intimacy". The fixture keeps the Guard and the Traveller in a
  paused, tame scene; its four inject sections add CLIMAX / CONTACT / KINKS / DISLIKES lines to the digest snapshot.
- T19: `settings.layout` (`LAYOUTS` in `src/settings.js`), the select «Раскладка панели» first in Settings → Sections,
  `runtime.setSectionsMode(ids, mode, chatOnly)` (`setFolderMode` now delegates to it). In the drawer the people layout is
  a container descriptor `{ kind: 'people', key: 'people' }` plus `drawerFolders()`: `groupedOrder` gets a leading pseudo
  folder `{ id: 'people', members: the four }` and the user folders minus the four, so the block is contiguous and the
  handle / ↑↓ / touch drag move it like a folder (`moveToken` now recognises container keys instead of `:`; `shownIds`
  expands the People group to its four ids). Decisions: a folder whose members are only NPC sections is hidden while the
  layout is on (it would otherwise show as an empty folder); a folder chip in this layout writes only its remaining
  members; with all four off the group hides under hideOff and, revealed, shows an off group with «—» (no person cards);
  the header mood shows only while `npcs` is not off; bonds whose id matches no NPC also get a trailing person card (so no
  bars disappear), after them unmatched dossiers (card key = dossier name, made unique); person cards default to folded
  unless the NPC is present; the title dot is per person (`freshCards` holds `person:<id>` for cards whose bond rows
  changed) rather than the whole npcs/bonds sections; `fields()` now labels through `fieldLabel` and `field.role` was
  added, because `role` is the injection-role setting label («Роль вставки») — this also fixes the dossier role label in
  the manual editor. `normalizeSettings` keeps `folded.people` and any `person:<id>` key.
- T18: `bondScales(settings)`, `bondsSection(settings)`, `normalizeBondScales`, `BOND_SCALE_HINTS`, `FRICTION_SCALES`,
  `BOND_SCALE_KEY` and `MAX_CUSTOM_SCALES` live in `src/sections.js`; `getSections`/`getAllSections` swap in the
  settings-dependent bonds section (default settings return the frozen `SECTION_MAP.bonds`, so the default text is
  byte-identical; `test/scales.test.mjs` holds a literal copy). Decisions: a custom scale without a hint is described to
  the side model by its title (`key = title`); with every scale off the definitions read `none`; the base sentences
  about affection growth and desire/love for minors stay even when those scales are off (they are harmless rules).
  `merge.js` reads the active keys from the registry's bonds schema; `digest.js` filters bond stats by the same schema,
  so a switched-off key still stored in an old bond is not injected. `parse.js` needed no change (`changes` already
  accepts any key; merge recomputes it over active keys). Settings rows for custom scales are positional (index-keyed);
  an invalid key is marked `aria-invalid` with a hint line and kept in the input, unsaved, until fixed or a row is
  deleted. The editor's `fieldLabel` falls back to a custom scale's title after the i18n lookups.
- T13: the drawer's top-level children are `.st-sable-card` or `.st-sable-group`; find cards with
  `cards.querySelector('.st-sable-card[data-section="…"]')` (deep), never through `cards.children`. Section order for the
  drawer comes from `groupedOrder(...)`; `orderedSectionIds` is for the digest and the settings table.
- T12 supersedes T8b dice notes: inject randomness through `createRuntime(getContext, { random })`; the drawer calls `runtime.rollDice(sectionId, key, chance)` and reads `snapshot().store.roll`. No `<pack>_roll` definition or `editState` call is needed. `packScopeOf(settings, pack)` resolves scope overrides/defaults; snapshot pack descriptors include `scopeDefault`. `preview().injection` is separate from its unchanged side-model `messages`.
- T9: cards persist across renders (`render()` reuses the node and calls `updateCard`; only a fresh card or an editor toggle goes through `buildCard`). Bond scales and pack stats are `details.st-sable-scale[data-key]` rows reconciled in place by `scaleRow` (`bonds:<id>:<scale>`, `<sectionId>:<key>`); the fill is `transform: scaleX(ratio)` plus `--st-sable-ratio`, every row is a `<details>` (`st-sable-delta` with a delta, `st-sable-static` when neither a delta nor a note), `data-st-sable-changed` lasts one render, `.st-sable-change-dot` in the title is hidden unless the card changed since the last unfold/run. `applyEffects(element, visual)` (exported from `src/ui/drawer.js`, also used by `panel.js`) sets `data-st-sable-effects` (always present; `prefers-reduced-motion` forces `off`), `data-st-sable-fx` (space-separated names, full only) and the `--st-sable-glow-rgb/-glow/-shimmer-rgb/-shimmer-duration/-rain-rgb/-rain-density/-rain-angle` variables. CSS: the Live cards block at the end of `style.css`; everything after `/* Full: every rule below` must carry `[data-st-sable-effects="full"]` (tested as text in `test/effects.test.mjs`). The reply panel keeps its node and `.st-sable-panel-pack > .st-sable-panel-stat[data-key]` rows. Number ticks and the dice spin are JS-timed (`TICK_MS`, `DICE_MS`); `hide()` cancels the rAF runs. Crit = a hit on a chance whose label contains "crit", or a natural 1/100.
- T8b → T8c/T9: the drawer's pack button sits before ✕ (`[data-control="packs"]`, `fa-box-open` / 🎒) and opens `#st-sable-sheet` inside the drawer (scrim + bottom panel; Escape, ✕ and a tap on the scrim close it). Pack cards go through the custom-section path: `stats` rows are `.st-sable-scale-row.st-sable-stat-row` (bar via `[role=meter]`, `.st-sable-counter` when `max` is null, `.st-sable-badge` + `.st-sable-reason` in a `details.st-sable-delta` when `delta` ≠ 0, `.st-sable-dice` only on `%` keys of packs with a `<pack>_roll` text section), `tags` are `.st-sable-tag.st-sable-ban` chips. `createDrawer(runtime, { random })` injects the dice randomness (default crypto). `packTitle(title)` in `src/ui/drawer.js` splits the "18+" mark into a badge; `exportPack(pack, { random, lang })` localizes a built-in copy. The settings block editor is `createBlockRow(io)` (custom blocks and pack cards share it; `io.rename` adds the key field). Enabled pack sections also appear in the Sections table and card colours. `fixtures/state-packs.json` (T8c) is merged by `dev/preview.html` when present (`state` key or a bare state) with both built-in packs on.
- T11 → T8b: add the Packs group id to `GROUP_IDS` in `src/settings.js` and use `group()` in the settings UI; `settings.groups[id]` is a boolean open flag (missing = closed), and partial `groups` patches merge per key. Appearance keeps its existing `visual` id.
- T8c: final combat/intimacy content, ru/en descriptions, synthetic state-packs.json, digest and prompt coverage, and bilingual pack documentation complete; T8b UI remains separate. No commit.
- 2026-10-02 the maintainer answered the hand-off questions: docs/HANDOFF-2026-10-02.md §6 "Answers". Settings groups become collapsible first (T11, SPEC §17), then T8b builds the Packs group on top; T9 is a two-implementation comparison round.
- T8a → T8b: `snapshot().packs` exposes `{ enabled: string[], available: [{ id, title, icon, description, builtin, scope }] }` with localized built-in labels. `runtime.setPack(id, on)` returns false for unknown ids; otherwise persists the chat list and re-publishes without starting a run. Use `getSections(settings, snapshot().packs.enabled)` for pack cards; the one-argument call still returns only built-ins + custom blocks. Descriptors have `custom: true`, `pack`, literal `title`, `shape: 'stats' | 'tags'` and array schemas: stats rows `{ key, value, max, unit, note }` (merge adds `delta`; null max means counter), tags are unique strings. Explicit pack positions survive in `settings.order`; absent pack ids append in registry order. T8c replaces provisional instructions; no UI or commit in T8a.
- 2026-10-02 design round (docs only): packs, live cards and the swipe ring bug are written up in `docs/HANDOFF-2026-10-02.md` with the decisions, a repro and open questions. Start there before T8a–T10.
- T5 complete: Extensions settings with localized fields, cc-only profile selection and refresh, per-chat override reset, legacy import and manual run; English README with Russian quick start. jsdom coverage and syntax checks pass. No commit created (requested).
- T2 complete: settings, ring persistence, abortable event runtime, injection and fake-driven tests. T1 core reused; i18n only gained runtime warnings/errors. No commit (working-tree delivery requested).
- T3: use the exported `runtime` in `index.js`: `snapshot()`, `subscribe(listener)` (returns unsubscribe), `refresh()`, `setMode(id, mode, chatOnly?)`, and `updateSettings(patch)`. Changes re-inject and notify subscribers; `entry.stale` drives the outdated hint. Ring entries carry `turnsSince` snapshots for swipe restoration; `lastRun` token counts are estimates. Connection profiles use `mode === 'cc'` (not `api`) for completion type. No UI added in T2.
- T4 seeding: runtime initializes the metadata namespace on load; use an empty ring to detect an unseeded chat. Never seed automatically on chat load.
- T1 review fixes: explicit output language and restored canon rules; parser identity/priority fallbacks; NPC/bond retention with missing-score preservation; digest default modes. Regression tests added; T2 should pass settings.language to the prompt builder.
- T3 implementation is in the working tree: glass drawer, all section renderers, pointer/keyboard reorder, persisted folds/pin/floating position, mode chips, wand entry, status and safe text rendering. Tiny T2 hooks: normalized UI settings, `lastRun.at` for successful/failed run timestamps, and drawer mounting in index.js. Generation/injection behavior is unchanged.
- T3 review complete: viewport-bounded mobile drawer, shrinkable/wrapping text, compact mode chips, straight inset accents, and safe display-only user/character macro replacement. Preview harness retained. All 35 tests pass (including jsdom CSS constraints and macro regressions); changed JavaScript syntax checks pass. CSS tests do not measure browser layout. No commit created (requested).
- T4 complete: compact panel follows the newest character message and reattaches on render/edit/swipe, using the drawer's exported safe `displayNode` helper. Legacy migration reads the active swipe, maps v2 data, and preserves message data. Import is button-only, never on drawer open or chat load (explicit task instruction supersedes the earlier first-open note). All 41 tests pass; JavaScript syntax checks pass. No commit requested.
- T5: use `runtime.seedLegacy()` for the settings import button and `snapshot().canSeedLegacy` for visibility (empty ring plus valid legacy data). Mount settings at `#st-sable-settings`; the drawer gear already opens the Extensions tab and expands/scrolls that section. No T5 implementation included.

- T3 visual follow-up complete: compact 13px type, translucent glass, floating mobile drawer, Font Awesome header/native wand entry, and 44px top-left FAB with saved drag positions retained. Added CSS/default-position coverage; all 48 tests and drawer syntax check pass. Live phone layout remains unverified. No commit created (requested).
- Settings UI round (branch `settings-ui`): grouped settings block (Connection / Context / Sections / Custom blocks / Appearance / Actions) on ST classes, stacks under 500px. Custom-block editor writes the full `customSections` array via `runtime.updateSettings` (ids `c_` + 8 hex, two-tap delete); its mode/period are the item's global values, per-chat overrides for custom ids are left to the §11 logic. `settings.visual` defaults + clamping live in `src/settings.js` (`VISUAL_DEFAULTS`, `normalizeVisual`); the drawer applies them as `--st-sable-*` variables on the drawer and the edge tab and switches title icons; sliders preview on `input`, persist on `change`. Send full `visual` objects: `saveSettings` does not deep-merge a partial `visual` patch. Exported helpers in `src/ui/drawer.js`: `applyVisual`, `glyphNode` (emoji or FA class, safe), `sectionGlyph`, `SECTION_ICONS`. The drawer still renders built-in cards only.
- Visual base colour (branch `visual-base`): `visual.base` / `visual.text` (null = automatic) with `normalizeHex` in `src/settings.js`. `src/ui/drawer.js` exports `luminance`, `inkFor` (black/white by higher WCAG contrast, crossover L ≈ 0.179, not 0.5, so pastel light bases get black ink) and `visualColors`. `applyVisual` sets base/ink/accent-ink/text variables and `data-st-sable-tone` on the drawer and the tab, and removes them when automatic. The default accent is no longer set inline (the CSS fallback follows the ink). The `inject` chip is now a solid accent fill with accent-ink text and a 1px ink border. Only the drawer and tab use ink; the reply panel and the settings block still follow the theme.
- Manual editing + FA markers (branch `edit-state`): `sanitizeSection` exported from `parse.js`. `runtime.editState(id, value)` sanitizes, replaces the section in the current entry (or creates one for the last character reply), sets `meta.editedAt`, clears `stale`, cancels an in-flight run, re-injects and saves. The drawer has a schema-driven editor behind the pen button in each card header (SPEC §13). Cards are now built per section (`buildCard`/`buildHeader`), and render() reconciles instead of `replaceChildren`, so an open editor keeps its node, draft and focus. The drag grip is 28px wide to give titles room. Story seeds/timers and world meta markers follow `visual.icons`; `panel.js` has no emoji markers.
- T10: ring entries are now capped per message (`keep` messages × ≤ 6 swipes), so `ring.length` can exceed `keep`; use `SWIPES_PER_MESSAGE` from `src/store.js` in size estimates. `settings.role` maps through `ROLES` (`src/settings.js`) to 0/1/2 in `publish()`; the clearing call carries the same role. Whether `user` actually stops a given main model from echoing the block is unverified live (hand-off §6 question 1 is still open).
- T24: `recordStatHistory(data, sectionId, items, mesId)` in `src/store.js` writes `history[sectionId][itemKey]` (key
  trimmed; only items with a finite numeric `max`; lines whose key is absent from `items` are deleted, an empty section
  key goes; a non-array value or a missing mesId writes nothing). `run.js` calls it for every enabled `custom` section
  of shape `stats` (built-in pack sections and custom blocks) right after the bond `recordHistory`, and in `editState`
  for such a section. `editSections` (T23) did not exist on this branch: when it lands, call `recordStatHistory` for each
  stats section it touches (same rule as `editState`). The drawer now passes `{ mesId, value }` points as `spec.history`
  (was bare values) and `sparkline()` keeps the pick per row key in a Map per chat store (a WeakMap on `view.store`), so
  a pick survives re-renders and new points (matched by mesId) but not a chat switch; a pruned point clears it. The
  sparkline is `role="button"`, `tabindex=0`, aria-label `spark.history`; the label is `div.st-sable-spark-label`
  (`aria-live="polite"`) right after it inside the summary (grid row 3, columns 2…4), and both swallow the click so the
  row does not fold. A die (stats `%` rows) is inserted before the sparkline so it keeps the first column. ←/→ with no
  pick start at the newest bar and only move the label; Enter (and Space) jump. The 36 px hit area is real layout
  (`height: 36px; padding: 10px 0; margin-top: -7px`, the top padding sitting in the empty space under the bar). The
  `visual.sparklines` label and the new `visual.sparklinesHint` are overridden in the `// T24` block at the end of
  `src/i18n.js` (the old values on the Round 3 lines are dead). `test/effects.test.mjs` now ends the "Full" CSS block
  at the first `/* T<n> */` marker, so task blocks appended at the end of `style.css` are not read as full-only rules.
