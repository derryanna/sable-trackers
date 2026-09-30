export const DEFAULT_LANGUAGE = 'ru';

const STRINGS = {
  en: {
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
  agenda: 'Agenda', action: 'Action', wants_toward: 'Target', secret: 'Secret', role: 'Role', look: 'Look', voice: 'Voice', hook: 'Hook',
  arc_phase: 'Arc', scene_phase: 'Scene', affection: 'Affection', trust: 'Trust', desire: 'Desire', reputation: 'Reputation',
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
  agenda: 'Намерение', action: 'Действие', wants_toward: 'Цель', secret: 'Секрет', role: 'Роль', look: 'Внешность', voice: 'Голос', hook: 'Зацепка',
  arc_phase: 'Арка', scene_phase: 'Сцена', affection: 'Привязанность', trust: 'Доверие', desire: 'Влечение', reputation: 'Репутация',
  suspicion: 'Подозрение', respect: 'Уважение', fear: 'Страх', grudge: 'Обида', tension: 'Напряжение',
});

Object.assign(STRINGS.en, {
  settingsTitle: 'Sable Trackers', enabled: 'Enabled', profileId: 'Connection profile', language: 'Output language',
  messages: 'Recent messages', cardChars: 'Card characters', loreChars: 'Lore characters',
  maxTokens: 'Max output tokens', depth: 'Injection depth', keep: 'Saved states',
  perChatOverrides: 'Mode changes apply to this chat only', showPanel: 'Show reply panel', showFloatingButton: 'Edge tab',
  mode: 'Mode', period: 'Update period (replies)', resetOverrides: 'Reset overrides for this chat', runNow: 'Run now',
  chooseProfile: 'Select a connection profile', notCC: 'not chat-completion', missingProfile: 'Selected profile is missing',
  'language.ru': 'Russian', 'language.en': 'English',
  periodHint: 'Periods are global. 1 = every reply; dossiers always check for new NPCs (default 0). Mode selectors show the effective chat mode; reset overrides to use global modes.',
});
Object.assign(STRINGS.ru, {
  settingsTitle: 'Sable Trackers', enabled: 'Включено', profileId: 'Профиль подключения', language: 'Язык вывода',
  messages: 'Последних сообщений', cardChars: 'Карточка, символов', loreChars: 'Лор, символов',
  maxTokens: 'Токенов ответа', depth: 'Глубина вставки', keep: 'Хранить состояний',
  perChatOverrides: 'Менять режимы только для этого чата', showPanel: 'Панель под ответом', showFloatingButton: 'Язычок сбоку',
  mode: 'Режим', period: 'Период обновления (ответов)', resetOverrides: 'Сбросить режимы этого чата', runNow: 'Обновить сейчас',
  chooseProfile: 'Выберите профиль подключения', notCC: 'не chat-completion', missingProfile: 'Выбранный профиль отсутствует',
  'language.ru': 'Русский', 'language.en': 'Английский',
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
  'hint.keep': 'How many recent states the chat keeps (for swipes).',
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
  'hint.keep': 'Сколько последних состояний хранит чат (для свайпов).',
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
  'visual.motion': 'Animations', 'visual.cardFill': 'Card fill', 'visual.border': 'Borders',
  'visual.titleFont': 'Title font', 'visual.titleWeight': 'Title weight', 'visual.chipStyle': '“inject” chip',
  'visual.accentBar': 'Accent bar on cards', 'visual.spacing': 'Spacing', 'visual.bgDim': 'Dimming', 'visual.bgFit': 'Fit',
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
  'theme.presetHint': 'A preset sets colours and style; the background, font size, phone width and animations stay. Tweak anything afterwards.',
  'theme.export': 'Save theme file', 'theme.import': 'Load theme file',
  'theme.invalid': 'Sable: this file is not a Sable theme.', 'theme.imported': 'Sable: theme imported.',
});
Object.assign(STRINGS.ru, {
  'sub.panel': 'Панель', 'sub.cards': 'Карточки', 'sub.background': 'Фон', 'sub.theme': 'Тема',
  'visual.motion': 'Анимации', 'visual.cardFill': 'Заливка карточек', 'visual.border': 'Рамки',
  'visual.titleFont': 'Шрифт заголовков', 'visual.titleWeight': 'Жирность заголовков', 'visual.chipStyle': 'Кнопка «в промпт»',
  'visual.accentBar': 'Полоса слева на карточках', 'visual.spacing': 'Плотность', 'visual.bgDim': 'Затемнение', 'visual.bgFit': 'Размещение',
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
  'theme.presetHint': 'Пресет задаёт цвета и стиль; фон, размер шрифта, ширина и анимации остаются. Дальше всё можно подкрутить.',
  'theme.export': 'Экспорт темы', 'theme.import': 'Импорт темы',
  'theme.invalid': 'Sable: это не файл темы Sable.', 'theme.imported': 'Sable: тема загружена.',
});
