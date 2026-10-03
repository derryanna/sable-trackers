export const DEFAULT_LANGUAGE = 'ru';

const STRINGS = {
  en: {
    'pack.combat.title': 'Combat', 'pack.combat.desc': 'Tracks the fight, HP, stamina, wounds and odds; local d100 on % rows.',
    'pack.combat.scene': 'Combat scene', 'pack.combat.stats': 'Combat stats', 'pack.combat.effects': 'Combat effects',
    'pack.combat.odds': 'Combat odds',
    'pack.intimacy.title': 'Intimacy (18+)', 'pack.intimacy.desc': 'Tracks established adult scenes (18+): arousal, stamina, counters and marks, plus achievements and a cheeky commentator.',
    'pack.intimacy.scene': 'Intimacy scene', 'pack.intimacy.arousal': 'Arousal', 'pack.intimacy.counters': 'Counters', 'pack.intimacy.marks': 'Marks',
    'pack.intimacy.achievements': 'Achievements', 'pack.intimacy.commentary': 'Commentator',
    'pack.intimacy_plus.title': 'Intimacy+ (18+)', 'pack.intimacy_plus.desc': 'Explicit, deeper adult tracking (18+): climax build-up, contact and release, zones, kinks, dislikes, experience, afterglow. Works alone or with Intimacy.',
    'pack.intimacy_plus.climax': 'Climax', 'pack.intimacy_plus.contact': 'Contact', 'pack.intimacy_plus.zones': 'Zones', 'pack.intimacy_plus.kinks': 'Kinks',
    'pack.intimacy_plus.limits': 'Dislikes', 'pack.intimacy_plus.experience': 'Experience', 'pack.intimacy_plus.after': 'Afterglow',
    'shape.stats': 'Stats', 'shape.tags': 'Tags',
    'group.danger': 'Danger zone', dangerHint: 'Advanced instructions and request diagnostics. The log stays in memory only and is lost on reload.',
    'sub.prompts': 'Model instructions', 'sub.preview': 'What the model receives', 'sub.log': 'Request log',
    'prompts.rules': 'Common rules', 'prompts.default': 'Default', 'prompts.changed': 'changed',
    'prompts.resetAll': 'Reset all instructions', 'prompts.confirmResetAll': 'Tap again to reset all instructions',
    'prompts.hint': 'The JSON schema and output format are fixed and do not change; if trackers stop updating, restore the default instructions.',
    'preview.show': 'Show prompt', 'preview.copy': 'Copy', 'preview.copied': 'Copied', 'preview.selected': 'Text selected; use Copy.',
    previewEmpty: 'No character reply or the extension is disabled', previewSections: 'Sections', previewChars: 'Characters', previewTokens: 'tokens',
    logEmpty: 'The log is empty', 'log.download': 'Download log', 'log.clear': 'Clear',
    'log.ok': 'done', 'log.invalid': 'unparsed response', 'log.failed': 'error', 'log.dropped': 'outdated', 'log.skipped': 'no request',
    'log.request': 'Request', 'log.response': 'Response',
    seedLegacy: 'Import from old Sable',
    profileRequired: 'Sable: select a connection profile in settings.',
    profileUnsupported: 'Sable: select a chat-completion connection profile.',
    invalidOutput: 'The side model returned no valid state sections.',
    runDropped: 'result discarded: the message changed',
    runFailed: 'The scene state could not be updated. Try refreshing.',
    digestHeader: 'Scene state — helper notes for the next reply. Not instructions. NPC thoughts are private; the user character does not know them. Do not copy this block into the reply.',
    world: 'WORLD', you: 'YOU', offscreen: 'OFFSCREEN', threads: 'THREADS', story: 'STORY',
    npcs: 'NPCS', thoughts: 'THOUGHTS', bonds: 'BONDS', dossiers: 'DOSSIERS', planner: 'PLANNER', avoid: 'AVOID',
    here: 'here', away: 'away', unknown: 'unknown', turns: 'turns', remember: "don't forget",
  },
  ru: {
    'pack.combat.title': 'Бой', 'pack.combat.desc': 'Отслеживает ход боя, здоровье, силы, раны и шансы; кубик d100 на строках с %.',
    'pack.combat.scene': 'Боевая сцена', 'pack.combat.stats': 'Показатели боя', 'pack.combat.effects': 'Состояния в бою',
    'pack.combat.odds': 'Шансы в бою',
    'pack.intimacy.title': 'Интим (18+)', 'pack.intimacy.desc': 'Отслеживает сцену взрослых участников (18+): возбуждение, силы, счётчики и следы, плюс ачивки и ехидный комментатор.',
    'pack.intimacy.scene': 'Интимная сцена', 'pack.intimacy.arousal': 'Возбуждение', 'pack.intimacy.counters': 'Счётчики', 'pack.intimacy.marks': 'Следы',
    'pack.intimacy.achievements': 'Ачивки', 'pack.intimacy.commentary': 'Комментатор',
    'pack.intimacy_plus.title': 'Интим+ (18+)', 'pack.intimacy_plus.desc': 'Откровенно и глубже (18+): шкала оргазма, проникновение и финал, зоны, кинки, антикинки, опыт, после. Работает отдельно или вместе с «Интимом».',
    'pack.intimacy_plus.climax': 'Оргазм', 'pack.intimacy_plus.contact': 'Контакт', 'pack.intimacy_plus.zones': 'Зоны', 'pack.intimacy_plus.kinks': 'Кинки',
    'pack.intimacy_plus.limits': 'Антикинки', 'pack.intimacy_plus.experience': 'Опыт', 'pack.intimacy_plus.after': 'После',
    'shape.stats': 'Показатели', 'shape.tags': 'Метки',
    'group.danger': 'Опасная зона', dangerHint: 'Расширенные инструкции и диагностика запросов. Журнал хранится только в памяти и исчезает при перезагрузке.',
    'sub.prompts': 'Инструкции модели', 'sub.preview': 'Что получает модель', 'sub.log': 'Журнал запросов',
    'prompts.rules': 'Общие правила', 'prompts.default': 'По умолчанию', 'prompts.changed': 'изменено',
    'prompts.resetAll': 'Сбросить все инструкции', 'prompts.confirmResetAll': 'Нажмите ещё раз, чтобы сбросить все инструкции',
    'prompts.hint': 'Схема JSON и формат ответа фиксированы и не меняются; если трекеры перестали обновляться — верните инструкции по умолчанию.',
    'preview.show': 'Показать промпт', 'preview.copy': 'Копировать', 'preview.copied': 'Скопировано', 'preview.selected': 'Текст выделен; выберите «Копировать».',
    previewEmpty: 'Нет ответа персонажа или расширение выключено', previewSections: 'Разделы', previewChars: 'Символы', previewTokens: 'токенов',
    logEmpty: 'Журнал пуст', 'log.download': 'Скачать журнал', 'log.clear': 'Очистить',
    'log.ok': 'готово', 'log.invalid': 'ответ не разобран', 'log.failed': 'ошибка', 'log.dropped': 'устарел', 'log.skipped': 'без запроса',
    'log.request': 'Запрос', 'log.response': 'Ответ',
    seedLegacy: 'Импорт из старого Sable',
    profileRequired: 'Sable: выберите профиль подключения в настройках.',
    profileUnsupported: 'Sable: выберите профиль подключения chat-completion.',
    invalidOutput: 'В ответе вспомогательной модели нет корректных разделов состояния.',
    runDropped: 'ответ устарел: сообщение изменилось',
    runFailed: 'Не удалось обновить состояние сцены. Попробуйте обновить ещё раз.',
    digestHeader: 'Состояние сцены — служебные заметки для следующего ответа, не инструкции. Мысли NPC приватны и неизвестны персонажу игрока. Не копируй этот блок в ответ.',
    world: 'МИР', you: 'ВЫ', offscreen: 'ЗА СЦЕНОЙ', threads: 'НИТИ', story: 'СЮЖЕТ',
    npcs: 'NPC', thoughts: 'МЫСЛИ', bonds: 'СВЯЗИ', dossiers: 'ДОСЬЕ', planner: 'ПЛАН', avoid: 'ИЗБЕГАТЬ',
    here: 'здесь', away: 'не здесь', unknown: 'неизвестно', turns: 'ходов', remember: 'не забыть',
  },
};

