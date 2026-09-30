# Sable Trackers

Scene-state tracking for SillyTavern 1.19.x, with Russian output by default and English available. A separate, inexpensive side model updates scene notes after character replies. Your main model receives a compact digest of the sections you choose. State is saved in chat metadata; replies and message extras are never rewritten. Group chats are not supported.

[По-русски](#ru)

## Install and set up

1. Copy this repository's URL from its repository page.
2. In SillyTavern, open **Extensions → Install extension**, paste the repository URL, and install. Reload SillyTavern.
3. Create a **chat-completion** connection profile for an inexpensive model in SillyTavern's Connection Manager.
4. Open **Extensions → Sable Trackers**, enable the extension, and select that profile. Text-completion profiles appear disabled.
5. Choose the output language. Turn off any other tracker that writes tracking blocks into the reply.
6. Open a character chat and generate a reply, or press **Run now** to update from the latest character reply.

Open the scene drawer from the edge tab, the extensions wand menu, or the panel under the latest character reply. The gear opens settings. The drawer supports folding, reordering and pinning. Settings can hide the reply panel or edge tab.

## Sections and modes

| Section | Contents | Default mode / period |
| --- | --- | --- |
| World | Time, place, weather and user-character condition | inject / 1 |
| Offscreen | Last known activity of absent NPCs | show / 1 |
| Open Threads | Open questions and conflicts | inject / 1 |
| Story | Seeds, deadlines and scene/arc phases | inject / 1 |
| NPCs | Presence, mood, outfit, intentions and actions | inject / 1 |
| NPC Inner Chatter | Private NPC thoughts | show / 1 |
| Bonds | Relationship scales and changes | inject / 1 |
| New NPC Dossiers | Brief dossiers, added once per new NPC | show / 0 |
| Story Planner | Possible next beats and a reminder | show / 5 |
| Ban List | Repeated phrases to avoid | inject / 3 |

**inject** requests, displays and includes the section in the main prompt. **show** requests and displays it without injection. **off** skips requests and injection, retaining the previous value for later.

Periods count character replies and apply globally. Dossiers always check for new names; their default 0 denotes this special behavior. Other sections with period 0 update every reply. The drawer's mode chip cycles modes; settings also provide mode selectors. Enable **Mode changes apply to this chat only** to save subsequent mode changes as chat overrides. Existing overrides remain active until **Reset overrides for this chat** is pressed; this preserves the tracked state and global settings.

**Import from old Sable** is available only when this chat has no tracked state and compatible legacy data exists. Import is explicit and reads legacy message data without changing it.

**Custom blocks** (settings → Custom blocks): **Add block** creates a block with a title, an icon (one emoji or a Font Awesome class such as `fa-magnifying-glass`), a shape (text, list or key: value), a list cap (1–20), a mode, a period and your instructions for the side model. Delete takes two taps.

**Appearance** (settings → Appearance) adjusts the drawer's glass opacity, blur, font size, phone width, accent colour, corner radius and title icons (outline or emoji). For light themes, pick a **Base colour**: borders, dividers and text switch to black or white automatically, whichever reads better on it. **Text colour** overrides the text only. **auto** returns either one to the default dark glass / theme text. Sliders preview live while dragging; **Restore default look** resets everything.

## Token and storage notes

The side model reads the previous enabled state, the last 4 messages by default, up to 6000 character-card characters, up to 4000 activated-lore characters, and a short persona. It does not read the whole chat or lorebook. The output limit defaults to 3000 tokens. Reduce message/card/lore limits, turn unused sections off, or increase periods to reduce side-model usage. `show` still costs side-model tokens.

Only `inject` sections enter the main prompt, at depth 2 by default, with a digest capped at about 6000 characters. Drawer token counts are estimates based on characters, not billing totals. The saved-state ring defaults to 3 entries per chat; this controls retained history, not model context length.

## Troubleshooting

- **No profile:** create a Connection Manager profile and select it in Sable settings. Reopen the settings block if the list is outdated. A deleted selection is shown as missing.
- **Not chat-completion:** use a profile whose completion mode is chat-completion. Text-completion profiles cannot be selected.
- **Empty or invalid output:** check that the profile works, increase the output token limit if the response was cut off, then try **Run now**. The model should return a JSON object inside `<sable_state>` tags. Invalid sections retain their previous values; inspect the drawer status and browser console for errors.
- **Nothing updates:** check Enabled, the selected profile, section modes and periods, and that the chat has a character reply. Group chats are unsupported. After editing the latest reply, refresh manually.

<a id="ru"></a>

## Кратко по-русски

Sable Trackers хранит состояние сцены отдельно от сообщений. Недорогая вспомогательная модель обновляет трекеры, а основная получает только краткую выжимку выбранных разделов.

Установка: скопируйте URL этого репозитория, откройте **Extensions → Install extension**, вставьте URL и перезагрузите SillyTavern. В **Extensions → Sable Trackers** включите расширение и выберите профиль **chat-completion** для недорогой модели. Отключите другие трекеры, записывающие блоки в ответ. Русский язык выбран по умолчанию.

Режимы: **в промпт** — обновлять, показывать и передавать основной модели; **показ** — только обновлять и показывать; **выкл** — не запрашивать раздел, сохранив старое значение. Период задаётся в ответах персонажа. Переключатель «только для этого чата» сохраняет локальные режимы, кнопка сброса возвращает общие. «Обновить сейчас» запускает обновление вручную. Импорт старого Sable доступен при наличии совместимых данных и пустой истории трекера.

Если нет обновлений, проверьте профиль, режим chat-completion и включённые разделы. При пустом ответе проверьте модель, увеличьте лимит токенов и повторите обновление. Групповые чаты не поддерживаются.

## Credits

The drawer look is inspired by the side panel of [Megumin Suite](https://github.com/Arif-salah/Megumin-Suite) by Arif-salah. This extension shares no code with it.
