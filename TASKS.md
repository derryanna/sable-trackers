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

## Notes from previous tasks
(append here)
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