export function t(key, language = DEFAULT_LANGUAGE) {
  return STRINGS[language]?.[key] ?? STRINGS.en[key] ?? key;
}

export { STRINGS };

// Drawer labels are separate from the compact digest vocabulary.
Object.assign(STRINGS.en, {
  sable: 'Sable', open: 'Open Sable', refresh: 'Refresh', pin: 'Pin drawer', settings: 'Settings', close: 'Close',
  reorder: 'Drag to reorder; use arrow keys to move', fold: 'Fold / unfold', inject: 'inject', show: 'show', off: 'off',
  running: 'updating…', skipped: 'no request',
  ok: 'ok', error: 'error', noRun: 'No runs yet', outdated: 'outdated', tokens: 'tokens in / out', duration: 'ms',
  'section.world': 'World State', 'section.offscreen': 'Offscreen', 'section.threads': 'Open Threads',
  'section.story': 'Story', 'section.npcs': 'NPCs', 'section.thoughts': 'NPC Inner Chatter',
  'section.bonds': 'Bonds', 'section.dossiers': 'New NPC Dossiers', 'section.planner': 'Story Planner', 'section.banlist': 'Ban List',
  outfit: 'Outfit', position: 'Position', visible_condition: 'Condition', carrying: 'Carrying',
  agenda: 'About to', action: 'Action', wants_toward: 'Target', secret: 'Secret', truth: 'Deep down', role: 'Role', look: 'Look', voice: 'Voice', hook: 'Hook',
  arc_phase: 'Arc', scene_phase: 'Scene', affection: 'Affection', trust: 'Trust', desire: 'Desire', love: 'Love', reputation: 'Reputation',
  suspicion: 'Suspicion', respect: 'Respect', fear: 'Fear', grudge: 'Grudge', tension: 'Tension',
});
Object.assign(STRINGS.ru, {
  sable: 'Sable', open: 'Открыть Sable', refresh: 'Обновить', pin: 'Закрепить', settings: 'Настройки', close: 'Закрыть',
  reorder: 'Перетащить; стрелки для перемещения', fold: 'Свернуть / развернуть', inject: 'в промпт', show: 'показ', off: 'выкл',
  running: 'обновляется…', skipped: 'без запроса',
  ok: 'готово', error: 'ошибка', noRun: 'Ещё не обновлялось', outdated: 'устарело', tokens: 'токены вход / выход', duration: 'мс',
  'section.world': 'Состояние мира', 'section.offscreen': 'За сценой', 'section.threads': 'Открытые нити',
  'section.story': 'Сюжет', 'section.npcs': 'Персонажи', 'section.thoughts': 'Мысли NPC',
  'section.bonds': 'Отношения', 'section.dossiers': 'Новые досье NPC', 'section.planner': 'Планировщик сюжета', 'section.banlist': 'Список запретов',
  outfit: 'Одежда', position: 'Положение', visible_condition: 'Состояние', carrying: 'При себе',
  agenda: 'Собирается', action: 'Действие', wants_toward: 'Цель', secret: 'Тайна', truth: 'На самом деле', role: 'Роль', look: 'Внешность', voice: 'Голос', hook: 'Зацепка',
  arc_phase: 'Арка', scene_phase: 'Сцена', affection: 'Привязанность', trust: 'Доверие', desire: 'Влечение', love: 'Влюблённость', reputation: 'Репутация',
  suspicion: 'Подозрение', respect: 'Уважение', fear: 'Страх', grudge: 'Обида', tension: 'Напряжение',
});

