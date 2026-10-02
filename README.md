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

Open the scene drawer from the edge tab, the extensions wand menu, or the panel under the latest character reply. The gear opens settings. Settings groups fold and remember their open or closed state. The drawer supports folding, reordering and pinning. The pen button on a card opens an editor for that section: fix a field, add or remove rows, then Save (the change is injected into the next reply) or Cancel. Settings can hide the reply panel or edge tab. After editing the latest reply, its old state is no longer injected; enable **Context → Recompute after editing a reply** (off by default) to recompute it immediately.

While an update is running, the status says “updating…” with a pulsing dot and a spinning ⟳ (the **Effects** level “off” stops every animation). Tapping ⟳ for the same reply keeps that update running; otherwise it updates all enabled sections regardless of period. Folding, pinning and appearance changes never interrupt an update.

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

Periods count character replies and apply globally. Dossiers always check for new names; their default 0 denotes this special behavior. Other sections with period 0 update every reply. Tap the drawer's mode chip to choose a mode from its menu; settings also provide mode selectors. Enable **Mode changes apply to this chat only** to save subsequent mode changes as chat overrides. Existing overrides remain active until **Reset overrides for this chat** is pressed; this preserves the tracked state and global settings.

Tap a card header to fold or unfold it. Switched-off sections are hidden by default: **Hidden: N** reveals them so you can switch them back on, and **Hide** hides them again. Disable **Actions → Hide switched-off sections** to always show their dimmed cards. In **Sections**, use **▲ ▼** to reorder built-in and custom sections; dragging the drawer handle still works.

**Import from old Sable** is available only when this chat has no tracked state and compatible legacy data exists. Import is explicit and reads legacy message data without changing it.

**Custom blocks** (settings → Custom blocks): **Add block** creates a block with a title, an icon (one emoji or a Font Awesome class such as `fa-magnifying-glass`), a shape (text, list or key: value), a list cap (1–20), a mode, a period and your instructions for the side model. Delete takes two taps.

**Appearance** (settings → Appearance) adjusts the drawer's glass opacity, blur, font size, phone width, accent colour, corner radius and title icons (outline or emoji). For light themes, pick a **Base colour**: borders, dividers and text switch to black or white automatically, whichever reads better on it. **Text colour** overrides the text only. **auto** returns either one to the default dark glass / theme text. Sliders preview live while dragging; **Restore default look** resets everything. **Card colours** gives each built-in or custom card its own bar, chip and border colour; **auto** returns it to the shared accent.

The group has five parts. **Panel**: glass and colours. **Cards**: corner radius, card fill, borders, title font (theme, serif, monospace, rounded — rounded only where such a font is installed) and weight, the look of the "inject" chip (filled or outline), spacing (cozy or compact), icons and the accent bar. **Background**: choose a picture (it is shrunk to 1280 px and saved in the extension settings, so every device that shares them shows it; over 600 KB after shrinking is refused) or paste an http(s) link; **Dimming** and **Fit** (fill, whole picture, tile) tune it. **Theme**: presets Glass, Paper and Neon set colours and style but keep your background, font size, width and effects; **Save theme file** downloads `sable-theme.json` (the whole look, picture included) and **Load theme file** applies one.

