# Sable Trackers — spec (v1)

A SillyTavern extension that keeps a running **scene state** for roleplay chats:
world, off-screen people, open threads, NPC moods/thoughts/relationship scales,
new-NPC dossiers, a light story planner and a repetition ban list.

The state is written by a **cheap side model** (for example Gemini Flash) in a
separate request after each character reply. The main (expensive) model never
writes trackers; it only receives a compact text digest of the sections the user
chose to inject.

Look and feel: a side drawer with foldable section cards (similar to the
"Megumin Trackers" drawer in Megumin Suite, see `docs/drawer-reference.jpg`),
plus a small panel under the latest reply.

Target: SillyTavern 1.19.x, chat-completion connection profiles, desktop and
**mobile Chrome** (the main user is on a phone).

---

## 1. Why (design goals, in priority order)

1. **Token-efficient.**
   - Side model reads: previous state + the last few messages (default 4), plus
     short card info and only the lorebook entries that were activated in the
     last main generation. Never the whole chat, never the whole lorebook.
   - Only sections that are ON are requested from the side model.
   - Only sections in `inject` mode go into the main prompt, as compact text,
     not JSON.
   - Slow-moving sections (planner, dossiers) update only when due.
2. **User control.** Every section has a mode: `inject` / `show` / `off`,
   switchable from the drawer card header in one tap.
3. **No chat bloat.** State lives in `chat_metadata`, a small ring of the last
   few states. Nothing is written into `message.extra`, and `mes` is never
   modified.
4. **Coexistence.** Must not touch ExtBlocks settings, legacy `sable_*` extras,
   or other extensions. Legacy data is read once for seeding (see §9).

---

## 2. Sections

Section registry in `src/sections.js`. Each entry has: `id`, `icon`,
`title` (i18n key), `defaultMode`, `period` (update every N character replies;
`0` = event-driven), a JSON schema fragment, prompt instructions (for the side
model), `render(state)` for the drawer, and `digest(state)` for injection.

| id | What it holds | default mode | period |
|---|---|---|---|
| `world` | time, location, weather (only if known), one-line summary; user-character block: outfit, position, visible condition, carrying | inject | 1 |
| `offscreen` | absent known NPCs: `{name, doing}` one line each, max 8. The line says what they are doing now **only if established or strongly implied**, otherwise their last known activity | show | 1 |
| `threads` | open questions and conflicts: `{text, priority: high\|mid\|low}`, max 6 | inject | 1 |
| `story` | 🌱 seeds `{text, planted_turn}` (planted, not yet paid off, max 6); ⏳ timers `{text, due}` (in-world deadlines, max 4); `arc_phase`, `scene_phase` (short labels) | inject | 1 |
| `npcs` | per NPC: `id, name, present, outfit, position, mood, agenda, action, wants_toward, secret, truth` | inject | 1 |
| `thoughts` | per present NPC: private first-person thought, ≤30 words (≈ "NPC Inner Chatter") | show | 1 |
| `bonds` | per NPC: `toward` + scales 0–100 or null: affection, trust, desire, love, reputation, suspicion, respect, fear, grudge, tension; plus `changes` (only changed scales: `{delta, reason}`); built-ins can be switched off and custom scales added in the «Шкалы отношений» / "Bond scales" settings group (§20) | inject | 1 |
| `dossiers` | one dossier per NEW named NPC: `{name, role, look, voice, hook}`, each ≤1 sentence; written once when the NPC first appears, never rewritten | show | 0 (only when a new NPC appears) |
| `planner` | 2–3 possible next beats `{beat, why}` and one "don't forget" line | show | 5 |
| `banlist` | phrases/rhetorical patterns the main model overused in the last replies: `{pattern, example}`, max 8, oldest dropped first | inject | 3 |

`thoughts` and `bonds` are split from `npcs` on purpose. Thoughts leak easily
into prose and the scales are the heaviest part, so each gets its own switch.

The rules text for each section should be adapted from the legacy prompt
(the legacy side-model prompt, Russian, kept outside this repository). It is canon-safe: no invented
facts, unknown stays unknown, desire = null for minors, max ±10 per reply except
for major events, no automatic affection growth, keep stable NPC ids, absent NPCs
keep their last known data. Keep those rules.

Modes:
- `inject`: requested from the side model, shown in the drawer, digested into
  the main prompt.
- `show`: requested and shown, not injected.
- `off`: not requested, not shown (card collapsed, greyed, with an "off" chip),
  not injected. The last value is kept in the state, so switching back on
  does not lose history.

Mode is stored **globally** in `extension_settings.sableTrackers.sections[id].mode`,
with an optional **per-chat override** in `chat_metadata.sableTrackers.modeOverride[id]`.
The drawer toggle writes the per-chat override when "this chat only" is ticked
in settings (default: global).

---

## 3. Generation flow

Trigger: `eventTypes.MESSAGE_RECEIVED` for a non-user, non-system message
(ignore `is_system`, ignore when `chat.length === 0`, ignore group chats in v1),
and only if the extension is enabled and a connection profile is set.
Debounce: one run per message id; a newer trigger aborts an older in-flight run
(`AbortController`).

Build the request (`src/prompt.js`, pure function):

```
system:  REGISTRAR RULES (common) + rules for due & enabled sections
         + output format: exactly one <sable_state>{JSON}</sable_state>, JSON keys = section ids
user:    CARD: {{char}} description/personality/scenario, truncated to settings.cardChars (default 6000)
         PERSONA: {{user}} persona, truncated to 1500
         LORE (activated last turn): entries from WORLD_INFO_ACTIVATED, truncated to settings.loreChars (default 4000)
user:    PREVIOUS STATE: JSON of enabled sections only (+ list of existing dossier NAMES, not bodies)
user:    LAST MESSAGES: last settings.messages (default 4) chat messages, oldest first,
         each prefixed "[{{user}}]" / "[{{char}}]" or the speaker name,
         cleaned by src/clean.js (see below)
```

`src/clean.js` strips `<plan>…</plan>`, `<think>…</think>`, `<checklist>…</checklist>`,
`<Blocks>…</Blocks>` (and unclosed tails of these), `<details>…</details>`,
HTML tags, and collapses whitespace. Unit-tested.

Due sections: `period === 1`, or `turnsSince(section) >= period`, or for
`dossiers`: always requested **only as** "add dossiers for named NPCs that appear
in LAST MESSAGES and are not in the existing names list; return [] if none".
It costs a few tokens, and the body is produced once per NPC.

Call: `SillyTavern.getContext().ConnectionManagerRequestService.sendRequest(profileId, messages, settings.maxTokens, custom, override)`
(default maxTokens 3000, `custom = { stream: false, extractData: true, includePreset: false }`).
`override` caps the model's reasoning (setting `reasoning`, default `low`): `{ reasoning_effort, custom_include_body }`
with the OpenRouter-style `reasoning: { effort }` in the body for custom endpoints; `auto` sends `{}`. Thinking models
(GLM, Gemini, Kimi) otherwise spend the whole output limit on reasoning and return no state (`finish_reason: length`).
`profileId` comes from the connection profile picked in settings
(`extensionSettings.connectionManager.profiles`). Result content = string; also
handle `{content}` objects.

Parse (`src/parse.js`, pure): take the text between `<sable_state>` tags (or the
largest `{…}` if the tags are missing), strip code fences, tolerate trailing
commas, `JSON.parse`. Validate each section with its schema fragment and coerce
types: numbers 0–100 clamp, unknown keys dropped, strings trimmed to limits,
arrays capped. Invalid section → keep previous value and log a warning. Never
throw to the UI.

Merge (`src/merge.js`, pure): new state = previous state, with every section
that was requested AND valid replaced. `bonds.changes` is recomputed from the
previous vs new numbers (the model's `reason` is kept when the delta sign
matches, otherwise the change reads "(recomputed)"). Dossiers are append-only by
name. Banlist keeps the newest 8. Keep `meta: {turn, updatedAt, forMesId, forSwipeId}`.

---

## 4. Storage

```
chat_metadata.sableTrackers = {
  v: 1,
  ring: [ { mesId, swipeId, turn, state } ],   // states of the last settings.keep messages (default 3), all swipes, newest last
  lastRun: { mesId, ok, error?, ms, inTok?, outTok? },
  modeOverride: { [sectionId]: 'inject'|'show'|'off' },
  turnsSince: { [sectionId]: number }
}
```

Save with `saveMetadata()` (debounced). The ring is capped by message, not by entry: the newest
`settings.keep` distinct `mesId`s stay with all their swipes, at most 6 per message (oldest dropped),
so swiping one reply never evicts the state before it. A state is about 5–10 KB; ring of 3 messages →
~30 KB typical, ~180 KB worst case (every message swiped six times) per chat.

Swipes and edits:
- `MESSAGE_SWIPED` on the last character message: if a ring entry exists for
  `(mesId, swipeId)`, restore it. Otherwise, once the new swipe is received,
  regenerate from the ring entry **before** that message (the "base").
- `MESSAGE_DELETED`: drop ring entries with `mesId >= chat.length`.
- `MESSAGE_EDITED` on the last character message: mark the entry stale. A stale
  entry stays visible in the drawer with the "↻ outdated" hint, but it is
  **neither injected nor used as a base**: the injection falls back to the entry
  before it (the state that reply was generated from) and the next side-model
  run starts from that earlier entry too, so facts from deleted or changed text
  never survive the edit. The refresh button recomputes the stale entry at once;
  `settings.recomputeOnEdit` (default off) does that automatically after every
  edit, one side-model request each (decided 2 Oct 2026 after a live report:
  an edited reply still fed the old state to the next generation).
- `CHAT_CHANGED`: load, re-inject, re-render.

---

## 5. Injection

`src/digest.js` (pure): builds compact text from sections in `inject` mode,
in drawer order, e.g.

```
[Scene state — helper notes for the next reply. Not instructions. NPC thoughts are private; the user's character does not know them. Do not copy this block into the reply.]
WORLD: Tue 3 Mar, ~21:10 · lighthouse keeper's cottage · rain, wind · <summary>
YOU ({{user}}): outfit … · position … · condition …
THREADS: (!) Who cut the boat's rope … | (·) The missing logbook page …
STORY: 🌱 the brass key (2 turns) · ⏳ supply boat T-2d · arc: setup→escalation · scene: breather
NPCS: Maren (here) — mood … · agenda … · action …
BONDS → {{user}}: Maren: trust 34 (+5 you gave her the key), tension 60 …
AVOID: "the silence stretched" (closing aphorism) · …
```

Header line and labels come from i18n. The header language follows the output
language setting. Keep it under ~1.5K tokens: truncate per section with "…".