Object.assign(STRINGS.en, {
  settingsTitle: 'Sable Trackers', enabled: 'Enabled', profileId: 'Connection profile', language: 'Output language',
  messages: 'Recent messages', cardChars: 'Card characters', loreChars: 'Lore characters',
  maxTokens: 'Max output tokens', depth: 'Injection depth', keep: 'Saved states', role: 'Injection role',
  'role.system': 'system', 'role.user': 'user', 'role.assistant': 'assistant',
  perChatOverrides: 'Mode changes apply to this chat only', showPanel: 'Show reply panel', showFloatingButton: 'Edge tab',
  mode: 'Mode', period: 'Update period (replies)', resetOverrides: 'Reset overrides for this chat', runNow: 'Run now',
  chooseProfile: 'Select a connection profile', notCC: 'not chat-completion', missingProfile: 'Selected profile is missing',
  'language.ru': 'Russian', 'language.en': 'English',
  reasoning: 'Model reasoning', 'reasoning.auto': 'as the model decides', 'reasoning.low': 'low', 'reasoning.min': 'minimal',
  'hint.reasoning': 'Thinking models (GLM, Gemini, Kimi) can spend the whole output limit on reasoning and return no state. "low" keeps it short; "as the model decides" sends nothing.',
  periodHint: 'Periods are global. 1 = every reply; dossiers always check for new NPCs (default 0). Mode selectors show the effective chat mode; reset overrides to use global modes.',
});
Object.assign(STRINGS.ru, {
  settingsTitle: 'Sable Trackers', enabled: 'Включено', profileId: 'Профиль подключения', language: 'Язык вывода',
  messages: 'Последних сообщений', cardChars: 'Карточка, символов', loreChars: 'Лор, символов',
  maxTokens: 'Токенов ответа', depth: 'Глубина вставки', keep: 'Хранить состояний', role: 'Роль вставки',
  'role.system': 'система', 'role.user': 'пользователь', 'role.assistant': 'ассистент',
  perChatOverrides: 'Менять режимы только для этого чата', showPanel: 'Панель под ответом', showFloatingButton: 'Язычок сбоку',
  mode: 'Режим', period: 'Период обновления (ответов)', resetOverrides: 'Сбросить режимы этого чата', runNow: 'Обновить сейчас',
  chooseProfile: 'Выберите профиль подключения', notCC: 'не chat-completion', missingProfile: 'Выбранный профиль отсутствует',
  'language.ru': 'Русский', 'language.en': 'Английский',
  reasoning: 'Размышления модели', 'reasoning.auto': 'как у модели', 'reasoning.low': 'мало', 'reasoning.min': 'минимум',
  'hint.reasoning': 'Думающие модели (GLM, Gemini, Kimi) могут потратить весь лимит ответа на размышления и не вернуть состояние. «Мало» их укорачивает; «как у модели» ничего не отправляет.',
  periodHint: 'Периоды общие. 1 = каждый ответ; досье всегда проверяют новых NPC (по умолчанию 0). Показаны действующие режимы чата; сброс вернёт общие режимы.',
});

// Side panel visual round: edge tab, priority dots, world meta icons, plural turn counts.
Object.assign(STRINGS.en, {
  closeSable: 'Close Sable', time: 'Time', location: 'Place', weather: 'Weather',
  'priority.high': 'high priority', 'priority.mid': 'medium priority', 'priority.low': 'low priority',
  'turns.one': 'turn', 'turns.other': 'turns',
});
Object.assign(STRINGS.ru, {
  closeSable: 'Закрыть Sable', time: 'Время', location: 'Место', weather: 'Погода',
  'priority.high': 'важно', 'priority.mid': 'средне', 'priority.low': 'фон',
  'turns.one': 'ход', 'turns.few': 'хода', 'turns.many': 'ходов', 'turns.other': 'хода',
});

// Settings redesign: group headings, field hints, custom-block editor, visual settings.
Object.assign(STRINGS.en, {
  'group.connection': 'Connection', 'group.context': 'Context', 'group.sections': 'Sections',
  'group.custom': 'Custom blocks', 'group.visual': 'Appearance', 'group.actions': 'Actions',
  'hint.messages': 'How many recent chat messages the side model reads.',
  'hint.cardChars': 'Character card text limit for the side model (0 = none).',
  'hint.loreChars': 'Limit for lorebook entries activated in the last generation (0 = none).',
  'hint.maxTokens': 'Maximum length of the side model reply.',
  'hint.depth': 'Chat depth of the injected summary (0 = at the very end).',
  'hint.keep': 'How many recent messages keep their state (all swipes included).',
  'hint.role': 'If the state block starts showing up in replies, try "user".',
  periodShort: 'Period', section: 'Section',
  customHint: 'The side model keeps these blocks by your instructions, like the built-in sections.',
  customEmpty: 'No custom blocks yet.', addBlock: 'Add block', newBlockTitle: 'New block',
  'custom.title': 'Title', 'custom.icon': 'Icon', 'custom.shape': 'Shape', 'custom.max': 'Max',
  'custom.instructions': 'What to track', 'custom.delete': 'Delete', 'custom.confirmDelete': 'Delete for good?',
  'custom.iconHint': 'One emoji or a Font Awesome class, e.g. fa-magnifying-glass',
  'custom.instructionsHint': 'E.g.: clues the player character has found, one line each.',
  'shape.text': 'Text', 'shape.list': 'List', 'shape.kv': 'Key: value',
  'visual.opacity': 'Opacity', 'visual.blur': 'Blur', 'visual.fontSize': 'Font size', 'visual.widthVw': 'Phone width',
  'visual.accent': 'Accent', 'visual.icons': 'Icons', 'visual.radius': 'Corner radius',
  'icons.fa': 'Outline', 'icons.emoji': 'Emoji', resetVisual: 'Restore default look',
});
Object.assign(STRINGS.ru, {
  'group.connection': 'Подключение', 'group.context': 'Контекст', 'group.sections': 'Секции',
  'group.custom': 'Свои блоки', 'group.visual': 'Внешний вид', 'group.actions': 'Действия',
  'hint.messages': 'Сколько последних сообщений чата читает вспомогательная модель.',
  'hint.cardChars': 'Лимит текста карточки персонажа для вспомогательной модели (0 = не отправлять).',
  'hint.loreChars': 'Лимит записей лорбука, сработавших в последней генерации (0 = не отправлять).',
  'hint.maxTokens': 'Максимальная длина ответа вспомогательной модели.',
  'hint.depth': 'Глубина вставки сводки в чат (0 = в самом конце).',
  'hint.keep': 'Сколько последних сообщений хранят состояние (со всеми свайпами).',
  'hint.role': 'Если блок состояния начал появляться в ответах, попробуйте «пользователь».',
  periodShort: 'Период', section: 'Секция',
  customHint: 'Такие блоки вспомогательная модель ведёт по вашим инструкциям, как встроенные секции.',
  customEmpty: 'Своих блоков пока нет.', addBlock: 'Добавить блок', newBlockTitle: 'Новый блок',
  'custom.title': 'Название', 'custom.icon': 'Значок', 'custom.shape': 'Форма', 'custom.max': 'Макс.',
  'custom.instructions': 'Что отслеживать', 'custom.delete': 'Удалить', 'custom.confirmDelete': 'Точно удалить?',
  'custom.iconHint': 'Один эмодзи или класс Font Awesome, например fa-magnifying-glass',
  'custom.instructionsHint': 'Например: улики, которые нашёл персонаж игрока, по одной строке.',
  'shape.text': 'Текст', 'shape.list': 'Список', 'shape.kv': 'Ключ: значение',
  'visual.opacity': 'Непрозрачность', 'visual.blur': 'Размытие', 'visual.fontSize': 'Шрифт', 'visual.widthVw': 'Ширина на телефоне',
  'visual.accent': 'Акцент', 'visual.icons': 'Значки', 'visual.radius': 'Скругление',
  'icons.fa': 'Контурные', 'icons.emoji': 'Эмодзи', resetVisual: 'Сбросить вид',
});