**Effects** is a level you pick: **off** stops every animation and transition, **subtle** (the default) makes bars slide to their new values, fades in change badges, brightens the accent bar of a changed card for a moment and marks it with a dot after the title until you unfold it or the next update, and lets you tap a stat row with a note to read it. **full** unlocks a set of effects that are each off until you switch them on: glow (colour and intensity), shimmer (speed and colour), rain behind the cards (density, colour, angle), numbers that tick to their new value, bars that shade towards the warning tint as they drop and pulse under 20 %, a dice spin with a result flash and a crit glow, and a glow pulse instead of the plain accent flash on changed cards (the reply panel's bars pulse too). Everything is plain CSS and DOM: no canvas, no libraries, nothing runs while you type, and the system reduced-motion setting forces “off”. Presets leave the level and the effects alone; theme files carry them. The reply panel shows one compact line per enabled pack (`HP 40/100 · stamina 70/100`, bars included) at every level.

## Packs

Packs bundle sections and side-model rules for a scene. They are off by default and switched per chat with 🎒 in the drawer header or the **Packs** settings group. Switching on does not start a request: generate the next reply or refresh. Switching off keeps the stored values. Scope offers **all / only me / everyone but me**; Combat defaults to all, Intimacy to everyone but you, leaving your character’s state, feelings and responses to you.

In the drawer an enabled pack is one **group**: a card-like container with the pack title, a drag handle, a fold chevron and a group mode chip, with the pack’s cards nested inside. Each nested card keeps its own mode chip, so you switch on only the cards you need; the group chip shows their common mode or **mixed** and sets every card of the pack at once. Drag the group handle (or press ↑/↓ on it) to move the whole pack among the other cards; a nested card moves only inside its pack. Switched-off cards hide inside the group and count in **Hidden: N**; a pack whose cards are all off hides until you reveal them.

- **Combat** tracks the fight, HP, stamina, wounds and estimated odds; unresolved attacks stay unresolved.
- **Intimacy (18+)** tracks position, pace, consent state, arousal (a labelled estimate in any scene, so flirting shows too), stamina, explicit counters and visible marks only when every participant is an established adult; otherwise its values are empty.

Create user packs or make an editable copy of a built-in pack, and export/import them as `sable-pack.json`. On stats or key/value rows whose key ends in `%` (including custom blocks), 🎲 rolls d100 locally without a model request. The result appears inline next to the button and is appended to the main prompt as a one-shot `ROLL` line for the next action. When the next character reply arrives, the line is removed and the inline result dims; swiping that reply does not reuse the roll. The latest roll replaces the previous one and is stored per chat, independently of edits or refreshes. **Danger zone → Show prompt** also shows the main prompt injection. The extension rolls or decides nothing else; a roll does not establish a hit or damage.

## Danger zone

The **Danger zone** group in settings (closed by default) lets you override the side model's common rules and each built-in section's instructions, with a **Default** button per field and **Reset all instructions**. **Show prompt** builds exactly the next **Run now** request without sending it; **Copy** puts it on the clipboard. The **Request log** keeps the last five runs with the request, the raw response, status and timing, with copy buttons, **Download log** (`sable-log.json`) and **Clear**. The JSON schema and output format stay fixed. The log lives in memory only, survives chat switches and is lost on reload.

## Token and storage notes

The side model reads the previous enabled state, the last 4 messages by default, up to 6000 character-card characters, up to 4000 activated-lore characters, and a short persona. It does not read the whole chat or lorebook. The output limit defaults to 3000 tokens. Reduce message/card/lore limits, turn unused sections off, or increase periods to reduce side-model usage. `show` still costs side-model tokens.

Only `inject` sections enter the main prompt, at depth 2 by default, with a digest capped at about 6000 characters. **Injection role** (system by default) is the role of that block: if the state block starts showing up in replies, try "user". Drawer token counts are estimates based on characters, not billing totals. The saved-state ring defaults to the last 3 messages per chat, every swipe of each included; this controls retained history, not model context length.

## Troubleshooting

- **No profile:** create a Connection Manager profile and select it in Sable settings. Reopen the settings block if the list is outdated. A deleted selection is shown as missing.
- **Not chat-completion:** use a profile whose completion mode is chat-completion. Text-completion profiles cannot be selected.
- **Empty or invalid output:** check that the profile works, increase the output token limit if the response was cut off, then try **Run now**. The model should return a JSON object inside `<sable_state>` tags. Invalid sections retain their previous values; inspect the drawer status and browser console for errors.
- **Nothing updates:** check Enabled, the selected profile, section modes and periods, and that the chat has a character reply. Group chats are unsupported. After editing the latest reply, refresh manually or enable **Recompute after editing a reply**.

<a id="ru"></a>

## Кратко по-русски

После правки последнего ответа его старое состояние больше не вставляется в промпт; настройка «Контекст → Пересчитывать после правки ответа» (по умолчанию выключена) пересчитывает его сразу.

В панели включённый пак — это одна **группа**: карточка-контейнер с названием пака, ручкой перетаскивания, кнопкой сворачивания и общей плашкой режима, внутри которой лежат карточки пака. У каждой вложенной карточки своя плашка режима, так что можно включить только нужные; плашка группы показывает их общий режим или **смешано** и задаёт режим всем карточкам пака сразу. Ручка группы (или ↑/↓ на ней) двигает весь пак среди остальных карточек; вложенная карточка двигается только внутри своего пака. Выключенные карточки скрываются внутри группы и учитываются в **Скрыто: N**; пак, у которого выключены все карточки, скрыт, пока вы их не покажете.

Паки — наборы секций и правил для сцены, по умолчанию выключенные: включайте их для текущего чата через 🎒 в заголовке панели или группу «Паки» в настройках, затем обновите трекеры или дождитесь следующего ответа. «Бой» отслеживает ход боя, здоровье, силы, раны и шансы; «Интим (18+)» — положение, темп, согласие, возбуждение (осторожная оценка в любой сцене, флирт тоже виден), силы, явные счётчики и видимые следы, только если все участники заведомо взрослые, иначе значения пустые. Охват: «все / только я / кроме меня»; по умолчанию «Бой» учитывает всех, а «Интим» — всех кроме вашего персонажа, оставляя его состояние, чувства и реакции вам. Можно создавать свои паки, копировать встроенные и обмениваться файлами `sable-pack.json` через экспорт и импорт. Кнопка 🎲 у ключей с `%` в показателях и парах ключ/значение, включая свои блоки, бросает d100 локально, без запроса к модели: результат виден рядом с кнопкой и однократно добавляется строкой `ROLL` в промпт для следующего действия. После ответа персонажа строка исчезает из вставки, а результат тускнеет; свайп этого ответа не возвращает бросок. Последний бросок хранится отдельно для каждого чата до следующего и не меняется при правке или обновлении секций. Больше расширение ничего не разыгрывает и не решает, а бросок сам по себе не означает попадание или урон.

Sable Trackers хранит состояние сцены отдельно от сообщений. Недорогая вспомогательная модель обновляет трекеры, а основная получает только краткую выжимку выбранных разделов.

Установка: скопируйте URL этого репозитория, откройте **Extensions → Install extension**, вставьте URL и перезагрузите SillyTavern. В **Extensions → Sable Trackers** включите расширение и выберите профиль **chat-completion** для недорогой модели. Отключите другие трекеры, записывающие блоки в ответ. Русский язык выбран по умолчанию. Группы настроек сворачиваются и запоминают своё открытое или закрытое состояние.

Режимы: **в промпт** — обновлять, показывать и передавать основной модели; **показ** — только обновлять и показывать; **выкл** — не запрашивать раздел, сохранив старое значение. Период задаётся в ответах персонажа. Переключатель «только для этого чата» сохраняет локальные режимы, кнопка сброса возвращает общие. «Обновить сейчас» запускает обновление вручную. Импорт старого Sable доступен при наличии совместимых данных и пустой истории трекера.

Нажмите на плашку режима и выберите вариант в меню. Нажатие на заголовок карточки сворачивает или разворачивает её. Выключенные разделы по умолчанию скрыты: **Скрыто: N** временно показывает их для включения, **Скрыть** убирает снова. Настройка **Действия → Скрывать выключенные** отключает это скрытие. В таблице **Секции** кнопки **▲ ▼** меняют порядок встроенных и своих блоков; перетаскивание за ручку в панели тоже работает.

Внешний вид (настройки → «Внешний вид»): «Панель» — стекло и цвета; «Эффекты» — уровень «выкл / мягко / полные»: «мягко» плавно двигает полоски и подсвечивает изменения, «полные» открывает набор эффектов (свечение, блик, дождь, бегущие числа, цвет полоски по значению, анимация кубика, вспышка свечения), каждый из которых включается отдельно, а системная настройка «меньше движения» выключает всё; «Карточки» — скругление, заливка, рамки, шрифт и жирность заголовков, кнопка «в промпт» (залитая или контур), плотность, значки и полоса слева; «Фон» — картинка с устройства (сжимается до 1280 px и хранится в настройках расширения, поэтому видна на всех устройствах; больше 600 КБ после сжатия не принимается) или ссылка http(s), затемнение и размещение; «Тема» — пресеты «Стекло», «Бумага», «Неон» (фон, размер шрифта, ширина и эффекты остаются), «Экспорт темы» в файл `sable-theme.json` вместе с картинкой и «Импорт темы». «Сбросить вид» возвращает всё по умолчанию.

«Опасная зона» (в настройках, свёрнута по умолчанию): общие правила и инструкции каждой встроенной секции можно переписать, у каждого поля есть кнопка «По умолчанию», внизу — «Сбросить все инструкции». «Показать промпт» собирает в точности следующий запрос «Обновить сейчас», не отправляя его; «Копировать» кладёт его в буфер. «Журнал запросов» хранит последние пять запусков: запрос, сырой ответ, статус и время, с копированием, «Скачать журнал» (`sable-log.json`) и «Очистить». Схема JSON и формат ответа не меняются. Журнал живёт только в памяти, переживает смену чата и исчезает при перезагрузке.

«Роль вставки» (по умолчанию «система») — роль блока состояния в промпте: если блок состояния начал появляться в ответах, попробуйте «пользователь».

Если нет обновлений, проверьте профиль, режим chat-completion и включённые разделы. При пустом ответе проверьте модель, увеличьте лимит токенов и повторите обновление. Групповые чаты не поддерживаются.

## Credits

The drawer look is inspired by the side panel of [Megumin Suite](https://github.com/Arif-salah/Megumin-Suite) by Arif-salah. This extension shares no code with it.