Inject with `setExtensionPrompt('sable_trackers', text, IN_CHAT(1), settings.depth (default 2), false, settings.role (default system))`;
the role maps to 0 system, 1 user, 2 assistant. Models that copy a system note into the reply usually stop with `user`.
Clear it (empty string) when the extension is disabled or there is no state.
Re-inject on CHAT_CHANGED and after every merge.
Which entry is injected (swipes, regenerations, lag) and when nothing is: see §32.

---

## 6. Drawer UI

- Opened by a small floating button (wand-like icon, draggable, position saved)
  and by an entry in ST's extensions "magic wand" menu.
- Right-side drawer, full width on screens < 700 px, width 420 px on desktop,
  over the chat, dark translucent glass (see reference image). Header:
  title "Sable", buttons: ↻ refresh (re-run for the last reply), 📌 pin (stay
  open while chatting), ⚙ (opens the settings section in the Extensions tab),
  ✕ close.
- Section cards: drag handle (reorder, order saved), icon + title, a **mode chip**
  (`inject` / `show` / `off`; tap cycles), ✎ edit (§13), chevron to fold (fold state saved).
  Empty card body shows "—". Title icons and list/meta markers (🌱 ⏳ 🕒 📍 🌦️) follow
  `visual.icons`: Font Awesome by default, emoji on request.
- Enabled packs (§15) are one **group** each: a container with the same header row (handle,
  pack glyph + title, an aggregate mode chip, fold) and the pack's cards nested inside; built-in
  and custom cards stay flat unless placed in a folder.
- User folders (§18) group existing built-in and custom cards with a shared fold and mode chip.
- `settings.layout = 'people'` (§21) shows the four NPC-keyed sections as one «Люди» group of person cards.
- Status line at the bottom: last run time, ok/error, token estimate
  (chars/4 if the API gives no usage).
- Renders with plain DOM + template strings. No framework. Escape all
  model-produced text (it is untrusted); no `innerHTML` with raw values.
- Must not slow down typing on mobile: re-render only on state change.

Per-section rendering (short):
- world: two lines + user-character line.
- offscreen: list "Name — doing".
- threads: list with a coloured dot per priority (red/amber/grey).
- story: 🌱 list with "(N turns)", ⏳ list, two phase chips.
- npcs: one foldable row per NPC (present first; absent folded), mood in summary.
- thoughts: italic quote per present NPC.
- bonds: per NPC small bars for known scales (null hidden), delta badges +/−
  with reason on tap.
- dossiers: foldable card per NPC.
- planner: numbered beats.
- banlist: chips.

## 7. Panel under the latest reply

A compact strip appended after `.mes_text` of the **last character message
only** (removed from the previous one): world line + present NPCs with mood +
bond deltas of this turn. Tap opens the drawer. It is DOM-only and never saved into
the message. Hide it with a setting.

## 8. Settings (Extensions tab, `settings.html` or built in JS)

enabled · connection profile (select) · output language (default Russian) ·
model reasoning (`auto` / `low` / `min`, default `low`) ·
messages (4) · cardChars (6000) · loreChars (4000) · maxTokens (3000) · depth (2)
· keep (3) · per-section mode + period · per-chat overrides toggle · show bottom
panel · floating button on/off · "Seed from legacy Sable" button.
Defaults live in `src/settings.js`; missing keys are filled on load.

## 9. Legacy seeding

If a chat has no `chat_metadata.sableTrackers` but the last character messages
carry the legacy state (see `docs/LEGACY-SABLE-RENDER.md` for where it lives,
e.g. inside `extra.extblocks`), convert it once into ring[0] and map
`world`/`threads`/`npcs`/`thoughts`/`bonds` from the v2 JSON. Only on the button or
the first open of the drawer, never automatically on chat load. Read-only on
the legacy data.

## 10. Non-goals for v1

Group chats · image generation · streaming the
side-model reply · text-completion APIs (v1 supports chat-completion profiles
only; show a clear error otherwise).

### Legacy data shape (verified on real chats, content replaced by synthetic)

`fixtures/legacy-message.json`. The v2 JSON sits inside `<sable_state>…</sable_state>` in
`message.extra.sable_scene_v2.normalized` (preferred, already normalized) and in
the raw string `message.extra.extblocks` next to other blocks (`<image_local>`,
`<sable_panel>`). The same keys may exist in `swipe_info[swipe_id].extra`; use the
active swipe. v2 → v1 mapping: `world.*` → `world`; `world.threads[]` (strings)
→ `threads` with priority `mid`; `npcs[].{outfit,position,mood,agenda,action,wants_toward,secret,present}`
→ `npcs`; `npcs[].thought` → `thoughts`; `npcs[].{toward,stats,changes}` → `bonds`;
drop `usage`, keep `legacy_stats` if present inside bonds.

---

## 11. Custom sections (user-defined blocks)

`extension_settings.sableTrackers.customSections` is an array; each item:

```
{ id: 'c_1a2b3c4d',            // 'c_' + 8 hex, generated once, never changes
  title: 'Улики',              // shown in the drawer and used as the digest label (upper-cased)
  icon: '🔍',                  // one emoji or a Font Awesome class ('fa-magnifying-glass')
  instructions: '…',           // what the side model must track, written by the user
  shape: 'text' | 'list' | 'kv', // text = one string ≤ 600 chars; list = up to `max` strings ≤ 200;
                               // kv = up to `max` { key, value } pairs (key ≤ 60, value ≤ 200)
  max: 8,                      // list/kv cap (1–20)
  mode: 'inject' | 'show' | 'off',
  period: 1 }                  // like built-in sections
```

Rules: custom sections behave exactly like built-ins: requested from the side model only when on and due, validated by shape, merged as a full replacement, shown as a drawer card (with mode chip, fold, reorder), digested as `TITLE: …` (text), `TITLE: a | b | c` (list) or `TITLE: key: value · key: value` (kv). Their ids may appear in `settings.order` and in `chat_metadata.sableTrackers.modeOverride`. Removing a custom section drops it from prompts and the drawer; its old values stay in stored states harmlessly. The registry becomes `getSections(settings)` = built-ins + custom; every pure function accepts an optional `sections` list and defaults to the built-ins, so existing tests keep working.

## 12. Visual settings

`extension_settings.sableTrackers.visual`:

```
{ opacity: 0.93,      // panel background alpha 0.5–1
  blur: 14,           // px 0–30
  fontSize: 13,       // px 12–16
  widthVw: 80,        // phone panel width 60–100 (vw)
  accent: '#f5f4ee',  // left accent bar / active chip colour
  base: null,         // panel colour '#rrggbb'; null = dark glass rgb(14,14,18)
  text: null,         // text colour '#rrggbb'; null = theme text (no base) or the base ink
  icons: 'fa' | 'emoji', // section title icons
  radius: 18,         // card corner radius 8–24
  bgImage: null,      // panel background: base64 png/jpeg/webp data URL or http(s) URL; null = none
  bgDim: 0.45,        // wash of the base colour over the picture 0–0.9
  bgFit: 'cover' | 'contain' | 'tile',
  effects: 'subtle',  // 'off' | 'subtle' | 'full' (§16); the old `motion` boolean migrates false → off, true → subtle
  fx: { … },          // the composable full-level effects, see §16
  cardFill: 0.05,     // card tint alpha on the ink 0–0.3
  border: 0.13,       // card border alpha 0–0.5; dividers use half of it
  titleFont: 'theme' | 'serif' | 'mono' | 'rounded', // panel and card titles
  titleWeight: 700,   // 500–800, step 100
  chipStyle: 'filled' | 'outline', // the active «в промпт» chip
  accentBar: true,    // the left accent bar on cards
  sparklines: true,   // history sparklines under bond scales (§22)
  spacing: 'cozy' | 'compact' }
```

The drawer applies these as CSS custom properties on the drawer element and the edge tab (`--st-sable-opacity`, `--st-sable-blur`, `--st-sable-font`, `--st-sable-width`, `--st-sable-accent`, `--st-sable-radius`, `--st-sable-card-fill`, `--st-sable-border`, `--st-sable-title-weight`, `--st-sable-bg-dim`); `style.css` reads them with the defaults above as fallbacks. Choices become data attributes that exist only while they differ from the default: `data-st-sable-title-font`, `-chip`, `-accent-bar="off"`, `-spacing`, and on the drawer only `data-st-sable-bg="1"` and `-fit`; the effects level is always present as `data-st-sable-effects` (§16). `icons` switches the title icon element. Missing keys are filled from defaults on load (settings.js); numbers are clamped and rounded to their slider step (`VISUAL_RANGES`), choices outside `VISUAL_CHOICES` and non-boolean flags fall back to the default; `accent`, `base` and `text` accept `#rrggbb` or `#rgb`, anything else becomes the default.

Background: `normalizeBgImage` accepts only `data:image/(png|jpeg|webp);base64,…` or `http(s)://…` without whitespace, quotes, parentheses, backslashes or angle brackets, at most about 900 KB; anything else is `null`, so the value is safe inside CSS `url("…")`. The settings UI shrinks a chosen file with a canvas to 1280 px on the long side (JPEG, quality 0.82, transparent parts filled with the base) and refuses a result over about 600 KB. The picture lives in extension settings, so every device that shares `settings.json` shows it. It is a `::before` layer of the drawer (the drawer is its containing block, with explicit top/left/right/height; `z-index: -1` puts it over the panel fill and under the cards, and it does not scroll with them), painted as `rgba(base, bgDim)` over the image. With a picture the cards, the header and the status line get a base-coloured backing so text stays readable on a busy picture. The edge tab never gets the picture.

Motion: at most 200 ms, transform/opacity only. The panel and tab slide in; a card body unfolded in place fades and slides in via a registered `--st-sable-reveal` number transitioned on the card (a card rebuilt by a full render has no previous style, so re-renders never replay it; `@starting-style` would replay on every card); buttons and the tab scale to 0.97 while pressed; a freshly rendered status line fades in unless focus is on a card control. The `off` level and `prefers-reduced-motion` switch all of it off (§16).

Themes (`src/themes.js`, pure): a theme is the whole `visual` object. Export writes `sable-theme.json` = `{ format: 'sable-theme', version: 1, visual }` (the background data URL included). Import accepts that file or a bare visual object, runs it through `normalizeVisual` (unknown keys dropped) and rejects text that is not JSON or has no visual key. Presets are partial visual objects over the defaults — Стекло (the defaults), Бумага (`#f4f1ea` base, `#8a6d1e` accent, serif titles, no blur, opacity 0.98), Неон (`#0b0b14` base, `#b388ff` accent, outline chip, mono titles, border 0.16) — and keep the user's `bgImage`, `bgDim`, `bgFit`, `effects`, `fx`, `fontSize`, `widthVw` and `cardColors`. The preset select shows the preset the look matches, or «свой» after a tweak.

