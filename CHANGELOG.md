# Changelog

## 0.2.0 — 3 October 2026

### Группы, тайны и инструкции по пакам

**Группы.** Карточки можно складывать в свои группы, как категории в Discord. Под карточкой появилась кнопка **«В группу…»**: список ваших групп, «Без группы», «Новая группа…». У группы та же шапка, что у пака: ручка, значок с названием, общая плашка режима (один тап переключает все карточки внутри), сворачивание. Внизу группы **«Редактировать группу»**: название, значок, удаление в два тапа (карточки возвращаются в список). Группы общие для всех чатов. **Настройки → Секции → «Разложить по группам»** создаёт «Мир», «Люди» и «Сюжет» одним тапом.

<p>
<img src="docs/screenshots/folders.png" width="260" alt="Группы в панели">
<img src="docs/screenshots/folder-menu.png" width="260" alt="Меню «В группу…» под карточкой">
<img src="docs/screenshots/folder-editor.png" width="260" alt="Редактор группы">
</p>

**Тайна и «На самом деле».** В строке персонажа первым идёт **«Собирается»** (что NPC собирается сделать прямо сейчас), а тайна и новое поле **«На самом деле»** (одна фраза о том, что он правда чувствует под тем, что показывает) спрятаны за кнопкой **«Тайна»**. Новый ответ персонажа или смена чата закрывают спойлеры обратно. В основной промпт эти поля не попадают. Галочка **Настройки → Секции → «Тайны и «на самом деле» за спойлером»** выключает прятки.

<p>
<img src="docs/screenshots/secret-closed.png" width="260" alt="Строка NPC со свёрнутой тайной">
<img src="docs/screenshots/secret-open.png" width="260" alt="Строка NPC с открытой тайной">
</p>

**Инструкции по пакам.** В «Опасной зоне» инструкции встроенных паков сгруппированы: правила набора первой строкой, затем карточки пака, с пометкой «изменено» на шапке, если что-то внутри отличается от умолчания.

<p>
<img src="docs/screenshots/instructions-by-pack.png" width="260" alt="Инструкции модели, сгруппированные по пакам">
</p>

**Интим: две весёлые карточки.** **«Ачивки»** (значки в духе игровых достижений за явные события в тексте) и **«Комментатор»** (одна-две ехидные фразы голосом спортивного комментатора, документалки о природе, таблоида или телешоу). По умолчанию только показ, в промпт не идут, взрослый гард тот же.

### Groups, secrets and instructions by pack

**Groups.** Cards can be put into your own groups, like Discord categories. A card's footer gained **Group…**: your groups, **No group**, **New group…**. A group has the same header as a pack: handle, icon and title, a shared mode chip (one tap switches every card inside), fold. The group ends with **Edit group**: title, icon, a two-tap delete (the cards return to the list). Groups are global across chats. **Settings → Sections → Suggested groups** creates World, People and Story in one tap.

**Secret and Deep down.** The NPC row starts with **About to** (what the NPC is about to do), while the secret and the new **Deep down** field (one phrase of what the NPC really feels beneath the shown behaviour) sit behind a **Secret** button. A new reply or a chat change hides them again. Neither field enters the main prompt. **Settings → Sections → Secrets and truths behind a tap** turns the hiding off.

**Instructions by pack.** In the Danger zone the built-in packs' instructions are grouped: the pack rules first, then the pack's cards, with a "changed" badge on the group while anything inside differs from the default.

**Intimacy: two playful cards.** **Achievements** (video-game style badges for explicit events) and **Commentator** (a tongue-in-cheek line or two in the voice of a sports commentator, a nature documentary, a tabloid or a dating show). Shown by default, not injected, the same adult guard.

## 0.1.0 — 30 September 2026

Initial public release.
