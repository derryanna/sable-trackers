# Instructions for coding agents

Read `SPEC.md` first. Work on **one task from `TASKS.md` per PR** — the task
named in your prompt, nothing else. Small focused diffs; no drive-by refactors.

## Project facts

- SillyTavern **1.19.x** third-party UI extension. Plain browser ES modules,
  **no build step, no bundler, no runtime dependencies**. Entry: `index.js`
  (declared in `manifest.json`), styles in `style.css`.
- Installed at `data/<user>/extensions/sable-trackers/`, served as
  `/scripts/extensions/third-party/sable-trackers/`. Prefer the global
  `SillyTavern.getContext()` over relative imports. Available on it (verified on
  1.19): `chat`, `chatMetadata`, `characters`, `characterId`, `groupId`,
  `name1`, `name2`, `eventSource`, `eventTypes`, `saveMetadata`,
  `saveSettingsDebounced`, `extensionSettings`, `setExtensionPrompt`,
  `substituteParams`, `getCurrentChatId`, `messageFormatting`, `t`,
  `updateMessageBlock`, `ConnectionManagerRequestService`.
  `ConnectionManagerRequestService.sendRequest(profileId, messagesOrString, maxTokens, custom, overridePayload)`
  where `custom = { stream, signal, extractData, includePreset, includeInstruct }`.
  Connection profiles: `extensionSettings.connectionManager.profiles` (`{id, name, api, model, …}`).
  Events used: `MESSAGE_RECEIVED`, `MESSAGE_SWIPED`, `MESSAGE_DELETED`,
  `MESSAGE_EDITED`, `CHAT_CHANGED`, `CHARACTER_MESSAGE_RENDERED`,
  `WORLD_INFO_ACTIVATED` (payload = array of activated entries with `content`, `comment`, `key`).
  `setExtensionPrompt(key, value, position, depth, scan, role)`:
  position `1` = in-chat at depth, role `0` = system.
- The `SillyTavern` global, jQuery (`$`) and `toastr` exist at runtime in the
  browser only. **Pure modules must not touch them** so they can be tested in Node.

## Layout

```
manifest.json  index.js  style.css  settings.html (optional)
src/
  sections.js   registry (pure)        prompt.js  request builder (pure)
  clean.js      message cleaner (pure) parse.js   side-model output parser (pure)
  merge.js      state merge (pure)     digest.js  injection text (pure)
  settings.js   defaults + load/save   store.js   chat_metadata ring
  run.js        generation glue        ui/drawer.js  ui/panel.js  ui/settings.js
  i18n.js       ru (default) + en labels
test/            node:test files, *.test.mjs
fixtures/        synthetic states and chats (no real RP content)
docs/            reference material (read-only)
```

## Rules

- Tests: `npm test` (= `node --test "test/**/*.test.mjs"`). Node 20+, no network needed.
  Every pure module gets tests; the glue and UI get tests with light fakes
  (`test/fakes/st.mjs` fakes `SillyTavern.getContext()`). If you need a DOM,
  add `jsdom` as a devDependency only.
- All model output is untrusted text: escape before inserting into the DOM
  (`textContent` or an `escapeHtml` helper). No `eval`, no `innerHTML` with raw values.
- Never modify `message.mes` or `message.extra`, and never touch other extensions' settings.
- Mobile first: the main user is on Android Chrome. Tap targets ≥ 36 px, and the drawer
  becomes full width under 700 px.
- User-facing strings go through `src/i18n.js`. Default language: Russian.
  Code, comments and commit messages in English.
- `docs/LEGACY-SABLE-RENDER.md` describes the legacy in-message panel this
  extension replaces (the legacy code itself is not in this repository).
- No personal data in code, docs, fixtures or commits: no real names, hosts,
  paths, emails, API keys.
- Before you finish: `npm test` green, `node --check` on every changed `.js`,
  update `TASKS.md` (tick your task, add notes for the next one if something is
  unfinished). If you run out of budget mid-task, commit what works, mark the task
  "partial" in `TASKS.md` with a short list of what is left, and open the PR anyway.
