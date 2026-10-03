# Visual design round — Sable Trackers side panel

You are one of two contestants (the other is a different AI). Same brief, same starting code. The user will compare screenshots taken in a real SillyTavern on a 412×915 phone viewport and pick the one they like. Make it beautiful and usable; keep it honest to the constraints below.

Read AGENTS.md and SPEC.md §6 first. Scope: `style.css`, `src/ui/drawer.js` (and its test, `test/drawer.test.mjs`), i18n labels if needed. No behaviour changes in run/store/prompt/parse/merge/digest. `npm test` must stay green (48 tests now); update tests that describe the old look; add tests for what you add.

## Hard constraints (SillyTavern facts)
1. SillyTavern puts `transform` and `perspective` on `<html>`, so `<html>` (0 px tall) is the containing block of every `position: fixed` element. `top + bottom` stretching yields height 0. Always give fixed elements an explicit height (`100dvh`, `calc(100dvh - …)`) and explicit `top`/`left`/`right`.
2. The phone layout is a **docked side panel**: right edge, full height (100dvh), width 80vw (max 420px), the chat stays visible on the left. Not a floating window. On desktop (> 700px) a docked 420px right panel, full height.
3. **No floating button.** Replace it with an **edge pull tab**: a narrow vertical tab glued to the right edge of the screen, vertically centred (top 50%, translateY(-50%)), about 22×72 px, glass, with a small icon (wand or chevron). Tapping it opens the panel. While the panel is open the tab sits on the panel's LEFT edge (outside it, `left: -22px` relative to the panel, rounded on the left side) and closes it. Keep the `showFloatingButton` setting as the switch for the tab (rename its label to «Язычок сбоку» / "Edge tab"). Drop the drag/position code and the `floatingPosition` setting handling in the drawer (leave settings.js as is).
4. The wand-menu entry stays (native ST markup, `fa-wand-magic-sparkles`).
5. Model text is untrusted: `textContent` only, no `innerHTML` with data. Keep `{{user}}`/`{{char}}` replacement.
6. Font Awesome 6 solid icons are available (`<i class="fa-solid fa-…">`). Emoji are fine for section icons.
7. Tap targets ≥ 36 px (mode chip ≥ 32 px because it sits in a 44 px header row). Text ≤ 18 px. Base 13 px.
8. Keep all class names prefixed `st-sable-`; keep `data-section` attributes and existing element roles (the tests and the bottom panel rely on them). Use the theme's `--SmartThemeBodyColor` for text so it stays readable on any ST theme; the panel itself is dark glass regardless of theme.

## What "better" means to the user
- The reference look is Megumin Suite's side panel (`docs/drawer-reference.jpg`): dark translucent glass, large rounded cards, thin light border, white accent bar on the left of each card, compact bold titles, a "—" empty state. They like it; they want ours at least as clean.
- Fewer visual layers: every card should read at a glance — title row, then content. Present NPCs first and prominent; absent ones folded and dim.
- Bond scales: readable bars with the number, delta badges (+5 / −3) coloured, reason on tap.
- Threads with priority dots (red/amber/grey). Seeds 🌱 and timers ⏳ as a tidy list; phase chips small.
- Ban list as small chips. Planner as a numbered list.
- Status line small and quiet at the bottom.
- Nothing jumps while typing; no animation longer than 150 ms.

## Deliverable
Working tree changes (no commit needed), `npm test` green, `node --check` on changed files, and a short DESIGN-NOTES.md (≤ 15 lines) saying what you changed and why. You cannot see the result in a browser here; write CSS you are confident about.