Colours: with a `base`, the panel is `rgba(base, opacity)` (`--st-sable-base-rgb`) and the **ink** (`--st-sable-ink-rgb`) is black or white, whichever has the higher WCAG contrast ratio on the base (relative luminance crossover ≈ 0.179). Every overlay in the drawer and tab (borders, dividers, card fills, chips, tracks, hover states) is `rgba(ink, alpha)`, defaulting to white; the text is `text`, else `rgb(ink)`, else the theme colour (`--st-sable-text`). The ink comes from the base only, never from `text`. A default accent follows the ink. Text on a solid accent fill (the `inject` chip) uses `--st-sable-accent-ink-rgb`, derived from the accent in the same way. Light bases (`data-st-sable-tone="light"`) darken status colours and give coloured dots and bar tracks a faint rim.

## 13. Manual editing

`runtime.editState(sectionId, value)` validates the value with the section schema (`sanitizeSection` in `parse.js`, the same sanitizer as model output) and replaces that section in the current ring entry (`currentEntry`). With no entry yet, it creates one for the last character reply. It sets `state.meta.editedAt`, clears `stale`, cancels an in-flight side-model run (the edit wins), re-injects and saves. It returns `false` for an unknown section, an invalid value, or a chat without a character reply.

The drawer editor is generated from the schema, so built-in and custom sections share it:
- strings become text inputs (a textarea with 2 rows when the limit is 240 or more);
- `integer` and `score` become number inputs (0–100 for scores, clamped; an empty score is `null`);
- `enum` becomes a select, `boolean` a checkbox;
- arrays get one row per item with ✕ and a «+» capped at the schema max;
- nested objects recurse, and `changes` is read-only (recomputed on the next run);
- `id` next to `name` is read-only, and new rows derive it from the name.

An open editor keeps its node, draft and focus across runtime renders (only its header refreshes). It warns when its section changed underneath. Opening, cancelling and editing rows touch only that card.

`editState` is a wrapper over `runtime.editSections(values)` (§25), the batched all-or-nothing write that the person card form uses.

## 14. Danger zone

Settings contain `prompts: { rules: null, sections: {} }`. Rules replace `COMMON_RULES` (up to 4000 characters); built-in section ids map to replacement instructions (up to 2000 characters). Values are trimmed; empty or default values are removed, unknown ids dropped. Normalization is idempotent. Partial patches merge section overrides; `null` removes one. Custom blocks keep their own instructions. `getPromptTexts(settings, sections = SECTIONS)` returns effective `{ rules, sections: { [id]: instructions } }`. The language line, output envelope, key list and JSON schema remain fixed.

`runtime.preview()` returns `{ mesId, messages, requestedSections, chars }` for the last character reply, forcing every enabled section due just like Run now. It shares request preparation with execution, sends nothing, does not write metadata, cancel or publish, and returns `null` for disabled extensions, group chats or missing character replies.

`snapshot().log` contains newest-first runtime entries, capped at `LOG_LIMIT = 5`:
`{ at, chatId, mesId, swipeId, ms, status, requestedSections, validSections, warnings, error, request, response, inChars, outChars }`.
Statuses are `ok`, `invalid`, `failed`, `dropped` (including cancellation) and `skipped` (nothing due; request and response are null). Request is the exact messages array sent; response is the raw service text, even when invalid. Errors use `String(error?.message ?? error)` and parse warnings are retained. Entries are recorded before the completion publish; timestamps uniquely identify rows. `runtime.clearLog()` empties the log and publishes. Chat switches retain it.

No log is persisted to chat metadata or extension settings: requests contain card and chat text, while settings may be shared between devices. Reload loses the log. The closed Danger zone settings group offers instruction resets, text-only preview/copy, and expandable request/response entries with copy, explicit JSON download and clear. Expanded log rows survive publishes. All diagnostic content is untrusted text and rendered with `textContent`.

## 15. Packs (draft)

A pack is a named bundle of sections plus extra side-model rules for one kind
of scene: a fight, an intimate scene, an investigation. Packs are **off by
default** and switched **per chat** from the drawer, so a quiet chat costs
nothing and a fight chat gets its own cards for as long as the fight lasts.

```
{ id: 'combat',                 // built-in: [a-z][a-z0-9]{1,15}; user pack: 'p_' + 8 hex
  scope: true, scopeDefault: 'all', // optional scope choice; intimacy defaults to 'others'
  title: 'Бой', icon: 'fa-hand-fist' | '⚔️', description: '…' (≤ 300),
  rules: '…',                   // ≤ 2000 chars, appended to the common rules while the pack is on
  sections: [ { key: 'stats', title, icon, instructions, shape, max, mode, period } ] }  // ≤ 8
```

A pack section is a custom section (§11) whose id is `${packId}_${key}`
(`key` = `[a-z][a-z0-9]{0,15}`), so `combat_stats` is a JSON key the side model
returns, a card in the drawer, an entry in `settings.order`, `settings.folded`,
`settings.cardColors` and `chat_metadata.sableTrackers.modeOverride`. Two new
shapes exist for packs and for custom sections alike:

- `stats`: up to `max` items `{ key ≤ 40, value: integer 0–9999, max: integer 1–9999 | null,
  unit ≤ 8, note ≤ 120 }`. With `max` the item is a bar (like a bond scale);
  with `null` it is a plain counter. Merge writes `delta` = new value − the
  previous value with the same key (missing before → no delta); the model never
  sees `delta` and the sanitizer drops it from model output. Digest:
  `TITLE: HP 40/100 (−12 blade cut) · stamina 70/100 · climaxes 2`.
- `tags`: up to `max` strings ≤ 40, rendered as chips (like the ban list),
  digested `TITLE: bleeding · stunned`.

Storage: built-in packs are pure data in `src/packs/<id>.js` (titles and
descriptions through i18n, instructions in English like the built-in sections).
User packs live in `extension_settings.sableTrackers.packs` (array, normalised
like `customSections`). Per chat: `chat_metadata.sableTrackers.packs` = array of
enabled pack ids; a chat without the key uses `settings.packDefaults` (array,
default `[]`). `getSections(settings, enabledPacks)` = built-ins + custom + the
sections of enabled packs; every pure function keeps its optional `sections`
argument. Pack section modes and periods default to the pack's values and are
overridden in `settings.sections[id]` exactly like built-ins (the normaliser
keeps ids of known packs only). A section of a pack that is off is not
requested, not shown and not injected; its last values stay in the ring.

Prompt: while any section of a pack is due, `pack.rules` is appended after the
common rules (once per pack, in pack order). The language line, envelope and
schema stay as in §3.

Export/import: `sable-pack.json` = `{ format: 'sable-pack', version: 1, pack }`,
handled like themes (`src/packs/io.js`, pure): unknown keys dropped, ids of
user packs regenerated on import when they collide, built-in ids refused.

Drawer: a 🎒 button in the header opens a sheet listing packs with a switch each
(tap targets ≥ 36 px). Switching on adds the pack to the cards list as **one
group** (`section.st-sable-group[data-pack]`, after the existing cards unless
`settings.order` says otherwise) and triggers no run by itself; the next reply or
↻ requests them. Switching off removes the group and clears their injection.
The group header has the same look and height as a card header and at most four
controls: the drag handle, the pack glyph and title (`packTitle()`: the "18+"
mark becomes a badge), a **group mode chip** and a fold chevron; the pack switch
stays in the sheet. The pack's cards are nested inside as ordinary cards (own
mode chip, fold, editor, colours, keyed rows, change dots), visually lighter:
no own glass fill, hairlines between them, a small indent. The group chip shows
the members' common mode, or «смешано» / "mixed" when they differ; its menu is
the card menu and writes every member at once through
`runtime.setPackMode(packId, mode)` (the same per-chat override semantics as
`setMode`, one settings or store write, one render). The group fold is
`settings.folded['pack:<packId>']`; a folded group hides its members, a member's
own fold works inside an open group. With `hideOff` an off member hides inside
its group and counts in «Скрыто: N»; a group whose members are all off hides
entirely until the reveal row shows it. `settings.order` stays a flat list of
section ids; the drawer reads it through `groupedOrder(order, sections, packs)`
(`src/sections.js`, pure): a pack's ids form one contiguous block placed where
the first of them appears, in their existing relative order, or at the end for
a pack with no entry. The group handle (drag or ↑/↓) moves the block among the
flat cards; a member handle moves it inside its group only. The digest and the
Sections settings table keep the raw order. Group and member containers persist
across renders like cards (§16).
Settings: a "Packs" group with the same list, "default for new chats" ticks,
export/import and a user-pack editor that reuses the custom-block editor plus
title/icon/description/rules fields.

Editing: built-in packs are data, so a "Make a copy" button turns one into a
user pack (`p_` id, same sections, titles copied into literal strings) that the
editor changes freely. Built-in packs themselves are tuned without copying:
their section instructions are overridden through `prompts.sections[id]` and
their rules through `prompts.packs[packId]` (≤ 2000 chars), both in the Danger
zone with the same reset buttons as §14. Section modes, periods, order and
card colours of a built-in pack are ordinary settings.