// Visual: optional base and text colours for light themes.
Object.assign(STRINGS.en, {
  'visual.base': 'Base colour', 'visual.text': 'Text colour', 'visual.auto': 'auto',
  'visual.baseAutoHint': 'Back to the default dark glass',
  'visual.textAutoHint': 'Theme text colour, or matched to the base colour',
});
Object.assign(STRINGS.ru, {
  'visual.base': 'Основной цвет', 'visual.text': 'Цвет текста', 'visual.auto': 'авто',
  'visual.baseAutoHint': 'Вернуть тёмное стекло по умолчанию',
  'visual.textAutoHint': 'Цвет текста темы или подобранный к основному цвету',
});

// Manual state editing in the drawer.
Object.assign(STRINGS.en, {
  edit: 'Edit', 'edit.save': 'Save', 'edit.cancel': 'Cancel', 'edit.add': 'Add', 'edit.remove': 'Remove',
  'edit.changed': 'The state was updated while you were editing. Save overwrites it with your version.',
  'edit.failed': 'Nothing to save to: there is no character reply in this chat yet.',
  'edit.recomputed': 'Recomputed on the next update',
  'field.summary': 'Summary', 'field.pc': 'Player character', 'field.name': 'Name', 'field.doing': 'Doing',
  'field.text': 'Text', 'field.priority': 'Priority', 'field.seeds': 'Seeds', 'field.timers': 'Timers',
  'field.planted_turn': 'Planted on turn', 'field.due': 'Due', 'field.present': 'In the scene', 'field.mood': 'Mood',
  'field.truth': 'Deep down', spoilers: 'Secrets and truths behind a tap',
  'field.thought': 'Thought', 'field.toward': 'Toward', 'field.stats': 'Scales', 'field.changes': 'Last changes',
  'field.beats': 'Beats', 'field.beat': 'Beat', 'field.why': 'Why', 'field.remember': 'Do not forget',
  'field.pattern': 'Pattern', 'field.example': 'Example', 'field.key': 'Key', 'field.value': 'Value',
  // Round 3: drawer behaviour
  hideOff: 'Hide switched-off sections', hiddenSections: 'Hidden', hideSections: 'Hide',
  moveUp: 'Move up', moveDown: 'Move down',
});
Object.assign(STRINGS.ru, {
  edit: 'Редактировать', 'edit.save': 'Сохранить', 'edit.cancel': 'Отмена', 'edit.add': 'Добавить', 'edit.remove': 'Удалить',
  'edit.changed': 'Пока вы редактировали, состояние обновилось. «Сохранить» заменит его вашей версией.',
  'edit.failed': 'Некуда сохранить: в этом чате ещё нет ответа персонажа.',
  'edit.recomputed': 'Пересчитается при следующем обновлении',
  'field.summary': 'Кратко', 'field.pc': 'Персонаж игрока', 'field.name': 'Имя', 'field.doing': 'Чем занят',
  'field.text': 'Текст', 'field.priority': 'Важность', 'field.seeds': 'Зацепки', 'field.timers': 'Сроки',
  'field.planted_turn': 'Посажено на ходу', 'field.due': 'Срок', 'field.present': 'В сцене', 'field.mood': 'Настроение',
  'field.truth': 'На самом деле', spoilers: 'Тайны и «на самом деле» за спойлером',
  'field.thought': 'Мысль', 'field.toward': 'К кому', 'field.stats': 'Шкалы', 'field.changes': 'Последние изменения',
  'field.beats': 'Ходы сюжета', 'field.beat': 'Ход', 'field.why': 'Зачем', 'field.remember': 'Не забыть',
  'field.pattern': 'Шаблон', 'field.example': 'Пример', 'field.key': 'Ключ', 'field.value': 'Значение',
  // Round 3: drawer behaviour
  hideOff: 'Скрывать выключенные', hiddenSections: 'Скрыто', hideSections: 'Скрыть',
  moveUp: 'Переместить вверх', moveDown: 'Переместить вниз',
});

