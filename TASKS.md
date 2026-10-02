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

## T13 — Edited replies: stale state leaves the injection and the base  [ ]
SPEC §4 (2 Oct 2026 live report: the user trims the end of a reply, sends the next message, and the
main model still gets the state computed from the deleted text). A stale entry (the latest reply was
edited) stays in the drawer with the ↻ hint, but `publish()` injects the entry before it and `prepare()`
takes that earlier entry as the base, so the next run recomputes from the edited text. New
`settings.recomputeOnEdit` (boolean, default false; Context group, ru «Пересчитывать после правки
ответа», en "Recompute after editing a reply") starts one run right after the edit. Done when: tests show
the injection switching to the earlier state after `MESSAGE_EDITED` and back after a refresh, the next
run's request carrying the earlier state as its previous state, the drawer still showing the stale entry
with the hint, and the setting firing exactly one run per edit.

## Notes from previous tasks
(append here)
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
