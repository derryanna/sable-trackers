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
| `bonds` | per NPC: `toward` + scales 0–100 or null: affection, trust, desire, reputation, suspicion, respect, fear, grudge, tension; plus `changes` (only changed scales: `{delta, reason}`) | inject | 1 |
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
  ring: [ { mesId, swipeId, turn, state } ],   // last settings.keep states (default 3), newest last
  lastRun: { mesId, ok, error?, ms, inTok?, outTok? },
  modeOverride: { [sectionId]: 'inject'|'show'|'off' },
  turnsSince: { [sectionId]: number }
}
```

Save with `saveMetadata()` (debounced). A state is about 5–10 KB; ring of 3 → ~30 KB max per chat.

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

Inject with `setExtensionPrompt('sable_trackers', text, IN_CHAT(1), settings.depth (default 2), false, SYSTEM role (0))`.
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
  (`inject` / `show` / `off`; tap cycles), chevron to fold (fold state saved).
  Empty card body shows "—".
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

Group chats · image generation · editing state by hand (v2) · streaming the
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
  radius: 18 }        // card corner radius 8–24
```

The drawer applies these as CSS custom properties on the drawer element and the edge tab (`--st-sable-opacity`, `--st-sable-blur`, `--st-sable-font`, `--st-sable-width`, `--st-sable-accent`, `--st-sable-radius`); `style.css` reads them with the defaults above as fallbacks. `icons` switches the title icon element. Missing keys are filled from defaults on load (settings.js); `accent`, `base` and `text` accept `#rrggbb` or `#rgb`, anything else becomes the default.

Colours: with a `base`, the panel is `rgba(base, opacity)` (`--st-sable-base-rgb`) and the **ink** (`--st-sable-ink-rgb`) is black or white, whichever has the higher WCAG contrast ratio on the base (relative luminance crossover ≈ 0.179). Every overlay in the drawer and tab (borders, dividers, card fills, chips, tracks, hover states) is `rgba(ink, alpha)`, defaulting to white; the text is `text`, else `rgb(ink)`, else the theme colour (`--st-sable-text`). The ink comes from the base only, never from `text`. A default accent follows the ink. Text on a solid accent fill (the `inject` chip) uses `--st-sable-accent-ink-rgb`, derived from the accent in the same way. Light bases (`data-st-sable-tone="light"`) darken status colours and give coloured dots and bar tracks a faint rim.