// Round 3: appearance
Object.assign(STRINGS.en, {
  'sub.panel': 'Panel', 'sub.cards': 'Cards', 'sub.background': 'Background', 'sub.theme': 'Theme',
  cardColors: 'Card colours', cardColorsHint: "Empty = the shared accent. The colour tints the card's bar, chip and border.",
  'visual.cardFill': 'Card fill', 'visual.border': 'Borders',
  'visual.titleFont': 'Title font', 'visual.titleWeight': 'Title weight', 'visual.chipStyle': '“inject” chip',
  'visual.accentBar': 'Accent bar on cards', 'visual.sparklines': 'History sparklines under scales', 'visual.spacing': 'Spacing', 'visual.bgDim': 'Dimming', 'visual.bgFit': 'Fit',
  'font.theme': 'Theme font', 'font.serif': 'Serif', 'font.mono': 'Monospace', 'font.rounded': 'Rounded',
  'chip.filled': 'Filled', 'chip.outline': 'Outline', 'spacing.cozy': 'Cozy', 'spacing.compact': 'Compact',
  'fit.cover': 'Fill', 'fit.contain': 'Whole picture', 'fit.tile': 'Tile',
  'bg.file': 'Choose a picture', 'bg.remove': 'Remove background', 'bg.none': 'no picture', 'bg.preview': 'Background preview',
  'bg.url': 'or a link to a picture', 'bg.fromFile': 'picture from a file',
  'bg.hint': 'A picture from the device is shrunk to 1280 px and saved in the extension settings, so every device that shares them shows it.',
  'bg.tooBig': 'Sable: the picture is still over 600 KB after shrinking. Pick a smaller one or use a link.',
  'bg.badUrl': 'Sable: a picture link must start with http:// or https:// and have no spaces, quotes or brackets.',
  'bg.readFailed': 'Sable: this picture could not be read. Try a JPEG, PNG or WebP file.',
  'theme.preset': 'Preset', 'theme.custom': 'custom', 'preset.glass': 'Glass', 'preset.paper': 'Paper', 'preset.neon': 'Neon',
  'theme.presetHint': 'A preset sets colours and style; the background, font size, phone width and effects stay. Tweak anything afterwards.',
  'theme.export': 'Save theme file', 'theme.import': 'Load theme file',
  'theme.invalid': 'Sable: this file is not a Sable theme.', 'theme.imported': 'Sable: theme imported.',
});
Object.assign(STRINGS.ru, {
  'sub.panel': 'Панель', 'sub.cards': 'Карточки', 'sub.background': 'Фон', 'sub.theme': 'Тема',
  cardColors: 'Цвета карточек', cardColorsHint: 'Пусто = общий акцент. Цвет красит полоску, чип и рамку карточки.',
  'visual.cardFill': 'Заливка карточек', 'visual.border': 'Рамки',
  'visual.titleFont': 'Шрифт заголовков', 'visual.titleWeight': 'Жирность заголовков', 'visual.chipStyle': 'Кнопка «в промпт»',
  'visual.accentBar': 'Полоса слева на карточках', 'visual.sparklines': 'Мини-графики под шкалами', 'visual.spacing': 'Плотность', 'visual.bgDim': 'Затемнение', 'visual.bgFit': 'Размещение',
  'font.theme': 'Как в теме', 'font.serif': 'С засечками', 'font.mono': 'Моноширинный', 'font.rounded': 'Округлый',
  'chip.filled': 'Залитая', 'chip.outline': 'Контур', 'spacing.cozy': 'Просторно', 'spacing.compact': 'Компактно',
  'fit.cover': 'Заполнить', 'fit.contain': 'Целиком', 'fit.tile': 'Плиткой',
  'bg.file': 'Выбрать картинку', 'bg.remove': 'Убрать фон', 'bg.none': 'нет фона', 'bg.preview': 'Фон панели',
  'bg.url': 'или ссылка на картинку', 'bg.fromFile': 'картинка из файла',
  'bg.hint': 'Картинка с устройства сжимается до 1280 px и хранится в настройках расширения, поэтому видна на всех устройствах с этими настройками.',
  'bg.tooBig': 'Sable: даже после сжатия картинка больше 600 КБ. Выберите поменьше или дайте ссылку.',
  'bg.badUrl': 'Sable: ссылка на картинку должна начинаться с http:// или https:// и не содержать пробелов, кавычек и скобок.',
  'bg.readFailed': 'Sable: не удалось прочитать картинку. Подойдёт JPEG, PNG или WebP.',
  'theme.preset': 'Пресет', 'theme.custom': 'свой', 'preset.glass': 'Стекло', 'preset.paper': 'Бумага', 'preset.neon': 'Неон',
  'theme.presetHint': 'Пресет задаёт цвета и стиль; фон, размер шрифта, ширина и эффекты остаются. Дальше всё можно подкрутить.',
  'theme.export': 'Экспорт темы', 'theme.import': 'Импорт темы',
  'theme.invalid': 'Sable: это не файл темы Sable.', 'theme.imported': 'Sable: тема загружена.',
});

