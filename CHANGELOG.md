# Changelog

## 0.3.0 — 3 October 2026

### Шкалы по выбору, раскладка по персонажам, визуал отношений, «Интим+»

**Шкалы отношений** (Настройки → «Шкалы отношений»). Десять встроенных шкал включаются и выключаются по одной, с подписью, что каждая меряет; до шести своих шкал с ключом, названием, фразой для вспомогательной модели и флажком «Высокое значение = трение». Выключенная шкала исчезает из панели, промпта и схемы; инструкция по умолчанию пересобирается из включённых, а своя инструкция в «Опасной зоне» заменяет её целиком.

<p>
<img src="docs/screenshots/bond-scales.png" width="260" alt="Группа «Шкалы отношений» в настройках">
<img src="docs/screenshots/bond-visuals.png" width="260" alt="Карточка отношений с мини-графиками и знаковой шкалой">
</p>

**Визуал отношений.** Под каждой шкалой мини-график за последние двенадцать ответов (Внешний вид → Карточки → «Мини-графики под шкалами»). У любой шкалы, встроенной или своей, галочка «−100…+100»: полоска идёт от центра, влево тёплым, вправо акцентом, число со знаком; модели дописывается, что минус означает противоположное чувство. Сохранённые значения при переключении не меняются.

**Раскладка «по персонажам»** (Настройки → Секции → «Раскладка панели»). Вместо карточек «Персонажи», «Мысли», «Отношения» и «Досье» одна группа «Люди», а внутри по карточке на каждого NPC: присутствие, настроение, «Собирается» и поля, «Тайна» за спойлером, мысль, полоски отношений, досье. Остальные карточки, паки и папки как были. Редактирование пока в раскладке по темам.

<p>
<img src="docs/screenshots/layout-people.png" width="260" alt="Раскладка по персонажам: группа «Люди»">
<img src="docs/screenshots/intimacy-plus.png" width="260" alt="Карточки пака «Интим+»">
<img src="docs/screenshots/packs-sheet.png" width="260" alt="Лист паков с тремя паками">
</p>

**Пак «Интим+ (18+)».** Второй, более откровенный пак, включается отдельно или вместе с «Интимом»: «Оргазм» шкалой накопления, «Контакт» (проникновение, финал), «Зоны» по отдельности, «Кинки» и «Антикинки» только из показанного опыта, «Опыт» как журнал, «После» как состояние после акта. Взрослый гард и охват «кроме меня» те же.

### Scales by choice, layout by people, bond visuals, Intimacy+

**Bond scales** (Settings → Bond scales). The ten built-in scales switch on and off one by one, each with a one-line description; up to six custom scales with a key, a title, a sentence for the side model and a "High value = friction" flag. A switched-off scale leaves the drawer, the prompt and the schema; the default instruction is rebuilt from the enabled scales, while an override in the Danger zone replaces it whole.

**Bond visuals.** A small history line under each scale for the last twelve replies (Appearance → Cards → "History sparklines under scales"). Any scale, built-in or custom, can be signed with a "−100…+100" checkbox: the bar grows from the centre, warm to the left and accent to the right, the number signed; the side model is told that negative means the opposite feeling. Stored values are not rewritten.

**Layout by people** (Settings → Sections → "Drawer layout"). Instead of the NPCs, NPC Inner Chatter, Bonds and New NPC Dossiers cards, one "People" group with a card per NPC: presence, mood, About to and the fields, the Secret spoiler, the thought, the bond bars, the dossier. Everything else renders as before. Editing stays in the topics layout for now.

**Intimacy+ pack (18+).** A second, more explicit pack that works alone or with Intimacy: Climax as a build-up scale, Contact (penetration, release), Zones one by one, Kinks and Dislikes only from shown experience, Experience as a log, Afterglow as the state after the act. The same adult guard and "everyone but me" scope.

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