Scope: a pack may declare `scope: true` together with a `scopeDefault` of
`all` | `user` | `others`; the user then picks per pack
(`settings.packScope[packId]`, default = the pack's `scopeDefault`) whether
per-participant sections track everyone present (`all`), only `{{user}}`
(`user`) or everyone except `{{user}}` (`others`). The prompt builder replaces
`{{scope}}` in the pack's instructions with the matching sentence; for `others`
the sentence also says that the user's character's state, feelings and
responses are never recorded or implied. Combat declares `all`, intimacy
declares `others`: the user's own part of an intimate scene is theirs to play,
and a tracker line about their arousal would push the main model to write it
for them (decided 2 Oct 2026).

Dice (an integration, not a card; decided 2 Oct 2026): a `stats`/`kv` item
whose key ends in "%" (e.g. `crit %`) gets a 🎲 button on its row, in any pack
or custom section. The tap rolls d100 locally (`roll(chance, random)` pure,
`crypto.getRandomValues` in the runtime), never calls a model, and stores the result
as `chat_metadata.sableTrackers.roll = { sectionId, key, label, chance, roll,
hit, forMesId, at }` (one pending roll per chat, the newest wins). The row shows
the result inline next to the button (`87 → miss`, highlighted while pending)
and the digest ends with one line, `ROLL: 87 vs crit 15 → miss (resolve the
next action with it)`, for the next generation only: when a character reply
arrives after `forMesId`, the roll is consumed, the line leaves the injection
and the row keeps the last result greyed out until the next roll. There is no
roll section and no roll card; nothing else in the extension rolls or decides.
Consumption sets `consumedAt` and `consumedBy` on the stored roll; swipes of that reply temporarily re-inject the same result and highlight the row until receipt, a new user message, deletion, chat change or a new roll, without consuming it twice.
Deleting back below `forMesId` clears it. `runtime.preview().injection` shows
the current main-prompt digest, including the pending roll within its size cap.
The intimacy pack has no "%" rows and its description does not mention dice.

Built-in packs for v1 (content is a task; shapes are fixed here):
- `combat`: `combat_scene` (text: who fights whom, phase, terrain, range),
  `combat_stats` (stats per participant: `Name · HP`, `Name · stamina`, max 12),
  `combat_effects` (tags: wounds and conditions, max 10), `combat_odds`
  (kv: `crit %`, `hit %`, initiative, max 6). Rules: no
  damage without a described hit, numbers move only for shown events, death
  only when written.
- `intimacy` (18+): `intimacy_scene` (text: position, pace, who leads, consent
  state), `intimacy_arousal` (stats per participant: arousal 0–100 as a labelled estimate in any scene, stamina),
  `intimacy_counters` (stats with `max: null`: climaxes, minutes, volume in ml,
  max 8), `intimacy_marks` (tags: visible marks and state, max 10), plus two
  playful cards whose default mode is `show` (visible, not injected):
  `intimacy_achievements` (tags, max 8: video-game style badges unlocked only
  for explicit events, kept across replies) and `intimacy_commentary` (text: one
  or two tongue-in-cheek sentences in a voice picked for the moment, such as a
  sports commentator or a nature documentary). Rules keep
  the canon guard from §2 unchanged: every participant must be an established
  adult, otherwise the pack returns empty values; nothing is invented.
- `intimacy_plus` (18+): a deeper, explicit companion to `intimacy`, enabled alone or on top of it;
  seven sections (`climax`, `contact`, `zones`, `kinks`, `limits`, `experience`, `after`), see §23.
- Candidates for later: `investigation` (clues, suspects, leads),
  `survival` (hunger, cold, supplies), `travel` (route, days, provisions).

Decisions (2 Oct 2026): the pack switch lives in the drawer header (🎒 sheet) and
in the Packs settings group, there is no chip row above the cards; the intimacy
pack is listed with the others, marked "18+" in its title and description, with no
separate gate; the dice button appears only on rows whose key ends in "%".

## 16. Live cards (draft)

Taste differs, and the repository is public, so motion is a **level the user
picks**, not a rule. `visual.motion` becomes `visual.effects`: `off` | `subtle`
(default) | `full`; the old boolean maps `false → off`, `true → subtle` on load.
`prefers-reduced-motion` forces `off`. Whatever the level: plain DOM, no
canvas, no libraries, nothing renders on a timer while the user types, and
every effect is a CSS transition or a short `requestAnimationFrame` run that
stops when the drawer is hidden.

`subtle` (cheap, on by default):
- **Bars move.** The bar fill is `transform: scaleX(value)` with a 180 ms
  transition, so a bond or pack stat slides to its new value instead of
  jumping. Rows are reconciled by key (NPC id + scale, or stat key) so the
  node survives the render; a brand-new row appears at its value without
  motion.
- **Changes flash.** A row whose value changed since the previous ring entry
  gets `data-st-sable-changed` for one render: the delta badge fades in and
  the accent bar of the card brightens for 300 ms. A card with any change gets
  a dot after its title until it is unfolded or the next run.
- **Tap for the why.** Delta badges already open the reason; stat rows with a
  `note` do the same. Tag chips and the dice button are the only other
  controls inside a card body, so taps on text keep folding the row.

`full` (everything above, plus a set of **effects the user composes**; shipped as
`visual.fx`, every effect with its own switch and knobs, all of them off until the
user turns them on):
- **Glow** (`fx.glow`): cards and bars glow in a chosen colour (default = accent)
  with an intensity slider; a card that changed pulses its glow once.
- **Shimmer** (`fx.shimmer`): a slow highlight runs across bars and the drawer
  edge; knobs: speed (slow / medium / fast) and colour (default = accent).
- **Rain** (`fx.rain`): a translucent rain overlay behind the cards; knobs:
  density, colour, angle. CSS only (layered animated gradients or at most three
  absolutely positioned layers), no canvas.
- **Numbers tick** from the old value to the new one over 250 ms.
- **Stat colour follows the value**: a bar with `max` shades from the accent
  towards the friction tint as it drops, and pulses slowly under 20 %.
- **Dice animation**: the 🎲 button spins for 400 ms and the result row flashes;
  a crit gets a brief glow on the whole card.
- **Card glow** instead of the plain accent flash when a card changed, and the
  reply panel (§7) animates its bars too.
- Every effect is individually switchable, previews live while its slider
  moves, is persisted in `visual.fx` (settings.json, shared between devices),
  travels with theme export/import, and is killed by the `off` level and by
  `prefers-reduced-motion`. Knob ranges are clamped in `normalizeVisual`, so no
  value a user can enter breaks the drawer.

T9 is built as a comparison round: two independent implementations of this
section on two branches, reviewed side by side; the better one, or a merge of
both, lands.

The panel under the reply (§7) shows one compact line per enabled pack:
`HP 40/100 · stamina 70/100` or `arousal 65/100`, bars included, at every level.

Engineering limits that stay regardless of taste: no continuous animation
except the busy pulse and the under-20 % pulse, no layout animation (height,
width), nothing that reads the DOM on a timer, and everything gated by the
level and by reduced-motion.

## 17. Settings layout: collapsible groups

Every settings group (Connection, Context, Sections, Custom blocks, Appearance,
Actions, Packs, Danger zone) is a `<details class="st-sable-group" data-group="id">`
whose `<summary>` holds the group heading (icon + text, full width, tap target
≥ 36 px, a chevron that turns when open). Open/closed state is remembered per
group in `settings.groups` (`{ [id]: boolean }`, shared through settings.json like
`folded`); defaults: Connection open, everything else closed. The Danger zone
keeps its warning styling and its closed default. Toggling a group saves that
flag and nothing else, never starts a run, and a re-render caused by anything
else leaves open groups open. The container rules of §12 apply inside each
group unchanged. The drawer's gear (⚙) still opens the Extensions tab and
expands our block.

## 18. Folders: user groups of cards

Why (3 Oct 2026): with packs as groups (§15) the drawer reads as a short list
of blocks, and the maintainer wants the same for the ordinary cards, the way
Discord lets you create a category and drop existing channels into it: create a
group, put cards in, fold it, switch all of its cards with one chip.

### Data

- `settings.folders`: array of `{ id, title, icon, members }`, at most 12.
  `id` = `f_` + 8 hex (`newCustomId(taken, random, 'f_')`), `title` 1–40
  characters trimmed, `icon` = Font Awesome classes or a single emoji grapheme
  (the pack icon rule; `''` = default `fa-folder`, 📁 in emoji mode),
  `members` = a set of section ids (array, no duplicates, at most 20).
- Normaliser (`normalizeSettings`): drop a folder with a bad id, an empty title
  or a duplicate id; keep only members that are built-in sections or custom
  `c_` sections (never pack sections: a pack is its own group); a section id
  belongs to at most one folder (the first folder wins). Fold keys gain
  `folder:<id>`. Folders are global, like `order`; nothing is per chat.
- **One source of order.** `settings.order` stays a flat list of section ids;
  `members` is a set, and the order inside a folder is the members' relative
  order in `settings.order`, exactly as for packs. `groupedOrder(order,
  sections, packs, folders)` gets a fourth parameter (the normalised folder
  array, default `[]`): a folder's members read as one contiguous block placed
  where the first of them appears, in their existing relative order; packs keep
  their blocks; a section is in one block at most. The drawer's top-level tokens
  are section ids, `pack:<id>` and `folder:<id>`.
- A folder with no members has no position in `order`: it renders last and
  cannot be dragged; it gets a position when the first card joins it.

### Runtime (`src/run.js`)

- `runtime.setFolderMode(folderId, mode)`: every member in one settings write,
  the same per-chat override semantics as `setPackMode`.
- Create, rename, icon, delete and membership go through
  `runtime.updateSettings({ folders })` with the whole array (like `packs` and
  `customSections`). Membership changes also rewrite `order` in the same patch
  so the moved card lands at the end of the target block, or right after its old
  block when it leaves a folder.

### Drawer

- A folder renders as the same container as a pack:
  `section.st-sable-group[data-folder="<id>"]` with the header row (handle,
  glyph + title, aggregate mode chip, fold) and the member cards nested inside,
  lighter, keyed persistence as in §16, fold under `folded['folder:<id>']`.
  Packs keep `data-pack`; both kinds share one code path through a container
  descriptor (`kind`, `id`, `key`, `title`, `glyph`, `adult`, member ids, chip
  target). The pack sheet, the panel, the digest and the prompt are untouched.
- **Membership.** The footer of a flat card (built-in or custom, not a pack
  member) gets a second button «В группу…» / "Group…" (`fa-folder-plus`)
  that opens a small menu with the look and keyboard rules of the mode menu
  (`role="menu"`): one item per folder with a check mark on the current one,
  «Без группы» / "No group" (only while the card is in a folder) and «Новая
  группа…» / "New group…". Choosing a folder moves the card (it leaves its old
  folder); «Новая группа…» creates `{ title: «Группа N» / "Group N", icon:
  '', members: [cardId] }` with N = folders.length + 1 and opens that folder's
  editor with the title focused.
- **Folder editor.** A folder body ends with a footer button «Редактировать
  группу» / "Edit group" (pencil, the card footer style). It opens an inline
  form in the body: title (text, 40), icon (text, validated like custom section
  icons, with the same hint), «Сохранить», «Отмена», «Удалить группу» (two
  taps, the armed pattern of the pack delete). Deleting a folder returns its
  cards to the flat list in place; `order` is unchanged.
- **Moving.** The folder handle (and ↑/↓ on it) moves the whole block among
  the top-level items; a member handle moves inside its folder; touch drag at
  both levels, bounded by the parent, as for packs.
- **Empty folder.** Shows a hint line «Пусто. Добавьте карточку через
  «В группу…»» / "Empty. Add a card with Group…" instead of members, its
  handle disabled, placed last; the footer editor still works.
- **hideOff.** As for packs: off members hide inside their folder and count in
  «Скрыто: N»; a folder whose members are all off hides; the reveal row brings
  them back. An empty folder ignores hideOff.
- **Suggested layout.** The settings Sections group gets a button «Разложить
  по группам» / "Suggested groups". When folders already exist the first tap
  arms it («Нажмите ещё раз: текущие группы будут заменены» / "Tap again to
  replace the current groups"), the second tap replaces `settings.folders` with
  three folders: «Мир» / "World" (`fa-globe`: world, offscreen, threads),
  «Люди» / "People" (`fa-users`: npcs, thoughts, bonds, dossiers), «Сюжет» /
  "Story" (`fa-book`: story, planner, banlist). Custom sections stay flat.

### Non-goals (candidates for later)

Packs inside folders, folders inside folders, per-chat folders, dragging a card
from one container into another (membership changes go through the menu).

## 19. NPC underside: secret and truth behind a tap

Why (3 Oct 2026): the maintainer liked a community widget's per-character
"hidden secret, tap to reveal" and "true feeling on the back of the card",
and wants the same reading experience in Sable with its own names and
without the widget's mechanics (the main model writing JSON into replies).
`npcs` already carries `secret` and `agenda`; what is missing is one more
field and the spoiler.

### Data

- `npcs[].truth` (string, max 160): one short phrase, at most 12 words,
  naming what this NPC actually feels right now beneath the shown behaviour,
  grounded in canon and shown behaviour; empty when there is no basis. Added
  to the `npcs` schema after `secret`; the side-model instruction for `npcs`
  gains that sentence and one clarifying `agenda` as what the NPC is about to
  do next.
- Neither `secret` nor `truth` enters the digest (§5): the `npcs` injection
  line stays `name (here/away) — mood · agenda · action`. They exist for the
  reader and for the side model's own continuity.
- `settings.spoilers` (boolean, default `true`): secrets and truths sit
  behind a tap in the drawer. Off = plain fields, as before.

### Drawer

- In the «Персонажи» row the field order becomes: `agenda` labelled
  «Собирается» / "About to" first, then `outfit`, `position`, `action`,
  `wants_toward`. `secret` and `truth` leave the plain field list.
- When either `secret` or `truth` is non-empty and `settings.spoilers` is on,
  the row ends with a spoiler: a button «Тайна» / "Secret"
  (`data-control="spoiler"`, glyph `fa-eye-slash`, 🙊 in emoji mode,
  `aria-expanded`), tap target ≥ 36 px. Tapping reveals a `dl` with «Тайна» /
  "Secret" and «На самом деле» / "Deep down" (only the non-empty ones) and
  turns the glyph to `fa-eye`; tapping again hides it. Revealed rows are
  remembered in memory per NPC id while the same ring entry is shown; a new
  ring entry (a new reply, an edit, a refresh) hides them again, as does a
  chat change. With `settings.spoilers` off both fields render as plain fields
  after `wants_toward`, labelled the same way.
- No 🔒 / 💎 glyphs anywhere: the names and icons are Sable's own.
- The bottom panel (§7) is unchanged (it prints name and mood only). The
  manual editor (§13) is schema-driven and gets `truth` for free; its label
  comes from `field.truth`.

### Settings

- Sections group: a checkbox «Тайны и «на самом деле» за спойлером» / "Secrets
  and truths behind a tap", bound to `settings.spoilers`, placed after the
  period hint and before «Разложить по группам».

### Non-goals

A per-character layout, signed bond scales and history sparklines are
separate candidates (see TASKS.md).

## 20. Bond scales: switchable built-ins and custom scales

Why (3 Oct 2026): first outside feedback on the bonds card: one reader finds
«Репутация» and «Уважение» near-duplicates, another wants fewer scales, the
maintainer wants to add her own. Like packs, the scale set becomes a choice:
the built-in scales can be switched off one by one and custom scales added.

### Data

- `settings.bondScales = { off: [], custom: [] }`.
  - `off`: built-in scale keys switched off (subset of `BOND_SCALES`, no
    duplicates; an unknown key is dropped).
  - `custom`: at most 6 of `{ key, title, hint, friction }`. `key` matches
    `^[a-z][a-z0-9_]{1,15}$` and is not a built-in key; `title` 1–30
    characters (shown as the row label, any language); `hint` ≤ 200
    characters, one sentence telling the side model what the scale measures,
    written like the built-in definitions («ревность = jealousy toward
    toward»); `friction` boolean (true = a high value means friction, the
    warm bar tint). A custom entry with a bad key or empty title is dropped.
- `BOND_SCALES` stays the frozen list of built-in keys. New pure
  `bondScales(settings)` in `src/sections.js` returns the active scales in
  order: built-ins minus `off` in their canonical order, then custom entries
  in their stored order, each as `{ key, builtin, title, hint, friction }`
  where a built-in's `title` is its i18n key (`affection` etc.) and its
  `hint` the definition sentence now embedded in the bonds instruction
  (moved into a `BOND_SCALE_HINTS` map, en only, as every instruction).
  `FRICTION` (suspicion, fear, grudge, tension) moves next to it.
- The `bonds` section becomes settings-dependent in `getSections(settings,
  …)` and `getAllSections(settings)`: `schema.item.fields.stats.fields` =
  the active keys; `instructions` = the base rules text with the per-scale
  definitions of the active scales joined in order («affection = …;
  trust = …; jealousy = …»). With the default settings the text is
  byte-for-byte today's instruction, so the existing prompt snapshots hold.
  Everything downstream (prompt, parse, sanitize, the manual editor, the
  digest) follows the schema and needs no scale knowledge of its own.
- `src/merge.js` recomputes deltas over the active keys of the registry it is
  given (`options.sections` / the `bonds` schema), not over `BOND_SCALES`; a
  scale that was switched off disappears from the next state and from
  `changes`; switching it back on starts it fresh (the «absent from PREVIOUS
  STATE» rule).
- The ring is untouched: old entries keep whatever keys they carried.

### Drawer and panel

- `renderBonds` iterates `bondScales(view.settings)`: label = i18n label for
  a built-in, the stored title for a custom scale; the warm tint follows
  `friction`. Keys missing from a bond are skipped as today. The reply panel
  does the same.
- The manual editor shows the active scales (schema-driven).

### Settings

- New collapsible group «Шкалы отношений» / "Bond scales" (`GROUP_IDS` gets
  `scales`, placed after Sections), closed by default:
  - one checkbox per built-in scale in canonical order, labelled with its
    name and a short description (new i18n keys `scale.<key>.hint`, ru + en,
    one line each, e.g. «Репутация — как NPC оценивает цель, не слава»),
    checked unless the key is in `off`; writing toggles `off` as a whole
    array;
  - a hint line: «Инструкция по умолчанию пересобирается из включённых шкал;
    своя инструкция в «Опасной зоне» заменяет её целиком» / "The default
    instruction is rebuilt from the enabled scales; an override in the Danger
    zone replaces it whole";
  - «Свои шкалы» / "Custom scales": rows like custom blocks (key, title, hint,
    friction checkbox, two-tap delete), «Добавить шкалу» / "Add scale"
    disabled at 6; every write sends the whole `custom` array.
- The Danger zone's bonds textarea shows the rebuilt default when there is no
  override (`getPromptTexts` reads the settings-dependent section).

### Non-goals

Per-chat scale sets, reordering built-in scales, scales with a range other
than 0–100, migrating values between a built-in and a custom key.

## 21. Layout option: by topics or by people

Why (3 Oct 2026): a community widget shows one card per character with
everything about that character on it; the maintainer wants that as an
**option**, not a replacement. Sable's data is already keyed by NPC in four
sections (`npcs`, `thoughts`, `bonds`, `dossiers`), so a second layout can be
a pure re-slicing of the same state. Nothing changes in storage, the prompt
or the digest.

### Setting

- `settings.layout`: `'topics'` (default, today's drawer) | `'people'`.
  Settings → Sections: a select «Раскладка панели: по темам / по
  персонажам» / "Drawer layout: by topics / by people", placed before the
  Sections table. Global, like `order`.

### People layout

- The flat cards that are not NPC-keyed (`world`, `offscreen`, `threads`,
  `story`, `planner`, `banlist`, custom blocks, pack groups, folders) render
  exactly as in the topics layout. The four NPC-keyed sections do not render
  as cards; instead one built-in group «Люди» / "People"
  (`section.st-sable-group[data-people]`, glyph `fa-users`) takes the
  position of the first of them in the grouped order and holds one **person
  card** per NPC. The group header is the pack-group header (handle for the
  whole block, title, an aggregate chip over the four sections' modes with
  the same set-all menu, fold under `folded['people']`). A folder that lists
  any of the four sections keeps its other members; those four are consumed
  by the People group while this layout is on.
- Person card: `section.st-sable-card[data-person="<npcId>"]`, no handle
  (order = present NPCs first, then absent, each by their order in `npcs`),
  header = presence dot, name, mood (as the npcs row summary), fold under
  `folded['person:<id>']` (absent NPCs start folded, present ones open, as
  the npcs rows do today). Body, in this order and only for sections whose
  mode is not `off`:
  1. the npcs fields (`agenda` first, then outfit, position, action,
     wants_toward) and the «Тайна» spoiler (§19);
  2. the thought as a blockquote (present NPCs only, as today);
  3. the bond rows (`toward` line, then the active scales as keyed
     `scaleRow`s with keys `person:<id>:<scale>` so bars slide and flash as
     in §16);
  4. the dossier fields (role, look, voice, hook) when a dossier matches the
     NPC by `name` (case-insensitive) or `id`.
  A dossier with no matching NPC gets its own person card at the end of the
  group with the dossier fields only.
- Footer: the «В группу…» button is absent (person cards are not
  reorderable members). Editing from the card: see §25 (the pencil menu
  replaced the old footer hint «Редактирование: в раскладке по темам»).
- Change flags, the title dot, crit glow and card colours (`visual.cardColors`
  keyed `person:<id>` is out of scope; person cards take the npcs card colour
  if set) keep working through the keyed rows.
- hideOff: a person card hides when all four sections are off (then the group
  hides); the reveal row shows them back. «Скрыто: N» counts the four
  sections as today, not the person cards.
- Keyed persistence (§16): person cards persist across renders keyed by NPC
  id; the People group container persists like a pack group.

### Non-goals

Per-person colours, reordering people, the reply panel (unchanged).
Editing from a person card is §25.

## 22. Bond visuals: history sparklines and signed custom scales

Why (3 Oct 2026): the maintainer wants richer bond visuals from the same
widget: a small history line under each scale and a signed scale with a
centre (hatred on the left, love on the right).

### History

- `store.history = { [bondId]: { [scaleKey]: [{ mesId, value }] } }` per
  chat, at most 12 points per scale, written in `run.js` when a run result
  is stored: for each bond and each active scale with a numeric value, push
  `{ mesId, value }`; if the last point has the same `mesId` (a swipe, an
  edit, a refresh of the same reply) replace it instead; trim to 12. Pruned
  with the ring on `MESSAGE_DELETED` (drop points whose `mesId` is gone).
  Manual edits (`editState`) write a point the same way.
- Drawer: under a bond bar, when the scale has at least 2 history points and
  `visual.sparklines` is on (boolean, default true, Appearance → Cards), a
  `div.st-sable-spark` of up to 12 `span` bars (height = value / range),
  tinted like the bar (friction = warm), 16 px tall, `aria-hidden`, no text.
  Plain DOM, no canvas. The effects level `off` still shows it (static).
- The reply panel and the digest ignore history.

### Signed scales

- Any active scale can be signed, per scale: range −100…+100, where negative
  means the opposite feeling (affection → dislike, trust → distrust, a custom
  «ревность» → the opposite of jealousy). Built-ins: `settings.bondScales.signed`
  (array of built-in keys, normalised like `off`); custom scales (§20) gain
  `signed` (boolean, default false). `bondScales()` descriptors carry
  `signed`. Schema: a `score` with `min: -100` for signed keys (parse clamps
  accordingly; unsigned scales stay 0–100). The side-model definition of a
  signed scale gets the sentence "−100…+100, negative = the opposite feeling"
  appended automatically. Values already stored stay as they are when the
  flag changes.
- Drawer and panel: a signed scale renders a centred bar: a hairline at 50 %,
  the fill from the centre to the value (right for positive, left for
  negative; negative uses the warm tint, positive the accent), the number
  signed («−40», «+65»), delta badges unchanged. The merge delta rule (at
  most 10 per reply unless major) applies as is.
- Settings (the §20 group): every built-in scale row gets a second checkbox
  «−100…+100» next to its on/off checkbox, writing `bondScales.signed` as a
  whole array; the custom scale row gets the same checkbox next to «трение».

### Non-goals

History for pack stats, exporting history, migrating values when a scale
changes range.

## 23. Intimacy+ pack (18+)

Why (3 Oct 2026): a reader's list of what the most thorough adult block she
had seen tracked. The base intimacy pack (§15) already has arousal, climax
counts, volume and marks; the rest goes into a second built-in pack, deeper
and more explicit, that users enable on top of the first or alone.

### Pack

- `id: 'intimacy_plus'`, title «Интим+ (18+)» / "Intimacy+ (18+)", icon
  `fa-fire`, description «Глубже: шкала оргазма, проникновение и финал, зоны,
  кинки, антикинки, опыт, после» / "Deeper: climax build-up, contact and
  release, zones, kinks, dislikes, experience, afterglow". `scope: true`,
  `scopeDefault: 'others'`. Rules = the adult guard of §15 (every participant
  an established adult, including those outside the tracking scope; empty
  values otherwise) + `{{scope}}` + "Track only explicit, established facts;
  never infer consent, preference or dislike from arousal, silence or
  compliance; preferences and dislikes come only from shown enjoyment, shown
  discomfort or stated words; invent nothing. Clinical wording, no slang, no
  judgement."
- The side model writes explicit content here by design; the pack
  description says so. Every section instruction starts with the adult guard
  sentence and the empty-value rule, as in the base pack.

### Sections (key, shape, glyph, cap, default mode)

1. `climax` — stats, `fa-bolt`, cap 8, inject. «Оргазм» / "Climax". Keys
   `Name · climax`, 0–100 with `max: 100`: build-up toward orgasm for each
   tracked participant, present only once sexual contact or petting has
   begun (`[]` before that); cautious estimates labelled in `note`; set to 0
   right after an explicit climax (the base pack counts them); never invent
   a climax. No `delta`.
2. `wetness` — stats, `fa-droplet`, cap 8, inject. «Влажность» / "Wetness".
   Added by §23a; see there.
3. `contact` — kv, `fa-circle-nodes`, cap 6, inject. «Контакт» / "Contact".
   Keys `Name · penetration` → `depth · orifice` only when both are
   established in the text; `Name · release` → `amount · where` for an
   explicit release event, cleared when the scene moves on; omit unknown
   entries; never estimate amounts.
4. `zones` — kv, `fa-hand-dots`, cap 10, show. «Зоны» / "Zones". Keys
   `Name · zone` → state (marks, soreness, sensitivity) only when described;
   preserved until a change is established; invent nothing.
5. `kinks` — tags, `fa-heart-circle-plus`, cap 12, inject. «Кинки» /
   "Kinks". Short participant-labelled tags of preferences and fetishes,
   added only from shown enjoyment or an explicit statement; persistent
   across scenes; removed only when the text contradicts them.
6. `limits` — tags, `fa-heart-circle-xmark`, cap 8, inject. «Антикинки» /
   "Dislikes". Short participant-labelled tags of what a participant
   disliked or refused, from shown discomfort or explicit refusal;
   persistent; removed only when contradicted.
7. `experience` — list, `fa-book-open`, cap 10, show. «Опыт» / "Experience".
   Short entries «Name: first X, positive (why)» / «Name: after Y avoids Z»,
   appended only for a new explicit experience; older entries kept; the
   oldest dropped first past the cap.
8. `cum` — kv, `fa-vial`, cap 8, inject. «Семя» / "Cum". Added by §23a; see
   there.
9. `after` — text, `fa-mug-hot`, show. «После» / "Afterglow". Compact state
   after the act per participant: closeness or distance, soreness, mood;
   empty while the act continues or when nothing happened.

### Everything else

- `packSections` / `BUILTIN_PACKS` as for the two existing packs; i18n keys
  `pack.intimacy_plus.*`; `fixtures/state-packs.json` gains synthetic values
  for every new section (the Guard and the Traveller, both adults, kept
  tame); the digest snapshot test gains the inject lines; `test/packs.test.mjs`
  shape/cap list and scope set updated; the pack sheet lists three packs.
- README ru + en: one sentence per pack in the packs paragraph; SPEC §15
  built-in list mentions `intimacy_plus`.

## 24. Drag between containers and the undo pill

Why (3 Oct 2026, design round after 0.3.0): moving a card into or out of a
group should be the same gesture as sorting, with the handle, no long-press;
packs and the People group are not targets; everything that rearranges or
deletes gets a one-level undo.

### Undo pill

- The drawer owns one undo pill: `div.st-sable-undo[role="status"]` at the
  bottom of the panel, glass, 36 px tall, a text and a button «Вернуть» /
  "Undo". `undo.show(text, restore)` replaces any pill already shown; the
  pill hides after 5 s, on tap of the text, or after the button calls
  `restore()`. The snapshot lives in memory only (nothing is persisted, a
  reload loses it). Effects `off`: it appears without the 140 ms slide.
- Users of the pill in this task: a drop (restore the previous
  `{ folders, order }` through `updateSettings`), «Удалить группу» (now one
  tap: restore the folder and the previous `order`), «Разложить по группам»
  (restore the previous `folders` and `order`; the arming second tap goes
  away). §25 adds person delete.

### Drag

- Starts as today: handle, pointer events, 5 px threshold, `pointercapture`.
  A flat card or a folder member is bounded by its parent until the pointer
  leaves the parent's box by more than **24 px** vertically (hysteresis);
  then the card is **detached**: it keeps its full look and the
  `st-sable-dragging` lift, and the targets below apply. Moving back inside
  the original container re-attaches it (plain sorting again). Folder
  handles (whole-block moves), pack members and person cards keep today's
  rules and never detach.
- **Targets** while detached: a user folder (`data-folder`): over its header
  → slot at the end of its members; over the gap between two of its members
  → slot at that index; a folded folder accepts on its header and does not
  unfold; an empty folder's hint row is its slot. A top-level gap (between
  top-level blocks, outside any folder) → slot «без группы» at that index.
  The slot is one `div.st-sable-slot` (44 px, dashed accent border, muted
  text «сюда» / "here") inserted where the card would land; one at a time.
- **Full folder** (20 members): header gets `st-sable-full` and a badge
  «полная» / "full", no slot, drop = cancel.
- **Non-targets**: packs (`data-pack`), the People group
  (`data-container="people"`) and person cards get `st-sable-dim` (50 %)
  while a card is detached; no slot; a drop over them cancels.
- **Auto-scroll**: while dragging, a pointer within 48 px of the card list's
  top or bottom edge scrolls the list by up to 12 px per animation frame,
  proportional to the depth into the band; it stops when the pointer leaves
  the band or the drag ends.
- **Cancel**: `pointercancel`, `lostpointercapture`, Escape, the pointer more
  than 40 px left of the panel's left edge, a drop with no slot. The card
  returns to its place (150 ms with effects on, instant with `off`); nothing
  is written.
- **Drop** = one `updateSettings({ folders, order })` built by a pure
  function in `src/folders.js`:
  `planDrop(settings, sectionId, { folderId, index })` where `folderId` is a
  folder id or `null` (no folder) and `index` is the position among the
  target block's members in grouped order (`Infinity` = end). It reuses
  `moveToFolder` and then moves the id inside its block in `order`. Returns
  `{ folders, order }`, or `null` for an illegal drop (full folder, unknown
  ids, a pack member, a pack or people target). Before writing, the previous
  `{ folders, order }` go to the undo pill with the text «Сюжет → Мир» /
  "Story → World" (card title → folder title; «Без группы» / "No group" for
  `null`).
- Mouse runs the same code. Keyboard keeps the «В группу…» menu and ▲▼; the
  menu is unchanged.
- Tests: `planDrop` (into a folder at the end and at an index, out to no
  folder at an index, full folder → `null`, pack member → `null`, an empty
  folder gains its position); the undo pill (show, replace, timeout, restore,
  with fake timers); a geometry helper `slotFor(rects, y)` (exported: given
  the member rectangles of the hovered block and the pointer y, returns the
  index) unit-tested. Real geometry is checked only in a real SillyTavern.

## 25. Person card: pencil menu, edit form, delete, add

Why (3 Oct 2026): editing a person without switching to the topics layout.
Decision: a small pencil on the person card, a two-item menu, one form per
person, and a batched write of the four NPC-keyed sections.

### Runtime

- `runtime.editSections(values)` with `values = { [sectionId]: value }`:
  sanitises every value with `sanitizeSection`; if any is invalid, returns
  `false` and writes nothing. Otherwise it replaces each section in the
  current entry (creating the entry for the last character reply as
  `editState` does), sets `meta.editedAt`, clears `stale`, cancels an
  in-flight run once, records bond history once (§22), re-injects once,
  saves once, publishes once. `editState(id, value)` becomes a thin wrapper
  over `editSections({ [id]: value })`.

### Drawer

- The person card header gets a pencil button (36 px, `fa-pen`,
  `aria-haspopup="menu"`) between the name/mood and the fold. A tap opens a
  menu with the look and keyboard rules of the mode menu: «Редактировать» /
  "Edit" and «Удалить» / "Delete". The footer hint «Редактирование: в
  раскладке по темам» is removed.
- `applyPersonDraft(sections, person, draft)` (pure, exported, tested):
  `sections` = the current values of `npcs`, `thoughts`, `bonds`,
  `dossiers`; `draft` = `{ npc?, thought?, bond?, dossier? }` (a sub-object
  present = replace or add that part; `null` = remove it). Returns only the
  sections that changed, each the old array with this person's item
  replaced, appended, or removed. Matching is the people layout's: npcs,
  thoughts and bonds by `id`, dossier by `name` (case-insensitive) or `id`.
- **Edit form** replaces the card body (a keyed node like the section
  editor) and is generated from the section schemas, sliced to this person,
  with sub-headings carrying the section glyphs: Персонаж (presence, mood,
  agenda first, then the other npcs fields), Тайна / На самом деле (plain
  inputs with the caption «не идёт в промпт» / "not sent to the model"),
  Мысль (textarea), Отношения (`toward`, reason, one number input per active
  scale with that scale's range; `changes` read-only), Досье (role, look,
  voice, hook). A part the person lacks shows a button «+ Досье» /
  «+ Отношения» / «+ Мысль» that adds that sub-form prefilled with the
  person's name and id; an orphan dossier card shows the dossier sub-form
  and «+ Персонаж» / "+ Character" (adds an npcs row, `present: false`).
  «Сохранить» / «Отмена» stick to the bottom of the card. Save →
  `editSections(applyPersonDraft(...))`; `false` → an inline error, the form
  stays. The form survives re-renders, keeps focus and draft; a fingerprint
  of the four sections is taken when it opens, and when it changes the form
  shows a bar «Данные обновились» / "Data changed" with «Перечитать» (rebuild
  from the new data, drop the draft) and «Сохранить всё равно» / "Save
  anyway". Several person forms may be open at once. Topics-layout editors
  are unchanged.
- **Delete**: one `editSections` call removing the person's items from the
  four sections (dossier by the same match) and deleting that bond's history;
  no two-tap confirmation; the undo pill (§24) shows «Maren удалена ·
  Вернуть» / "Maren deleted · Undo" and restores the four previous values
  through `editSections`. README says plainly that the side model may add
  the character back when the text still mentions them.
- **Add**: the People group footer gets «+ Человек» / "+ Person": a one-field
  inline form (name, required, 60 chars) that appends an npcs row (id derived
  from the name as the editor derives ids, `present: true`, other fields
  empty) through `editSections`, then opens that person's edit form.

## 26. Stat history and tap-to-jump

Why (3 Oct 2026): bars in packs should get the same history line as bond
scales, and a point should lead to the reply it came from, for people who
re-read their chats.

### Storage

- `recordHistory` is generalised to `store.history[key][line]`: `key` is a
  bond id (as today) or the id of a `stats` section (built-in pack sections
  and custom blocks with shape `stats`); `line` is the bond scale key or the
  stat item `key` (the model's exact string, trimmed, no other
  normalisation). Only stat items with a numeric `max` are recorded. For a
  stats section, lines whose key is absent from the freshly stored value are
  deleted (a stat that disappears takes its line with it); bonds keep today's
  rule. Same 12-point cap, same replace-on-same-`mesId`, same `pruneHistory`.
  Switching a pack off in a chat does not touch history. Recording happens
  where bond history is recorded in `run.js` and after `editSections` touches
  a stats section.

### Display

- A stats row gets the same `sparkline(row, spec)` under its bar when it has
  at least 2 points and `visual.sparklines` is on, accent tint only.
- **Tap-to-jump** on every sparkline (bonds and stats): the sparkline is a
  button (`role="button"`, `tabindex="0"`, aria-label «История» /
  "History") with a transparent hit area of at least 36 px in height; a tap
  picks the bar under the pointer (by x; keyboard: ←/→ move the pick, Enter
  jumps), marks it `st-sable-spark-active`, and shows a label row under the
  sparkline: «ответ #N · HP 40» / "reply #N · HP 40" (the stat or scale
  title, the value, signed for signed scales). The chat scrolls to that
  message when it is rendered:
  `document.querySelector('#chat .mes[mesid="N"]')?.scrollIntoView({ block:
  'center', behavior })` with `behavior` `'smooth'` unless effects are `off`;
  when the message is not in the DOM the label adds «(не загружено)» /
  "(not loaded)". A second tap on the same bar hides the label. The reply
  panel and the digest ignore history.

### Setting

- Rename the checkbox to «Мини-графики под полосками» / "History sparklines
  under bars"; its hint names bond scales and pack stats. No per-pack
  setting.

## 27. First-run hints, missing-profile status, mode legend, stale recompute

Why (3 Oct 2026): a newcomer must learn three things from the panel itself,
not the README: connect a model, understand the chip, write to the character.
Pages get reloaded, so the hints need a «Больше не показывать».

### Hints

- Three small sequential popups inside the drawer
  (`div.st-sable-hint[role="dialog"]`, glass, above the card list), one at
  a time, each with a title, one or two lines, a «Дальше» / "Next" button
  (the last says «Понятно» / "Got it") and a checkbox «Больше не
  показывать» / "Don't show again":
  1. «Проверь соединение» / "Check the connection": the side-model profile
     select inline (same source and filter as the settings control); when
     no chat-completion profile exists: «Создай профиль в Connection
     Manager» / "Create a profile in Connection Manager".
  2. «Выбери, что нравится» / "Pick what you like": «в промпт — модель это
     видит · показ — только тебе · выкл — не обновляется» / "inject — the
     model sees it · show — only you · off — not updated".
  3. «Наслаждайся» / "Enjoy": «Напиши персонажу — после его ответа карточки
     заполнятся» / "Write to the character; the cards fill in after their
     reply".
- State: `settings.hints = { done: false }` (normalised, default `false`).
  Hints show when the drawer opens while `done` is false; the checkbox,
  finishing the third hint, or the first successful run set `done: true`.
  Settings → Actions gets «Показать подсказки снова» / "Show the hints
  again" (sets `done: false`). Effects `off`: no animation.

### Missing profile

- When `settings.profileId` is empty, or the profile is missing or not
  chat-completion, the status footer permanently shows «Нет профиля модели →
  настроить» / "No model profile → set up" as a button that opens the
  settings on the Connection group (the gear path), and the Run now control
  is disabled with the same title. This is in addition to the existing
  warnings after a failed run.

### Mode legend

- Every mode menu (`openModeMenu`, including the aggregate chips) ends with
  a muted 12 px legend `div.st-sable-menu-legend` with the three lines of
  hint 2.

### Stale recompute

- The `recomputeOnEdit` setting and checkbox are removed (the normaliser
  still accepts and drops the key). After the latest reply is edited
  (`entry.stale`), the status footer shows «Состояние устарело» / "State is
  stale" with a button «⟳ Пересчитать» / "⟳ Recompute" that runs the
  existing edit run (`run(mesId, { type: 'edit' })`); stale cards get
  `st-sable-stale` (dimmed accent bar). The next character reply clears it
  as today. README's Context paragraph is updated.

## 28. Settings in one tier

Why (3 Oct 2026): no hidden second tier. Groups stay on one level and say
what they hold; the settings people touch during play live where they play.

- **Folded group summaries.** Each settings group header shows a muted
  summary line while the group is folded, from i18n keys
  `group.<id>.summary`, e.g. «панель, карточки, фон, цвета карточек,
  эффекты» / "panel, cards, background, card colours, effects". Hidden while
  open.
- **Period in the chip menu.** The mode menu gets a last row «Раз в N
  ответов» / "Every N replies" with a number input (0–99) writing the same
  period setting the Sections table writes (global, never a per-chat
  override; the dossiers special `0` keeps its hint). The table keeps its
  period column.
- **Card colour in the card menu.** The footer of every card that has a
  footer gets «Цвет…» / "Colour…", opening an inline row with the same
  swatches and «auto» as Appearance → Cards → Card colours, writing
  `visual.cardColors[id]` (send the full `visual` object, as today). The
  settings block stays.
- **Legacy import banner.** «Импорт из старого Sable» leaves the Actions
  group. When `snapshot().canSeedLegacy` is true the drawer shows a banner
  above the cards: «В этом чате есть данные старого Sable» / "This chat has
  old Sable data" with «Импортировать» / "Import" (`seedLegacy()`) and
  «Скрыть» / "Hide" (per chat: `chat_metadata.sableTrackers.legacyBannerHidden
  = true`). Never automatic.
- i18n ru + en; README.

## 29. Folder colours

Why (3 Oct 2026, her first try of 0.4): «Цвет…» on cards is fun, but a group
cannot be coloured, which looks odd next to coloured cards.

- `settings.folders[i].color`: a hex colour (`#rrggbb`, normalised like a
  `visual.cardColors` entry; absent or invalid = automatic). `normalizeFolders`
  keeps it; `moveToFolder`, `planDrop` and the folder editor preserve it.
- A folder with a colour tints its group the way `applyCardColor` tints a
  card: the header glyph and title, the left accent bar of the group
  container, its border and the aggregate chip take the colour; member cards
  keep their own colours (a member without one stays on the shared accent,
  not the folder's). The People group and packs are unchanged (packs keep
  their section colours).
- The colour lives only in the folder editor form («Редактировать группу» /
  "Edit group"): a colour input with «auto» next to the icon field, written
  with the rest of the form on Save as `updateSettings({ folders })` with the
  whole array; Cancel discards it. The folder footer has no «Цвет…» button.
- Tests: normaliser keeps/drops `color`; the editor writes the array on Save
  and Cancel discards; the group gets the tint attributes; «auto» removes the
  field.

## 23a. Intimacy+ additions (3 Oct 2026)

Her screenshot list for the thorough adult block asked for two things §23
left out: how much semen, and how wet she is. Both go into `intimacy_plus`:

- `wetness` — shape `stats`, glyph `fa-droplet`, cap 8, mode `inject`,
  period 1, title «Влажность» / "Wetness". Instruction (adult guard first,
  `[]` until arousal is shown in the text): stable key `Name · wetness` per
  tracked participant whose arousal the text shows as wetness, integer 0–100
  with `max: 100`, cautious estimates from described signs labelled estimate
  in `note`, preserved without new evidence, moved only for shown events,
  never equated with consent, never invented.
- `cum` — shape `kv`, glyph `fa-vial`, cap 8, mode `inject`, period 1, title
  «Семя» / "Cum". Instruction (adult guard first, `[]` until an explicit
  release has happened): one entry per participant who released, key = the
  name, value = where it went, how many times, and the amount when the text
  states or clearly implies it (ml or a plain word), cumulative within the
  scene, reset only when the text establishes a new scene or clean-up;
  count only explicit events; invent nothing. The Intimacy pack's counters
  (climaxes, minutes, ml) stay as they are; this card is the explicit
  where-and-how-much view.
- Order inside the pack: climax, wetness, contact, zones, kinks, limits,
  experience, cum, after. i18n ru + en, fixtures (synthetic), tests (shape
  and cap list, digest snapshot with the new inject sections, fixture
  validates through `sanitizeSection`), README pack paragraph, SPEC §23
  section list.

## 30. Card colour moves into the card editor

Why (3 Oct 2026, her phone): the footer «Цвет…» plus its inline colour row
made one card huge; she asked to take it out of the footer and put it into
the editor.

- Remove the «Цвет…» footer control (`[data-control="color"]`) and the
  inline colour row from every card footer, section and person cards alike.
- The section editor (the form behind the pen «Редактировать», SPEC §13)
  gets a last row before Save / Cancel: «Цвет карточки» / "Card colour" with
  the same `input[type=color]` and «auto» as Appearance → Cards → Card
  colours, writing `visual.cardColors[sectionId]` (full `visual` object) on
  change, previewing on input; «auto» removes the entry. The colour write is
  immediate and independent of the form's Save (settings, not state); Cancel
  closes the form and keeps the colour. The README says so in one sentence.
- The person form (SPEC §25) gets no colour row; person cards take the
  `npcs` card colour as before, set from the topics layout.
- Folder colour: only in the folder editor form (SPEC §29 as amended: no
  footer button).
- Tests: the footer has no colour control; the editor row writes the full
  `visual`; «auto» removes the entry; the T26 tests move accordingly.

## 27a. Fourth hint: everything is changed in the cards

Why (3 Oct 2026, her words after the first evening with 0.4): one more
onboarding step saying that the cards themselves are where things change,
and a short line in the settings saying the same.

- The hint sequence of §27 becomes four steps: 1 «Проверь соединение»,
  2 «Выбери, что нравится», 3 **«Всё меняется в карточках»** / "Everything
  changes in the cards", 4 «Наслаждайся». Step 3 text: «Режим — чип на
  карточке, период — в его меню, поля и цвет — карандаш, порядок и группы —
  ручка» / "Mode: the chip on a card · period: in its menu · fields and
  colour: the pen · order and groups: the handle". Counters read 1/4…4/4;
  the checkbox and `settings.hints.done` rules are unchanged.
- The settings block gets one muted line at its top, above the first group:
  «Коротко: режим, период, цвет, правка и порядок меняются прямо в карточках
  панели. Здесь — всё остальное.» / "In short: mode, period, colour, editing
  and order are changed in the panel's cards. Everything else is here."
  (`p.st-sable-settings-intro`, i18n `settings.intro`).
- Tests: the hint sequence has four steps with the new third title; the
  settings block starts with the intro line.

## 31. Request resilience: rejected reasoning parameters, cut output, empty output

Why (4 Oct 2026, night): on her tavern every run failed for eleven replies in
a row and the injected state was half an hour old. Two causes found by
replaying the request from the server: (1) the Rout Gemini lane answers
HTTP 400 "Invalid request for this model. Please remove unsupported
parameters" whenever the reasoning parameters of §(«Размышления модели»)
are present, which pushed her onto a slower profile; (2) on that profile
the output (reasoning tokens count against `max_tokens`) ran past 6000
tokens, the JSON was cut, and the parser reported only the generic
«Не удалось обновить состояние сцены».

- **Retry without reasoning parameters.** `execute` sends the request with
  `reasoningPayload(settings)` as today. If the request fails with an error
  that looks like a parameter rejection (HTTP status 400, or a message
  containing `unsupported parameter`, `Invalid request for this model`,
  `reasoning`), it retries **once** with an empty payload. The log entry
  gets `retried: 'no-reasoning'` and a warning «Параметры размышлений
  отклонены моделью, запрос повторён без них» / "The model rejected the
  reasoning parameters; retried without them". For the rest of the page
  session that profile id is kept in an in-memory set and the payload is
  skipped from the start (one wasted request per reload is acceptable; no
  persistence). The level «как у модели» still sends nothing.
- **Cut output.** When the response contains `<sable_state>` but the JSON
  cannot be parsed (no closing tag or a parse error), the run fails with
  «Ответ обрезан: модель не дописала JSON. Увеличьте «Макс. токенов»
  (сейчас N) или уменьшите размышления» / "The reply was cut: the model did
  not finish the JSON. Raise Max tokens (now N) or reduce reasoning". N is
  `settings.maxTokens`. The status footer shows this text as it shows
  `lastRun.error` today.
- **Empty output.** A response with no text at all fails with «Модель
  вернула пустой ответ (фильтр содержимого?)» / "The model returned nothing
  (content filter?)".
- **Default max tokens** rises from the current default to 8000 for new
  installs (`DEFAULTS.maxTokens`; stored values are kept as they are); the
  settings hint for the field says that reasoning tokens count against it.
- README: one paragraph in the setup section (en + ru) about these three
  messages and the «как у модели» level.
- Tests: a fake `ConnectionManagerRequestService` that rejects the first
  call when the options carry a reasoning payload (error message with
  "unsupported parameters") and succeeds without → one retry, state stored,
  log entry flagged; a second run on the same profile sends no payload at
  all; a truncated response → the cut-output message with N; an empty
  response → the empty-output message; the normaliser default for
  `maxTokens`.

## 32. Which state is injected: swipes, regenerations and lag

Why (4 Oct 2026, night, her words): «модель получает старый трекер: при
свайпе трекер прогрузился, и модель цепляется за него как за инструкцию;
или модель не работала, и весь старый стек инжектился». Both are about
the entry `publish()` chooses, and both are real: the injection is refreshed
only on message events, never at generation start, and a failed run leaves
an arbitrarily old entry in the prompt.

### Generation start

- Subscribe to `GENERATION_STARTED` (`(type, params, dryRun)`). For `type`
  `swipe`, `regenerate` and `continue`, the injected entry becomes the state
  **before** the last character message: `currentEntry(store, chat,
  lastCharacterId, { skipStale: true })`, i.e. the latest entry whose
  `mesId` is lower than the message being rewritten. For every other type
  (`normal`, `quiet`, `impersonate`, …) the injected entry is the usual
  latest one. `publish()` takes the chosen entry (a `generation` override
  kept in memory until the next `MESSAGE_RECEIVED`, `MESSAGE_SWIPED`,
  `CHAT_CHANGED` or `MESSAGE_DELETED` clears it) and sets the extension
  prompt before SillyTavern combines the prompts.
- Viewing an already generated swipe keeps today's rule: the entry with that
  `swipeId` (`currentEntry` already matches `chat[mesId].swipe_id`).
- The dry run (prompt preview) follows the same rule, so the preview shows
  what the model gets.

### Lag

- `lagOf(entry, chat)` = the number of character messages after
  `entry.mesId` up to and including the last character message (0 when
  the entry is for the last reply; for the swipe/regenerate override, lag is
  measured against the message before the rewritten one, so it is 0 when
  the previous reply has a state).
- Lag 1 (a run for the latest reply is still running, failed once, or was
  cancelled) is injected, with one line prepended to the digest: «Состояние
  сцены на момент ответа #N (на 1 ответ позже событий в чате; новые
  сообщения главнее)» / "Scene state as of reply #N (one reply behind the
  chat; newer messages take precedence)".