// Packs (SPEC §15): drawer sheet, status chips, dice, the Packs settings group and the pack editor.
Object.assign(STRINGS.en, {
  packs: 'Packs', 'packs.open': 'Packs', 'packs.close': 'Close packs', 'packs.sheetHint': 'Switches apply to this chat; the next reply or ↻ fills the new cards.',
  'packs.on': 'On in this chat', 'packs.adult': '18+', 'packs.scope': 'Track', 'scope.all': 'all', 'scope.user': 'only me', 'scope.others': 'everyone but me', previewInjection: 'Main prompt injection',
  'packs.enabled': 'Packs on', 'group.packs': 'Packs',
  'packs.hint': 'A pack adds cards for one kind of scene. It is switched per chat from the drawer; here you choose which packs new chats start with.',
  'packs.default': 'On in new chats', 'packs.copy': 'Make a copy', 'packs.export': 'Save pack file', 'packs.import': 'Load pack file',
  'packs.add': 'Add pack', 'packs.newTitle': 'New pack', 'packs.delete': 'Delete pack', 'packs.confirmDelete': 'Delete the pack for good?',
  'packs.imported': 'Sable: pack imported.', 'packs.import.format': 'Sable: this file is not a Sable pack.',
  'packs.import.builtin-id': 'Sable: this file carries a built-in pack id; make a copy instead.', 'packs.import.invalid': 'Sable: the pack has no valid sections.',
  'pack.title': 'Title', 'pack.icon': 'Icon', 'pack.description': 'Description', 'pack.rules': 'Pack rules for the side model',
  'pack.rulesHint': 'Appended to the common rules while the pack is on. {{scope}} becomes the tracking scope sentence.',
  'pack.scope': 'Offer the "all / only me / everyone but me" choice', 'pack.sections': 'Cards', 'pack.addSection': 'Add card', 'pack.key': 'Key',
  'pack.keyHint': 'Latin letters and digits, starts with a letter, up to 16 characters; it names the JSON field.',
  'pack.lastSection': 'A pack keeps at least one card', 'prompts.packRules': 'pack rules',
  dice: 'Roll d100', 'dice.hit': 'hit', 'dice.miss': 'miss', 'dice.rolled': 'Roll',
  // Pack groups in the drawer (SPEC §15): the group aria label, the mixed mode chip and the group fold.
  'packs.group': 'Pack', 'packs.fold': 'Fold / unfold the pack', mixed: 'mixed',
});
Object.assign(STRINGS.ru, {
  packs: 'Наборы', 'packs.open': 'Наборы', 'packs.close': 'Закрыть наборы', 'packs.sheetHint': 'Переключатели действуют в этом чате; новые карточки заполнит следующий ответ или ↻.',
  'packs.on': 'Включён в этом чате', 'packs.adult': '18+', 'packs.scope': 'Следить', 'scope.all': 'все', 'scope.user': 'только я', 'scope.others': 'кроме меня', previewInjection: 'Вставка в основной промпт',
  'packs.enabled': 'Наборы', 'group.packs': 'Наборы',
  'packs.hint': 'Набор добавляет карточки для сцены одного типа. Включается на чат из панели; здесь выбирают, с какими наборами начинаются новые чаты.',
  'packs.default': 'Включать в новых чатах', 'packs.copy': 'Сделать копию', 'packs.export': 'Экспорт набора', 'packs.import': 'Импорт набора',
  'packs.add': 'Добавить набор', 'packs.newTitle': 'Новый набор', 'packs.delete': 'Удалить набор', 'packs.confirmDelete': 'Точно удалить набор?',
  'packs.imported': 'Sable: набор загружен.', 'packs.import.format': 'Sable: это не файл набора Sable.',
  'packs.import.builtin-id': 'Sable: в файле id встроенного набора; сделайте копию.', 'packs.import.invalid': 'Sable: в наборе нет корректных карточек.',
  'pack.title': 'Название', 'pack.icon': 'Значок', 'pack.description': 'Описание', 'pack.rules': 'Правила набора для вспомогательной модели',
  'pack.rulesHint': 'Добавляются к общим правилам, пока набор включён. {{scope}} заменяется фразой об охвате.',
  'pack.scope': 'Предлагать выбор «все / только я / кроме меня»', 'pack.sections': 'Карточки', 'pack.addSection': 'Добавить карточку', 'pack.key': 'Ключ',
  'pack.keyHint': 'Латинские буквы и цифры, начинается с буквы, до 16 знаков; это имя поля в JSON.',
  'pack.lastSection': 'В наборе остаётся хотя бы одна карточка', 'prompts.packRules': 'правила набора',
  dice: 'Бросить d100', 'dice.hit': 'попадание', 'dice.miss': 'промах', 'dice.rolled': 'Бросок',
  'packs.group': 'Набор', 'packs.fold': 'Свернуть / развернуть набор', mixed: 'смешано',
});

// Live cards (SPEC §16): the effects level, the composable fx rows and the change dot.
Object.assign(STRINGS.en, {
  'sub.effects': 'Effects', 'visual.effects': 'Effects', 'effects.off': 'off', 'effects.subtle': 'subtle', 'effects.full': 'full',
  'fx.hint': 'Subtle: bars slide, changes flash. Full unlocks the effects below; each one is off until you turn it on. The system reduced-motion setting turns everything off.',
  'fx.glow': 'Glow', 'fx.shimmer': 'Shimmer', 'fx.rain': 'Rain', 'fx.ticks': 'Numbers tick', 'fx.valueColor': 'Bar colour follows the value',
  'fx.dice': 'Dice animation', 'fx.cardGlow': 'Glow pulse on change',
  'fx.color': 'Colour', 'fx.colorAutoHint': 'Automatic colour (the accent; the text colour for rain)', 'fx.intensity': 'Intensity',
  'fx.speed': 'Speed', 'fx.speed.slow': 'slow', 'fx.speed.medium': 'medium', 'fx.speed.fast': 'fast', 'fx.density': 'Density', 'fx.angle': 'Angle',
  changed: 'changed',
});
Object.assign(STRINGS.ru, {
  'sub.effects': 'Эффекты', 'visual.effects': 'Эффекты', 'effects.off': 'выкл', 'effects.subtle': 'мягко', 'effects.full': 'полные',
  'fx.hint': 'Мягко: полоски плавно двигаются, изменения подсвечиваются. Полные открывают эффекты ниже; каждый выключен, пока вы его не включите. Системная настройка «меньше движения» выключает всё.',
  'fx.glow': 'Свечение', 'fx.shimmer': 'Блик', 'fx.rain': 'Дождь', 'fx.ticks': 'Числа бегут', 'fx.valueColor': 'Цвет полоски по значению',
  'fx.dice': 'Анимация кубика', 'fx.cardGlow': 'Вспышка свечения при изменении',
  'fx.color': 'Цвет', 'fx.colorAutoHint': 'Автоматический цвет (акцент; для дождя — цвет текста)', 'fx.intensity': 'Сила',
  'fx.speed': 'Скорость', 'fx.speed.slow': 'медленно', 'fx.speed.medium': 'средне', 'fx.speed.fast': 'быстро', 'fx.density': 'Плотность', 'fx.angle': 'Наклон',
  changed: 'изменилось',
});

Object.assign(STRINGS.en, {
  'folders.move': 'Group…', 'folders.none': 'No group', 'folders.new': 'New group…', 'folders.default': 'Group',
  'folders.edit': 'Edit group', 'folders.delete': 'Delete group', 'folders.confirmDelete': 'Tap again to delete',
  'folders.empty': 'Empty. Add a card with Group…', 'folders.group': 'Group', 'folders.fold': 'Fold / unfold the group',
  'folders.suggested': 'Suggested groups', 'folders.confirmSuggested': 'Tap again to replace the current groups',
  'folders.world': 'World', 'folders.people': 'People', 'folders.story': 'Story',
});
Object.assign(STRINGS.ru, {
  'folders.move': 'В группу…', 'folders.none': 'Без группы', 'folders.new': 'Новая группа…', 'folders.default': 'Группа',
  'folders.edit': 'Редактировать группу', 'folders.delete': 'Удалить группу', 'folders.confirmDelete': 'Нажмите ещё раз, чтобы удалить',
  'folders.empty': 'Пусто. Добавьте карточку через «В группу…»', 'folders.group': 'Группа', 'folders.fold': 'Свернуть / развернуть группу',
  'folders.suggested': 'Разложить по группам', 'folders.confirmSuggested': 'Нажмите ещё раз: текущие группы будут заменены',
  'folders.world': 'Мир', 'folders.people': 'Люди', 'folders.story': 'Сюжет',
});

