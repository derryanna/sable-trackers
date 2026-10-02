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
| `npcs` | per NPC: `id, name, present, outfit, position, mood, agenda, action, wants_toward, secret` | inject | 1 |
| `thoughts` | per present NPC: private first-person thought, ≤30 words (≈ "NPC Inner Chatter") | show | 1 |
| `bonds` | per NPC: `toward` + scales 0–100 or null: affection, trust, desire, love, reputation, suspicion, respect, fear, grudge, tension; plus `changes` (only changed scales: `{delta, reason}`) | inject | 1 |
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

Call: `SillyTavern.getContext().ConnectionManagerRequestService.sendRequest(profileId, messages, settings.maxTokens)`
(default maxTokens 3000, `custom = { stream: false, extractData: true, includePreset: false }`).
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
- `MESSAGE_EDITED` on the last character message: mark the entry stale. The drawer shows
  a "↻ outdated" hint and the refresh button recomputes it. No automatic re-run.
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
(tap targets ≥ 36 px). Switching on appends the pack's cards after the existing
ones (order editable as usual) and triggers no run by itself; the next reply or
↻ requests them. Switching off hides the cards and clears their injection.
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
  state), `intimacy_arousal` (stats per participant: arousal 0–100, stamina),
  `intimacy_counters` (stats with `max: null`: climaxes, minutes, volume in ml,
  max 8), `intimacy_marks` (tags: visible marks and state, max 10). Rules keep
  the canon guard from §2 unchanged: every participant must be an established
  adult, otherwise the pack returns empty values; nothing is invented.
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