- Lag 2 or more: **nothing is injected** (`setExtensionPrompt` with an empty
  text); the status footer shows «Состояние отстаёт на M ответов» /
  "State is M replies behind" next to the existing ⟳ control, and the cards
  keep showing the old state with the same note under the title row
  (`div.st-sable-lag`). The reply panel shows the note too.
- `snapshot()` exposes `lag` and `injectedEntry` so the drawer, the panel and
  the preview agree.
- Constants: `MAX_INJECT_LAG = 1` in `src/run.js` (not a setting yet).

### Tests

- A fake `GENERATION_STARTED` with `swipe` after a stored state for the last
  reply → the extension prompt text is built from the previous reply's
  entry; with `normal` → from the latest entry; after `MESSAGE_RECEIVED`
  the override is gone.
- Lag 1 → digest prepended with the note; lag 2 → empty prompt, status
  text, `snapshot().lag === 2`.
- `lagOf` unit tests (no entries, entry for the last reply, swipe override).

## 33. Audit fixes: reserved names, chat-bound drafts, caps

Why (4 Oct 2026): an independent review of 0.4.1 by two code auditors and
CodeQL. Both auditors refused to install the extension for one line,
`(history[id] ??= {})[line] ??= []` in `src/store.js`: with a bond id of
`__proto__` from the side model it wrote onto `Object.prototype` of the
whole SillyTavern page. The rest of this section lists the other confirmed
findings and what changed.