// Bond scales (SPEC §20): the settings group, one hint line per built-in scale and the custom scale rows.
Object.assign(STRINGS.en, {
  'group.scales': 'Bond scales',
  'scale.affection.hint': 'Affection — emotional attachment, not necessarily romance', 'scale.trust.hint': 'Trust — willingness to rely on the target',
  'scale.desire.hint': 'Desire — attraction to the target, not love or arousal in general', 'scale.love.hint': 'Love — romantic feelings, apart from affection and desire',
  'scale.reputation.hint': 'Reputation — how the NPC rates the target, not fame', 'scale.suspicion.hint': 'Suspicion — suspicion toward the target',
  'scale.respect.hint': 'Respect — respect for the target', 'scale.fear.hint': 'Fear — fear of the target',
  'scale.grudge.hint': 'Grudge — resentment toward the target, not anger in general', 'scale.tension.hint': 'Tension — current tension; it can drop independently of affection',
  'scales.rebuildHint': 'The default instruction is rebuilt from the enabled scales; an override in the Danger zone replaces it whole.',
  'scales.custom': 'Custom scales', 'scales.add': 'Add scale', 'scales.newTitle': 'New scale', 'scales.max': 'At most 6 custom scales.',
  'scales.key': 'Key', 'scales.title': 'Title', 'scales.hint': 'What it measures (for the side model)', 'scales.friction': 'High value = friction', 'scales.signed': '−100…+100',
  'scales.delete': 'Delete', 'scales.confirmDelete': 'Delete for good?',
  'scales.keyHint': 'Latin lower-case letters, digits and _, starts with a letter, 2–16 characters, not a built-in scale; it names the JSON field.',
  'scales.hintPlaceholder': 'E.g.: jealousy toward toward',
});
Object.assign(STRINGS.ru, {
  'group.scales': 'Шкалы отношений',
  'scale.affection.hint': 'Привязанность — эмоциональная связь, не обязательно романтика', 'scale.trust.hint': 'Доверие — готовность положиться',
  'scale.desire.hint': 'Влечение — тяга к цели, не любовь и не возбуждение вообще', 'scale.love.hint': 'Влюблённость — романтические чувства, отдельно от привязанности и влечения',
  'scale.reputation.hint': 'Репутация — как NPC оценивает цель, не слава', 'scale.suspicion.hint': 'Подозрение — подозрение к цели',
  'scale.respect.hint': 'Уважение — уважение к цели', 'scale.fear.hint': 'Страх — страх перед целью',
  'scale.grudge.hint': 'Обида — обида на цель, не злость вообще', 'scale.tension.hint': 'Напряжение — текущее напряжение, может спадать независимо от привязанности',
  'scales.rebuildHint': 'Инструкция по умолчанию пересобирается из включённых шкал; своя инструкция в «Опасной зоне» заменяет её целиком.',
  'scales.custom': 'Свои шкалы', 'scales.add': 'Добавить шкалу', 'scales.newTitle': 'Новая шкала', 'scales.max': 'Не больше 6 своих шкал.',
  'scales.key': 'Ключ', 'scales.title': 'Название', 'scales.hint': 'Что измеряет (для вспомогательной модели)', 'scales.friction': 'Высокое значение = трение', 'scales.signed': '−100…+100',
  'scales.delete': 'Удалить', 'scales.confirmDelete': 'Точно удалить?',
  'scales.keyHint': 'Строчные латинские буквы, цифры и _, начинается с буквы, 2–16 знаков, не встроенная шкала; это имя поля в JSON.',
  'scales.hintPlaceholder': 'Например: jealousy toward toward',
});

// Drawer layout (SPEC §21): the settings select, the People group and the person card footer.
Object.assign(STRINGS.en, {
  layout: 'Drawer layout', 'layout.topics': 'by topics', 'layout.people': 'by people',
  people: 'People', 'field.role': 'Role', 'people.hint': 'Editing: in the topics layout',
});
Object.assign(STRINGS.ru, {
  layout: 'Раскладка панели', 'layout.topics': 'по темам', 'layout.people': 'по персонажам',
  people: 'Люди', 'field.role': 'Роль', 'people.hint': 'Редактирование: в раскладке по темам',
});