### Reserved names

- `RESERVED_KEYS = ['__proto__', 'constructor', 'prototype']` and
  `isSafeKey(key)` in `src/sections.js`.
- The parser drops an object row whose `id` or `key` is reserved, including
  an id derived from `name`, and skips reserved keys inside `changes`.
- `addPoint` (bond and stat history) ignores reserved ids and lines and only
  ever touches own properties (`own(map, key, make)`); `recordStatHistory`
  reads its section's lines as an own property too.

### Drafts belong to a chat

- On a store change (`view.store !== previousStore`) the drawer removes the
  open section editors (their card nodes first, so the next render builds
  fresh cards), hides the undo pill and drops the roll note with its timer, in
  addition to the person forms it already cleared.
- An editor remembers the store it was opened in; `saveEditor` discards a
  draft from another store instead of writing it. The person-delete undo
  callback checks the store before restoring.

### Editors and parsing

- The score editor reads `schema.min ?? 0` and `schema.max ?? 100`, so a
  signed scale (§22) keeps a negative value on Save; it used to clamp to 0.
- `extractJson` repairs trailing commas only when the candidate does not
  parse as is: inside a string a comma before a bracket is data.

### Saving and size

- `saveStore` keeps same-tick coalescing; a call made while `saveMetadata`
  is in flight queues exactly one more save after it, with the data as it
  is then. (Assumes SillyTavern serialises at call time, as it does today.)
- `CAPS = { npcs: 80, bonds: 80, dossiers: 150 }` in `src/merge.js`. When a
  merged list exceeds its cap, the oldest items that are neither in the
  incoming reply nor, for NPCs, present are dropped (array order is arrival
  order). Protected items may exceed the cap.
- `buildDigest` flattens every string value of a copy of the state to one
  line (control characters, newlines and line separators become a space)
  before rendering; the drawer still shows the original text.

### Wording

- Built-in scale hints say "toward the target" instead of "toward toward";
  the custom-scale placeholder follows.

### Tests

- `test/reserved-keys.test.mjs`: parse, history and an end-to-end run with
  a `__proto__` bond leave `Object.prototype` untouched and do not throw.
- `test/chat-switch-ui.test.mjs`: an open editor and a pending undo cannot
  write into the chat switched to; a negative signed score survives Save.
- `test/hardening.test.mjs`: the save queue, `extractJson`, the one-line
  digest and the caps.