// T22
Object.assign(STRINGS.en, {
  'undo.restore': 'Undo', 'undo.deleted': 'Group “{name}” deleted', 'undo.suggested': 'Cards laid out in groups',
  'drag.here': 'here', 'drag.full': 'full',
});
Object.assign(STRINGS.ru, {
  'undo.restore': 'Вернуть', 'undo.deleted': 'Группа «{name}» удалена', 'undo.suggested': 'Карточки разложены по группам',
  'drag.here': 'сюда', 'drag.full': 'полная',
});
// T24
// Stat history and tap-to-jump (SPEC §26); the sparkline checkbox is renamed here.
Object.assign(STRINGS.en, {
  'visual.sparklines': 'History sparklines under bars',
  'visual.sparklinesHint': 'Up to 12 recent values under bond scales and pack stats. Tap a bar to see its reply and jump to it in the chat.',
  'spark.history': 'History', 'spark.reply': 'reply', 'spark.notLoaded': '(not loaded)',
});
Object.assign(STRINGS.ru, {
  'visual.sparklines': 'Мини-графики под полосками',
  'visual.sparklinesHint': 'До 12 последних значений под шкалами отношений и статами паков. Нажмите на столбик — покажет ответ и прокрутит к нему чат.',
  'spark.history': 'История', 'spark.reply': 'ответ', 'spark.notLoaded': '(не загружено)',
});
// T25
// First-run hints, missing-profile status, mode legend and stale recompute (SPEC §27).
Object.assign(STRINGS.en, {
  'hints.label': 'Hint', 'hints.next': 'Next', 'hints.done': 'Got it', 'hints.never': "Don't show again",
  'hints.again': 'Show the hints again',
  'hints.1.title': 'Check the connection', 'hints.1.text': 'The side model that fills the cards:',
  'hints.1.none': 'Create a profile in Connection Manager',
  'hints.2.title': 'Pick what you like', 'hints.3.title': 'Enjoy',
  'hints.3.text': 'Write to the character; the cards fill in after their reply',
  'legend.inject': 'inject — the model sees it', 'legend.show': 'show — only you', 'legend.off': 'off — not updated',
  noProfile: 'No model profile → set up', staleState: 'State is stale', recompute: '⟳ Recompute',
});
Object.assign(STRINGS.ru, {
  'hints.label': 'Подсказка', 'hints.next': 'Дальше', 'hints.done': 'Понятно', 'hints.never': 'Больше не показывать',
  'hints.again': 'Показать подсказки снова',
  'hints.1.title': 'Проверь соединение', 'hints.1.text': 'Вспомогательная модель, которая заполняет карточки:',
  'hints.1.none': 'Создай профиль в Connection Manager',
  'hints.2.title': 'Выбери, что нравится', 'hints.3.title': 'Наслаждайся',
  'hints.3.text': 'Напиши персонажу — после его ответа карточки заполнятся',
  'legend.inject': 'в промпт — модель это видит', 'legend.show': 'показ — только тебе', 'legend.off': 'выкл — не обновляется',
  noProfile: 'Нет профиля модели → настроить', staleState: 'Состояние устарело', recompute: '⟳ Пересчитать',
});
// T26: settings in one tier (SPEC §28): folded group summaries, the period row in the mode menu, the card colour row
// and the legacy import banner.
Object.assign(STRINGS.en, {
  'group.connection.summary': 'on/off, model profile, language, reasoning',
  'group.context.summary': 'messages, card, lore, tokens, depth, role',
  'group.sections.summary': 'layout, modes, periods, order, folders',
  'group.scales.summary': 'built-in scales, custom scales, −100…+100',
  'group.custom.summary': 'your own cards and their instructions',
  'group.visual.summary': 'panel, cards, background, card colours, effects',
  'group.actions.summary': 'run now, chat overrides, reply panel, floating button',
  'group.packs.summary': 'packs, defaults for new chats, import and export',
  'group.danger.summary': 'instructions, request preview, log',
  'menu.period': 'Every N replies', 'menu.periodDossiers': 'Dossiers check for new NPCs on every reply.',
  'card.color': 'Colour…', 'card.colorLabel': 'Card colour',
  'legacy.banner': 'This chat has old Sable data', 'legacy.import': 'Import', 'legacy.hide': 'Hide',
});
// T26
Object.assign(STRINGS.ru, {
  'group.connection.summary': 'включение, профиль модели, язык, рассуждения',
  'group.context.summary': 'сообщения, карточка, лор, токены, глубина, роль',
  'group.sections.summary': 'раскладка, режимы, периоды, порядок, группы',
  'group.scales.summary': 'встроенные шкалы, свои шкалы, −100…+100',
  'group.custom.summary': 'свои карточки и их инструкции',
  'group.visual.summary': 'панель, карточки, фон, цвета карточек, эффекты',
  'group.actions.summary': 'обновить, режимы чата, панель под ответом, кнопка',
  'group.packs.summary': 'наборы, включение в новых чатах, импорт и экспорт',
  'group.danger.summary': 'инструкции, предпросмотр запроса, журнал',
  'menu.period': 'Раз в N ответов', 'menu.periodDossiers': 'Досье проверяют новых NPC каждый ответ.',
  'card.color': 'Цвет…', 'card.colorLabel': 'Цвет карточки',
  'legacy.banner': 'В этом чате есть данные старого Sable', 'legacy.import': 'Импортировать', 'legacy.hide': 'Скрыть',
});
// T23
// Person card editing (SPEC §25): the pencil menu, the edit form, delete with undo and «+ Person».
Object.assign(STRINGS.en, {
  'person.menu': 'Person actions', 'person.delete': 'Delete', 'person.deleted': '{name} deleted',
  'person.character': 'Character', 'person.secret': 'Secret / Actually', 'person.notSent': 'not sent to the model',
  'person.thought': 'Thought', 'person.bond': 'Bond', 'person.dossier': 'Dossier',
  'person.addCharacter': '+ Character', 'person.addDossier': '+ Dossier', 'person.addBond': '+ Bond', 'person.addThought': '+ Thought',
  'person.removePart': 'Remove', 'person.changed': 'Data changed', 'person.reread': 'Reload', 'person.saveAnyway': 'Save anyway',
  'person.add': '+ Person', 'person.name': 'Name', 'person.addSave': 'Add',
});
Object.assign(STRINGS.ru, {
  'person.menu': 'Действия с персонажем', 'person.delete': 'Удалить', 'person.deleted': 'Удалено: {name}',
  'person.character': 'Персонаж', 'person.secret': 'Тайна / На самом деле', 'person.notSent': 'не идёт в промпт',
  'person.thought': 'Мысль', 'person.bond': 'Отношения', 'person.dossier': 'Досье',
  'person.addCharacter': '+ Персонаж', 'person.addDossier': '+ Досье', 'person.addBond': '+ Отношения', 'person.addThought': '+ Мысль',
  'person.removePart': 'Убрать', 'person.changed': 'Данные обновились', 'person.reread': 'Перечитать', 'person.saveAnyway': 'Сохранить всё равно',
  'person.add': '+ Человек', 'person.name': 'Имя', 'person.addSave': 'Добавить',
});
// T27
// Folder colours (SPEC §29): the colour field of the folder editor.
Object.assign(STRINGS.en, {
  'folders.color': 'Colour', 'folders.colorLabel': 'Group colour',
});
Object.assign(STRINGS.ru, {
  'folders.color': 'Цвет', 'folders.colorLabel': 'Цвет группы',
});
