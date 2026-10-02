import { getAllSections, getSections, orderedSectionIds } from '../sections.js';
import { COMMON_RULES, getPromptTexts } from '../prompt.js';
import { t } from '../i18n.js';
import { FX_DEFAULTS, FX_RANGES, FX_SPEEDS, GROUP_IDS, REASONING_LEVELS, ROLES, VISUAL_CHOICES, VISUAL_DEFAULTS, VISUAL_RANGES, normalizeBgImage, normalizeVisual } from '../settings.js';
import { BG_MAX_STORED, BG_QUALITY, PRESET_IDS, THEME_FILE, applyPreset, exportTheme, fitWithin, parseTheme, presetOf } from '../themes.js';
import { BUILTIN_PACKS, packScopeOf } from '../packs/index.js';
import { copyPack, exportPack, importPack } from '../packs/io.js';
import { applyVisual, glyphNode, inkFor, packTitle, sectionGlyph } from './drawer.js';

const CONTEXT_KEYS = ['messages', 'cardChars', 'loreChars', 'maxTokens', 'depth', 'keep'];
const ZERO_ALLOWED = new Set(['cardChars', 'loreChars', 'depth']);
const MODES = ['inject', 'show', 'off'];
const SHAPES = ['text', 'list', 'kv', 'stats', 'tags'];
const PACK_FILE = 'sable-pack.json';
const SECTION_KEY = /^[a-z][a-z0-9]{0,15}$/;
const PERCENT_KEYS = new Set(['opacity', 'bgDim', 'cardFill', 'border']);
const RANGE_UNITS = { blur: 'px', fontSize: 'px', widthVw: 'vw', radius: 'px' };
const formatVisual = (key, value) => (PERCENT_KEYS.has(key) ? `${Math.round(value * 100)}%` : `${value}${RANGE_UNITS[key] ?? ''}`);
const URL_PLACEHOLDER = 'https://…';

/** Browser only: decodes an image file, shrinks its long side to 1280 px and returns a JPEG data URL. */
export async function encodeImageFile(file, { document = globalThis.document, fill = '#0e0e12' } = {}) {
  const bitmap = await document.defaultView.createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    // JPEG has no alpha: transparent parts take the panel colour instead of black.
    context.fillStyle = fill; context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', BG_QUALITY);
  } finally { bitmap.close?.(); }
}

/** 'c_' + 8 hex (custom blocks, SPEC §11) or 'p_' + 8 hex (user packs, SPEC §15), unique among the given ids. */
export function newCustomId(taken = new Set(), random = globalThis.crypto, prefix = 'c_') {
  for (;;) {
    const id = `${prefix}${[...random.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    if (!taken.has(id)) return id;
  }
}

/** Settings writes belong to the runtime, including per-chat mode overrides. */
export function createSettings(runtime, { document = globalThis.document,
  getContext = () => globalThis.SillyTavern.getContext(), encodeImage = encodeImageFile } = {}) {
  const host = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  if (!host) return null;
  let view = runtime.snapshot(), forced, openCustom, openPack, openBlock;
  const crypto = document.defaultView?.crypto ?? globalThis.crypto;
  const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  // Enabled packs add their cards to the Sections table and the card colours, like the drawer (SPEC §15).
  const activeSections = () => getSections(view.settings, view.packs?.enabled ?? []);
  const label = key => t(key, view.settings.language);
  const node = (tag, className = '', text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  // [element, i18n key or () => text, attribute (textContent when omitted)]; re-applied on every render.
  const labels = [];
  const bind = (list, element, key, attribute) => { list.push([element, key, attribute]); return element; };
  const text = (tag, className, key) => bind(labels, node(tag, className), key);
  function applyLabels(list) {
    for (const [element, key, attribute] of list) {
      const value = typeof key === 'function' ? key() : label(key);
      if (attribute) element.setAttribute(attribute, value); else element.textContent = value;
    }
  }
  // A field the user is editing keeps its text across renders triggered elsewhere.
  const setValue = (input, value) => { if (input !== document.activeElement || input === forced) input.value = String(value); };
  function options(select, values, key, list = labels) {
    for (const value of values) { const item = bind(list, node('option'), key(value)); item.value = value; select.append(item); }
    return select;
  }
  function icon(name) {
    const element = node('i', `fa-solid fa-${name}`); element.setAttribute('aria-hidden', 'true'); return element;
  }
  function button(parent, key, glyph, action, list = labels) {
    const element = node('button', 'menu_button'); element.type = 'button';
    element.append(icon(glyph), bind(list, node('span'), key));
    element.addEventListener('click', action); parent.append(element); return element;
  }
  function numberInput(name, min, max, write) {
    const input = node('input', 'text_pole'); input.type = 'number'; input.name = name;
    input.required = true; input.min = String(min); if (max !== undefined) input.max = String(max); input.step = '1';
    input.inputMode = 'numeric';
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (input.value === '' || !Number.isInteger(value) || value < min) { render(runtime.snapshot(), input); return; }
      write(max === undefined ? value : Math.min(max, value));
    });
    return input;
  }

  const element = node('div', 'sable-trackers-settings st-sable-settings');
  element.id = 'st-sable-settings';
  const drawer = node('div', 'inline-drawer');
  const toggle = node('div', 'inline-drawer-toggle inline-drawer-header');
  toggle.append(text('b', '', 'settingsTitle'), node('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down'));
  const content = node('div', 'inline-drawer-content st-sable-settings-body');
  drawer.append(toggle, content); element.append(drawer); host.append(element);
  const groups = new Map();
  function group(id, key) {
    const section = node('details', 'st-sable-settings-group st-sable-group'); section.dataset.group = id;
    const summary = node('summary', 'st-sable-group-summary'), heading = node('h4', 'st-sable-settings-heading');
    const glyphs = { connection: 'plug', context: 'align-left', sections: 'list', custom: 'puzzle-piece', visual: 'palette', actions: 'bolt', packs: 'box-open', danger: 'triangle-exclamation' };
    heading.append(icon(glyphs[id]), text('span', '', key));
    summary.append(heading, icon('chevron-right')); section.append(summary);
    if (id === 'danger') section.classList.add('st-sable-danger');
    section.addEventListener('toggle', () => {
      if (section.open !== !!runtime.snapshot().settings.groups?.[id]) runtime.updateSettings({ groups: { [id]: section.open } });
    });
    groups.set(id, section); content.append(section);
    return section;
  }
  const controls = new Map();
  function checkbox(parent, key) {
    const row = node('label', 'checkbox_label st-sable-settings-check');
    const input = node('input'); input.type = 'checkbox'; input.name = key;
    input.addEventListener('change', () => runtime.updateSettings({ [key]: input.checked }));
    row.append(input, text('span', '', key)); parent.append(row); controls.set(key, input);
  }
  function select(parent, key) {
    const row = node('label', 'st-sable-settings-row');
    const input = node('select', 'text_pole'); input.name = key;
    input.addEventListener('change', () => runtime.updateSettings({ [key]: input.value }));
    row.append(text('span', 'st-sable-settings-label', key), input); parent.append(row); controls.set(key, input);
    return input;
  }

  // Connection.
  const connection = group('connection', 'group.connection');
  checkbox(connection, 'enabled');
  select(connection, 'profileId');
  options(select(connection, 'language'), ['ru', 'en'], value => `language.${value}`);
  // Reasoning cap for thinking side models (SPEC §8): a select like the others, hint in the row title.
  const reasoning = options(select(connection, 'reasoning'), REASONING_LEVELS, value => `reasoning.${value}`);
  bind(labels, reasoning.parentElement, 'hint.reasoning', 'title');

  // Context: a two-column grid of label + narrow number.
  const context = group('context', 'group.context');
  const contextGrid = node('div', 'st-sable-settings-grid'); context.append(contextGrid);
  for (const key of CONTEXT_KEYS) {
    const row = bind(labels, node('label', 'st-sable-settings-num'), `hint.${key}`, 'title');
    const input = numberInput(key, ZERO_ALLOWED.has(key) ? 0 : 1, undefined, value => runtime.updateSettings({ [key]: value }));
    row.append(text('span', 'st-sable-settings-label', key), input); contextGrid.append(row); controls.set(key, input);
    if (key !== 'depth') continue;
    // Injection role (SPEC §5) sits next to depth: a select like the ones in Connection.
    const role = options(select(contextGrid, 'role'), ROLES, value => `role.${value}`);
    bind(labels, role.parentElement, 'hint.role', 'title');
  }

  checkbox(context, 'recomputeOnEdit');
  bind(labels, controls.get('recomputeOnEdit').parentElement, 'hint.recomputeOnEdit', 'title');
  context.append(text('p', 'st-sable-settings-hint', 'hint.recomputeOnEdit'));

  // All sections follow drawer order; custom shape editing stays in Custom blocks.
  const sectionsGroup = group('sections', 'group.sections');
  const table = node('div', 'st-sable-settings-table');
  const head = node('div', 'st-sable-settings-thead'); head.setAttribute('aria-hidden', 'true');
  head.append(text('span', '', 'section'), text('span', '', 'mode'), bind(labels, text('span', '', 'periodShort'), 'period', 'title'));
  table.append(head);
  const sectionControls = new Map();
  function createSectionRow(section) {
    const rowLabels = [];
    const sectionName = () => {
      const current = activeSections().find(item => item.id === section.id) ?? section;
      return current.custom ? current.title : label(current.title);
    };
    const row = node('div', 'st-sable-settings-section'); row.dataset.section = section.id;
    const glyph = node('span', 'st-sable-settings-glyph');
    const name = node('span', 'st-sable-settings-section-name'); name.append(glyph, bind(rowLabels, node('span'), sectionName));
    const mode = options(node('select', 'text_pole'), MODES, value => value, rowLabels); mode.name = 'mode';
    bind(rowLabels, mode, () => `${sectionName()}: ${label('mode')}`, 'aria-label');
    mode.addEventListener('change', () => runtime.setMode(section.id, mode.value));
    // A custom block keeps its period inside customSections; built-ins and pack sections live in settings.sections.
    const period = numberInput('period', 0, undefined, value => (section.custom && !section.pack
      ? patchCustom(section.id, { period: value })
      : runtime.updateSettings({ sections: { [section.id]: { period: value } } })));
    bind(rowLabels, period, () => `${sectionName()}: ${label('period')}`, 'aria-label');
    const moves = node('div', 'st-sable-section-moves');
    const move = (direction, symbol) => {
      const key = direction < 0 ? 'moveUp' : 'moveDown';
      const control = node('button', 'menu_button', symbol); control.type = 'button'; control.dataset.move = key;
      bind(rowLabels, control, () => `${sectionName()}: ${label(key)}`, 'aria-label');
      bind(rowLabels, control, key, 'title');
      control.addEventListener('click', () => {
        const order = orderedSectionIds(view.settings.order, activeSections());
        const index = order.indexOf(section.id), target = index + direction;
        if (index < 0 || target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        runtime.updateSettings({ order });
        if (!control.disabled) control.focus();
        else (direction < 0 ? down : up).focus();
      });
      moves.append(control);
      return control;
    };
    const up = move(-1, '▲'), down = move(1, '▼');
    row.append(name, mode, period, moves);
    return { row, glyph, mode, period, up, down, labels: rowLabels };
  }
  function renderSections() {
    const sections = activeSections(), order = orderedSectionIds(view.settings.order, sections);
    for (const [id, control] of sectionControls) if (!order.includes(id)) { control.row.remove(); sectionControls.delete(id); }
    let previous = head;
    for (const [index, id] of order.entries()) {
      const section = sections.find(item => item.id === id);
      if (!sectionControls.has(id)) sectionControls.set(id, createSectionRow(section));
      const control = sectionControls.get(id);
      if (previous.nextSibling !== control.row) table.insertBefore(control.row, previous.nextSibling);
      previous = control.row;
      applyLabels(control.labels);
      control.glyph.replaceChildren(sectionGlyph(document, section, view.settings.visual?.icons));
      setValue(control.mode, view.modes[id]);
      setValue(control.period, section.custom && !section.pack ? section.period : view.settings.sections[id].period);
      control.up.disabled = index === 0;
      control.down.disabled = index === order.length - 1;
    }
  }
  sectionsGroup.append(table, text('p', 'st-sable-settings-hint', 'periodHint'));

  // Custom blocks (SPEC §11): every write sends the full array.
  const customGroup = group('custom', 'group.custom');
  const customList = node('div', 'st-sable-custom-list');
  const customEmpty = text('p', 'st-sable-settings-hint', 'customEmpty');
  customGroup.append(text('p', 'st-sable-settings-hint', 'customHint'), customList, customEmpty);
  const customActions = node('div', 'st-sable-settings-buttons'); customGroup.append(customActions);
  const customRows = new Map();
  const customSections = () => {
    const list = runtime.snapshot().settings.customSections;
    return Array.isArray(list) ? list : [];
  };
  const writeCustom = customSectionsList => runtime.updateSettings({ customSections: customSectionsList });
  const patchCustom = (id, patch) => writeCustom(customSections().map(item => (item?.id === id ? { ...item, ...patch } : item)));
  button(customActions, 'addBlock', 'plus', () => {
    const list = customSections();
    openCustom = newCustomId(new Set(list.map(item => item?.id)));
    writeCustom([...list, { id: openCustom, title: label('newBlockTitle'), icon: '📌', instructions: '',
      shape: 'list', max: 8, mode: 'show', period: 1 }]);
  });
  // One block editor serves custom blocks and pack cards: io.patch/io.remove write the owner's array,
  // io.rename validates a pack card key (false = keep the old one), io.canRemove guards the last card of a pack.
  function createBlockRow(io) {
    const row = { labels: [], armed: false, io };
    const bindRow = (element, key, attribute) => bind(row.labels, element, key, attribute);
    row.element = node('details', 'st-sable-custom');
    const summary = node('summary', 'st-sable-custom-summary');
    row.glyph = node('span', 'st-sable-settings-glyph');
    row.title = node('span', 'st-sable-custom-name');
    row.mode = node('span', 'st-sable-custom-mode');
    summary.append(row.glyph, row.title, row.mode);
    const field = (key, control, name) => {
      const wrap = node('label', 'st-sable-custom-field'); wrap.dataset.field = name;
      wrap.append(bindRow(node('span', 'st-sable-settings-label'), key), control); return wrap;
    };
    const input = (name, maxLength, write) => {
      const element = node(name === 'instructions' ? 'textarea' : 'input', 'text_pole'); element.name = name;
      element.maxLength = maxLength;
      element.addEventListener('change', () => write(element.value.trim()));
      return element;
    };
    const inputs = row.inputs = {
      title: input('title', 60, value => io.patch({ title: value || label('newBlockTitle') })),
      icon: input('icon', 40, value => io.patch({ icon: value })),
      shape: options(node('select', 'text_pole'), SHAPES, value => `shape.${value}`, row.labels),
      max: numberInput('max', 1, 20, value => io.patch({ max: value })),
      mode: options(node('select', 'text_pole'), MODES, value => value, row.labels),
      period: numberInput('period', 1, undefined, value => io.patch({ period: value })),
      instructions: input('instructions', 2000, value => io.patch({ instructions: value })),
    };
    inputs.shape.name = 'shape'; inputs.mode.name = 'mode'; inputs.instructions.rows = 3;
    inputs.shape.addEventListener('change', () => io.patch({ shape: inputs.shape.value }));
    inputs.mode.addEventListener('change', () => io.patch({ mode: inputs.mode.value }));
    bindRow(inputs.icon, 'custom.iconHint', 'title'); inputs.icon.placeholder = '📌';
    bindRow(inputs.instructions, 'custom.instructionsHint', 'placeholder');
    const small = node('div', 'st-sable-custom-fields');
    if (io.rename) {
      // The key names the JSON field: an invalid or duplicate key is restored, never saved.
      inputs.key = input('key', 16, value => { if (!io.rename(value)) render(runtime.snapshot(), inputs.key); });
      inputs.key.autocomplete = 'off'; inputs.key.spellcheck = false;
      bindRow(inputs.key, 'pack.keyHint', 'title');
      small.append(field('pack.key', inputs.key, 'key'));
    }
    small.append(field('custom.icon', inputs.icon, 'icon'), field('custom.shape', inputs.shape, 'shape'),
      field('custom.max', inputs.max, 'max'), field('mode', inputs.mode, 'mode'), field('periodShort', inputs.period, 'period'));
    const actions = node('div', 'st-sable-custom-actions');
    // Two taps delete, so a stray tap cannot lose the instructions.
    row.remove = button(actions, () => label(row.armed ? 'custom.confirmDelete' : 'custom.delete'), 'trash-can', () => {
      if (row.armed) { io.remove(); return; }
      row.armed = true; applyLabels(row.labels); row.remove.classList.add('st-sable-armed');
    }, row.labels);
    row.remove.addEventListener('blur', () => {
      if (!row.armed) return;
      row.armed = false; applyLabels(row.labels); row.remove.classList.remove('st-sable-armed');
    });
    const body = node('div', 'st-sable-custom-body');
    body.append(field('custom.title', inputs.title, 'title'), small, field('custom.instructions', inputs.instructions, 'instructions'), actions);
    row.element.append(summary, body);
    return row;
  }
  function updateBlockRow(row, item) {
    const shape = SHAPES.includes(item.shape) ? item.shape : 'list', mode = MODES.includes(item.mode) ? item.mode : 'show';
    row.glyph.replaceChildren(glyphNode(document, item.icon || '📌'));
    row.title.textContent = item.title || label('newBlockTitle');
    row.mode.textContent = label(mode); row.mode.dataset.mode = mode;
    applyLabels(row.labels);
    const removable = row.io.canRemove ? row.io.canRemove() : true;
    row.remove.disabled = !removable; row.remove.title = removable ? '' : label('pack.lastSection');
    if (row.inputs.key) setValue(row.inputs.key, item.key ?? '');
    setValue(row.inputs.title, item.title ?? '');
    setValue(row.inputs.icon, item.icon ?? '');
    setValue(row.inputs.shape, shape);
    setValue(row.inputs.max, item.max ?? 8);
    row.inputs.max.disabled = shape === 'text';
    setValue(row.inputs.mode, mode);
    setValue(row.inputs.period, item.period ?? 1);
    setValue(row.inputs.instructions, item.instructions ?? '');
  }
  function renderCustom() {
    const seen = new Set();
    const items = (Array.isArray(view.settings.customSections) ? view.settings.customSections : [])
      .filter(item => item && typeof item.id === 'string' && !seen.has(item.id) && seen.add(item.id));
    for (const [id, row] of customRows) if (!seen.has(id)) { row.element.remove(); customRows.delete(id); }
    let previous = null;
    for (const item of items) {
      if (!customRows.has(item.id)) {
        const row = createBlockRow({ patch: patch => patchCustom(item.id, patch), remove: () => writeCustom(customSections().filter(entry => entry?.id !== item.id)) });
        row.element.dataset.customId = item.id;
        customRows.set(item.id, row);
      }
      const row = customRows.get(item.id);
      // Rows move only when out of place, so a focused field is not detached.
      const expected = previous ? previous.nextSibling : customList.firstChild;
      if (row.element !== expected) customList.insertBefore(row.element, expected);
      previous = row.element;
      updateBlockRow(row, item);
    }
    customEmpty.hidden = items.length > 0;
    const added = customRows.get(openCustom);
    if (added) { openCustom = undefined; added.element.open = true; added.inputs.title.focus(); added.inputs.title.select(); }
  }

  // Appearance (SPEC §12): sliders preview live on input and persist on change. Sub-groups: panel, cards, background, theme.
  const visualGroup = group('visual', 'group.visual');
  let visualGrid;
  function subgroup(key) {
    visualGroup.append(text('h5', 'st-sable-settings-subheading', key));
    visualGrid = node('div', 'st-sable-settings-grid'); visualGroup.append(visualGrid);
  }
  const visualControls = new Map(), visualOutputs = new Map(), visualChecks = new Map();
  const visualWith = (key, value) => normalizeVisual({ ...runtime.snapshot().settings.visual, [key]: value });
  const writeVisual = visual => runtime.updateSettings({ visual });
  const previewVisual = visual => {
    for (const target of document.querySelectorAll('.st-sable-drawer, .st-sable-tab')) applyVisual(target, visual);
  };
  const notify = (type, message) => {
    const toast = globalThis.toastr;
    if (typeof toast?.[type] === 'function') toast[type](message); else console.warn(message);
  };
  // A file download through a temporary link; the theme, the log and pack exports share it.
  function download(name, text) {
    const win = document.defaultView;
    const url = win.URL.createObjectURL(new win.Blob([text], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = name; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  }
  function preview(key, value) {
    const visual = visualWith(key, value);
    visualOutputs.get(key).textContent = key === 'accent' ? visual.accent : formatVisual(key, visual[key]);
    previewVisual(visual);
  }
  function visualField(key, input, withOutput = true) {
    const row = node('label', `st-sable-settings-visual st-sable-settings-${input.type === 'range' ? 'range' : 'inline'}`);
    row.append(text('span', 'st-sable-settings-label', `visual.${key}`));
    if (withOutput) { const output = node('output', 'st-sable-settings-value'); visualOutputs.set(key, output); row.append(output); }
    row.append(input); visualGrid.append(row); visualControls.set(key, input);
    if (withOutput) input.addEventListener('input', () => preview(key, input.value));
    input.addEventListener('change', () => writeVisual(visualWith(key, input.value)));
  }
  function range(key) {
    const [min, max, step] = VISUAL_RANGES[key];
    const input = node('input'); input.type = 'range'; input.name = key;
    input.min = String(min); input.max = String(max); input.step = String(step);
    visualField(key, input);
  }
  function choice(key, prefix) {
    const input = options(node('select', 'text_pole'), VISUAL_CHOICES[key], value => `${prefix}.${value}`); input.name = key;
    visualField(key, input, false);
  }
  function visualCheck(key) {
    const row = node('label', 'checkbox_label st-sable-settings-check st-sable-settings-visual');
    const input = node('input'); input.type = 'checkbox'; input.name = key;
    input.addEventListener('change', () => writeVisual(visualWith(key, input.checked)));
    row.append(input, text('span', '', `visual.${key}`)); visualGrid.append(row); visualChecks.set(key, input);
  }
  // Optional colours: a swatch plus «авто», which stores null (dark glass / theme text).
  const optionalColors = new Map();
  function optionalColor(key, fallback) {
    const row = node('div', 'st-sable-settings-visual st-sable-settings-inline st-sable-settings-optional');
    const input = node('input'); input.type = 'color'; input.name = key;
    bind(labels, input, `visual.${key}`, 'aria-label');
    const auto = node('button', 'menu_button st-sable-settings-auto'); auto.type = 'button'; auto.name = `${key}Auto`;
    bind(labels, auto, 'visual.auto'); bind(labels, auto, `visual.${key}AutoHint`, 'title');
    input.addEventListener('input', () => previewVisual(visualWith(key, input.value)));
    input.addEventListener('change', () => runtime.updateSettings({ visual: visualWith(key, input.value) }));
    auto.addEventListener('click', () => {
      if (runtime.snapshot().settings.visual?.[key]) runtime.updateSettings({ visual: visualWith(key, null) });
    });
    row.append(text('span', 'st-sable-settings-label', `visual.${key}`), input, auto); visualGrid.append(row);
    optionalColors.set(key, { input, auto, fallback });
  }
  subgroup('sub.panel');
  for (const key of ['opacity', 'blur', 'fontSize', 'widthVw']) range(key);
  optionalColor('base', '#0e0e12');
  optionalColor('text', '#eeeae7');
  const accent = node('input'); accent.type = 'color'; accent.name = 'accent';
  visualField('accent', accent);
  const cardColorBlock = node('div', 'st-sable-card-colors st-sable-settings-wide');
  cardColorBlock.append(text('h5', 'st-sable-settings-subheading', 'cardColors'), text('p', 'st-sable-settings-hint', 'cardColorsHint'));
  const cardColorList = node('div', 'st-sable-settings-grid'); cardColorBlock.append(cardColorList); visualGrid.append(cardColorBlock);
  const cardColorRows = new Map();
  function renderCardColors() {
    const sections = activeSections(), order = orderedSectionIds(view.settings.order, sections), visual = normalizeVisual(view.settings.visual);
    for (const [id, row] of cardColorRows) if (!order.includes(id)) { row.element.remove(); cardColorRows.delete(id); }
    let previous = null;
    for (const id of order) {
      const section = sections.find(item => item.id === id);
      if (!cardColorRows.has(id)) {
        const element = node('div', 'st-sable-settings-visual st-sable-settings-inline st-sable-settings-optional'); element.dataset.cardColor = id;
        const name = node('label', 'st-sable-settings-label');
        const input = node('input'); input.type = 'color'; input.name = `cardColors.${id}`; input.id = `st-sable-color-${id}`; name.htmlFor = input.id;
        const auto = node('button', 'menu_button st-sable-settings-auto'); auto.type = 'button';
        const withColor = color => {
          const colors = { ...runtime.snapshot().settings.visual.cardColors };
          if (color) colors[id] = color; else delete colors[id];
          return visualWith('cardColors', colors);
        };
        input.addEventListener('input', () => previewVisual(withColor(input.value)));
        input.addEventListener('change', () => writeVisual(withColor(input.value)));
        auto.addEventListener('click', () => writeVisual(withColor(null)));
        element.append(name, input, auto); cardColorRows.set(id, { element, name, input, auto });
      }
      const row = cardColorRows.get(id), title = section.custom ? section.title : label(section.title);
      row.name.replaceChildren(sectionGlyph(document, section, visual.icons), document.createTextNode(` ${title}`));
      row.auto.textContent = label('visual.auto'); row.auto.setAttribute('aria-label', `${title}: ${label('visual.auto')}`);
      row.auto.setAttribute('aria-pressed', String(!visual.cardColors[id]));
      setValue(row.input, visual.cardColors[id] ?? visual.accent);
      const expected = previous ? previous.nextSibling : cardColorList.firstChild;
      if (row.element !== expected) cardColorList.insertBefore(row.element, expected);
      previous = row.element;
    }
  }

  subgroup('sub.cards');
  for (const key of ['radius', 'cardFill', 'border', 'titleWeight']) range(key);
  choice('titleFont', 'font');
  choice('chipStyle', 'chip');
  choice('spacing', 'spacing');
  choice('icons', 'icons');
  visualCheck('accentBar');

  // Effects (SPEC §16): the level select, then one row per composable effect, shown only at «full». Knobs preview on
  // input and persist on change through the same visual path; a null colour means automatic.
  subgroup('sub.effects');
  choice('effects', 'effects');
  const fxBlock = node('div', 'st-sable-fx st-sable-settings-wide'); visualGrid.append(fxBlock);
  visualGroup.append(text('p', 'st-sable-settings-hint', 'fx.hint'));
  const fxRows = new Map();
  const fxWith = (name, patch) => {
    const current = normalizeVisual(runtime.snapshot().settings.visual);
    return visualWith('fx', { ...current.fx, [name]: { ...current.fx[name], ...patch } });
  };
  const formatFx = (knob, value) => (knob === 'angle' ? `${value}°` : `${Math.round(value * 100)}%`);
  for (const [name, defaults] of Object.entries(FX_DEFAULTS)) {
    const row = node('div', 'st-sable-fx-row'); row.dataset.fx = name;
    const toggle = node('label', 'checkbox_label st-sable-settings-check');
    const on = node('input'); on.type = 'checkbox'; on.name = `fx.${name}.on`;
    on.addEventListener('change', () => writeVisual(fxWith(name, { on: on.checked })));
    toggle.append(on, text('span', '', `fx.${name}`)); row.append(toggle);
    const knobs = node('div', 'st-sable-fx-knobs'), controls = { on, knobs, outputs: new Map() };
    for (const knob of Object.keys(defaults)) {
      if (knob === 'on') continue;
      const key = `fx.${name}.${knob}`;
      if (knob === 'color') {
        const wrap = node('div', 'st-sable-settings-inline st-sable-settings-optional');
        const input = node('input'); input.type = 'color'; input.name = key;
        bind(labels, input, 'fx.color', 'aria-label');
        const auto = node('button', 'menu_button st-sable-settings-auto'); auto.type = 'button'; auto.name = `${key}Auto`;
        bind(labels, auto, 'visual.auto'); bind(labels, auto, 'fx.colorAutoHint', 'title');
        input.addEventListener('input', () => previewVisual(fxWith(name, { color: input.value })));
        input.addEventListener('change', () => writeVisual(fxWith(name, { color: input.value })));
        auto.addEventListener('click', () => { if (normalizeVisual(runtime.snapshot().settings.visual).fx[name].color) writeVisual(fxWith(name, { color: null })); });
        wrap.append(text('span', 'st-sable-settings-label', 'fx.color'), input, auto); knobs.append(wrap);
        controls.color = input; controls.auto = auto;
      } else if (knob === 'speed') {
        const wrap = node('label', 'st-sable-settings-inline');
        const input = options(node('select', 'text_pole'), FX_SPEEDS, value => `fx.speed.${value}`); input.name = key;
        input.addEventListener('change', () => writeVisual(fxWith(name, { speed: input.value })));
        wrap.append(text('span', 'st-sable-settings-label', 'fx.speed'), input); knobs.append(wrap);
        controls.speed = input;
      } else {
        const [min, max, step] = FX_RANGES[`${name}.${knob}`];
        const wrap = node('label', 'st-sable-settings-range');
        const input = node('input'); input.type = 'range'; input.name = key; input.min = String(min); input.max = String(max); input.step = String(step);
        const output = node('output', 'st-sable-settings-value');
        input.addEventListener('input', () => {
          const visual = fxWith(name, { [knob]: input.value });
          output.textContent = formatFx(knob, visual.fx[name][knob]); previewVisual(visual);
        });
        input.addEventListener('change', () => writeVisual(fxWith(name, { [knob]: input.value })));
        wrap.append(text('span', 'st-sable-settings-label', `fx.${knob}`), output, input); knobs.append(wrap);
        controls[knob] = input; controls.outputs.set(knob, output);
      }
    }
    if (knobs.childNodes.length) row.append(knobs);
    fxBlock.append(row); fxRows.set(name, controls);
  }
  function renderFx(visual) {
    fxBlock.hidden = visual.effects !== 'full';
    // Automatic colours show their stand-in: the accent for glow and shimmer, the ink for rain (white on dark glass).
    const ink = visual.text ?? (visual.base ? `rgb(${inkFor(visual.base)})` : null);
    const fallback = name => (name === 'rain' ? (ink === 'rgb(0,0,0)' ? '#000000' : /^#/.test(ink ?? '') ? ink : '#ffffff') : visual.accent);
    for (const [name, controls] of fxRows) {
      const fx = visual.fx[name];
      controls.on.checked = fx.on;
      controls.knobs.hidden = !fx.on;
      if (controls.color) { setValue(controls.color, fx.color ?? fallback(name)); controls.auto.setAttribute('aria-pressed', String(!fx.color)); }
      if (controls.speed) setValue(controls.speed, fx.speed);
      for (const [knob, output] of controls.outputs) { setValue(controls[knob], fx[knob]); output.textContent = formatFx(knob, fx[knob]); }
    }
  }

  // Background: a file (shrunk to a JPEG data URL) or an http(s) link, stored in the visual object like everything else.
  subgroup('sub.background');
  const bgRow = node('div', 'st-sable-settings-bg st-sable-settings-wide');
  const thumb = node('div', 'st-sable-settings-thumb'); thumb.setAttribute('role', 'img');
  bind(labels, thumb, 'bg.preview', 'aria-label');
  const thumbText = node('span');
  thumb.append(thumbText);
  const bgButtons = node('div', 'st-sable-settings-buttons');
  const bgFile = node('input'); bgFile.type = 'file'; bgFile.accept = 'image/*'; bgFile.name = 'bgFile'; bgFile.hidden = true;
  button(bgButtons, 'bg.file', 'image', () => bgFile.click());
  const bgRemove = button(bgButtons, 'bg.remove', 'trash-can', () => writeVisual(visualWith('bgImage', null)));
  bgRow.append(thumb, bgButtons, bgFile); visualGrid.append(bgRow);
  const bgUrlRow = node('label', 'st-sable-settings-url st-sable-settings-wide');
  const bgUrl = node('input', 'text_pole'); bgUrl.type = 'url'; bgUrl.name = 'bgUrl'; bgUrl.inputMode = 'url';
  bgUrl.autocomplete = 'off'; bgUrl.spellcheck = false;
  bgUrlRow.append(text('span', 'st-sable-settings-label', 'bg.url'), bgUrl); visualGrid.append(bgUrlRow);
  range('bgDim');
  choice('bgFit', 'fit');
  visualGroup.append(text('p', 'st-sable-settings-hint', 'bg.hint'));
  function storeImage(value) {
    const image = normalizeBgImage(value);
    if (!image) notify('warning', label('bg.badUrl'));
    else if (image.length > BG_MAX_STORED) notify('warning', label('bg.tooBig'));
    else writeVisual(visualWith('bgImage', image));
  }
  bgFile.addEventListener('change', async () => {
    const file = bgFile.files?.[0];
    bgFile.value = '';
    if (!file) return;
    let url;
    try {
      url = await encodeImage(file, { document, fill: normalizeVisual(runtime.snapshot().settings.visual).base ?? '#0e0e12' });
    } catch { notify('error', label('bg.readFailed')); return; }
    storeImage(url);
  });
  bgUrl.addEventListener('change', () => {
    const value = bgUrl.value.trim(), current = runtime.snapshot().settings.visual?.bgImage;
    // Emptying the field removes a linked picture; a picture from a file is removed with the button.
    if (value) storeImage(value);
    else if (current && !current.startsWith('data:')) writeVisual(visualWith('bgImage', null));
  });
  let thumbImage = null;
  function renderBackground(visual) {
    const image = visual.bgImage, fromFile = !!image?.startsWith('data:');
    // normalizeVisual already allows only quote- and bracket-free URLs; a data URL is only re-set when it changes.
    if (image !== thumbImage) { thumb.style.backgroundImage = image ? `url("${image}")` : ''; thumbImage = image; }
    thumb.toggleAttribute('data-empty', !image);
    thumbText.textContent = image ? '' : label('bg.none');
    bgRemove.disabled = !image;
    for (const key of ['bgDim', 'bgFit']) visualControls.get(key).disabled = !image;
    setValue(bgUrl, image && !fromFile ? image : '');
    bgUrl.placeholder = fromFile ? label('bg.fromFile') : URL_PLACEHOLDER;
  }

  // Theme: presets, export/import of the whole visual object, reset.
  subgroup('sub.theme');
  const preset = node('select', 'text_pole'); preset.name = 'preset';
  const customOption = bind(labels, node('option'), 'theme.custom'); customOption.value = ''; customOption.disabled = true;
  preset.append(customOption);
  options(preset, PRESET_IDS, id => `preset.${id}`);
  const presetRow = node('label', 'st-sable-settings-visual st-sable-settings-inline');
  presetRow.append(text('span', 'st-sable-settings-label', 'theme.preset'), preset); visualGrid.append(presetRow);
  preset.addEventListener('change', () => { if (preset.value) writeVisual(applyPreset(runtime.snapshot().settings.visual, preset.value)); });
  visualGroup.append(text('p', 'st-sable-settings-hint', 'theme.presetHint'));
  const visualActions = node('div', 'st-sable-settings-buttons'); visualGroup.append(visualActions);
  const themeFile = node('input'); themeFile.type = 'file'; themeFile.accept = '.json,application/json'; themeFile.name = 'themeFile';
  themeFile.hidden = true;
  button(visualActions, 'theme.export', 'download', () => download(THEME_FILE, exportTheme(runtime.snapshot().settings.visual)));
  button(visualActions, 'theme.import', 'upload', () => themeFile.click());
  button(visualActions, 'resetVisual', 'eraser', () => runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS } }));
  visualActions.append(themeFile);
  themeFile.addEventListener('change', async () => {
    const file = themeFile.files?.[0];
    themeFile.value = '';
    if (!file) return;
    let visual = null;
    try { visual = parseTheme(await file.text()); } catch { /* unreadable file: reported below */ }
    if (!visual) { notify('warning', label('theme.invalid')); return; }
    writeVisual(visual);
    notify('success', label('theme.imported'));
  });
  function renderVisualExtras(visual) {
    for (const [key, input] of visualChecks) input.checked = visual[key];
    renderFx(visual);
    renderBackground(visual);
    setValue(preset, presetOf(visual));
  }

  // Actions.
  const actions = group('actions', 'group.actions');
  const actionButtons = node('div', 'st-sable-settings-buttons'); actions.append(actionButtons);
  button(actionButtons, 'runNow', 'rotate', () => { void runtime.refresh(); });
  const seed = button(actionButtons, 'seedLegacy', 'file-import', () => { void runtime.seedLegacy(); });
  const reset = button(actionButtons, 'resetOverrides', 'arrow-rotate-left', () => {
    for (const id of Object.keys(runtime.snapshot().store.modeOverride)) runtime.setMode(id, null, true);
  });
  for (const key of ['perChatOverrides', 'showPanel', 'showFloatingButton']) checkbox(actions, key);
  checkbox(actions, 'hideOff');
  controls.get('showPanel').parentElement.after(controls.get('hideOff').parentElement);

  // Packs (SPEC §15): the same list as the drawer sheet, "on in new chats" ticks, export/import and the user-pack editor.
  const packsGroup = group('packs', 'group.packs');
  const packList = node('div', 'st-sable-pack-list');
  packsGroup.append(text('p', 'st-sable-settings-hint', 'packs.hint'), packList);
  const packActions = node('div', 'st-sable-settings-buttons'); packsGroup.append(packActions);
  const packRows = new Map();
  const userPacks = () => (Array.isArray(runtime.snapshot().settings.packs) ? runtime.snapshot().settings.packs : []);
  const writePacks = packs => runtime.updateSettings({ packs });
  const patchPack = (id, patch) => writePacks(userPacks().map(pack => (pack?.id === id ? { ...pack, ...patch } : pack)));
  const patchPackSection = (id, key, patch) => patchPack(id, { sections: userPacks().find(pack => pack?.id === id)?.sections.map(s => (s.key === key ? { ...s, ...patch } : s)) });
  const newBlock = () => ({ title: label('newBlockTitle'), icon: '📌', instructions: '', shape: 'list', max: 8, mode: 'show', period: 1 });
  const addPack = pack => { openPack = pack.id; writePacks([...userPacks(), pack]); };
  button(packActions, 'packs.add', 'plus', () => addPack({ id: newCustomId(new Set(userPacks().map(pack => pack?.id)), crypto, 'p_'),
    title: label('packs.newTitle'), icon: '🎒', description: '', rules: '', scope: false, sections: [{ key: 'card', ...newBlock() }] }));
  const packFile = node('input'); packFile.type = 'file'; packFile.accept = '.json,application/json'; packFile.name = 'packFile'; packFile.hidden = true;
  button(packActions, 'packs.import', 'upload', () => packFile.click());
  packActions.append(packFile);
  packFile.addEventListener('change', async () => {
    const file = packFile.files?.[0];
    packFile.value = '';
    if (!file) return;
    let result;
    try { result = importPack(await file.text(), userPacks(), { random }); } catch { result = { error: 'format' }; }
    if (result.error) { notify('warning', label(`packs.import.${result.error}`)); return; }
    addPack(result.pack);
    notify('success', label('packs.imported'));
  });
  function createPackRow(id, builtin) {
    const row = { labels: [], armed: false, blocks: new Map() };
    const bindRow = (element, key, attribute) => bind(row.labels, element, key, attribute);
    row.element = node('details', 'st-sable-custom st-sable-pack'); row.element.dataset.pack = id;
    const summary = node('summary', 'st-sable-custom-summary');
    row.glyph = node('span', 'st-sable-settings-glyph');
    row.title = node('span', 'st-sable-custom-name');
    row.adult = bindRow(node('span', 'st-sable-adult'), 'packs.adult');
    row.description = node('span', 'st-sable-pack-desc');
    summary.append(row.glyph, row.title, row.adult, row.description);
    const body = node('div', 'st-sable-custom-body');
    const check = (key, write) => {
      const wrap = node('label', 'checkbox_label st-sable-settings-check');
      const input = node('input'); input.type = 'checkbox'; input.name = key;
      input.addEventListener('change', () => write(input.checked));
      wrap.append(input, bindRow(node('span'), key)); return input;
    };
    // The per-chat switch stays in the drawer sheet; here only the default for new chats.
    row.defaults = check('packs.default', on => {
      const defaults = runtime.snapshot().settings.packDefaults.filter(value => value !== id);
      runtime.updateSettings({ packDefaults: on ? [...defaults, id] : defaults });
    });
    row.scope = options(node('select', 'text_pole'), ['all', 'user', 'others'], value => `scope.${value}`, row.labels); row.scope.name = 'packScope';
    row.scope.addEventListener('change', () => runtime.updateSettings({ packScope: { [id]: row.scope.value } }));
    const scopeRow = node('label', 'st-sable-settings-inline st-sable-pack-scope');
    scopeRow.append(bindRow(node('span', 'st-sable-settings-label'), 'packs.scope'), row.scope);
    row.scopeRow = scopeRow;
    body.append(row.defaults.parentElement, scopeRow);
    const actions = node('div', 'st-sable-settings-buttons st-sable-custom-actions');
    const current = () => (builtin ? BUILTIN_PACKS.find(pack => pack.id === id) : userPacks().find(pack => pack?.id === id));
    if (builtin) {
      button(actions, 'packs.copy', 'copy', () => addPack(copyPack(current(), { random, lang: runtime.snapshot().settings.language })), row.labels);
    } else {
      const field = (key, control, name) => {
        const wrap = node('label', 'st-sable-custom-field'); wrap.dataset.field = name;
        wrap.append(bindRow(node('span', 'st-sable-settings-label'), key), control); return wrap;
      };
      const input = (name, maxLength, write, tag = 'input') => {
        const element = node(tag, 'text_pole'); element.name = name; element.maxLength = maxLength;
        element.addEventListener('change', () => write(element.value.trim()));
        return element;
      };
      row.inputs = {
        title: input('title', 60, value => patchPack(id, { title: value || label('packs.newTitle') })),
        icon: input('icon', 40, value => patchPack(id, { icon: value })),
        description: input('description', 300, value => patchPack(id, { description: value })),
        rules: input('rules', 2000, value => patchPack(id, { rules: value }), 'textarea'),
      };
      row.inputs.rules.rows = 3;
      bindRow(row.inputs.icon, 'custom.iconHint', 'title'); row.inputs.icon.placeholder = '🎒';
      bindRow(row.inputs.rules, 'pack.rulesHint', 'title');
      const small = node('div', 'st-sable-custom-fields');
      small.append(field('pack.title', row.inputs.title, 'title'), field('pack.icon', row.inputs.icon, 'icon'));
      row.scopeFlag = check('pack.scope', on => patchPack(id, { scope: on }));
      row.blockList = node('div', 'st-sable-custom-list');
      const blockActions = node('div', 'st-sable-settings-buttons');
      button(blockActions, 'pack.addSection', 'plus', () => {
        const pack = current(); if (!pack) return;
        let n = pack.sections.length + 1, key = `card${n}`;
        while (pack.sections.some(s => s.key === key)) key = `card${++n}`;
        openBlock = `${id}:${key}`;
        patchPack(id, { sections: [...pack.sections, { key, ...newBlock() }] });
      }, row.labels);
      body.append(small, field('pack.description', row.inputs.description, 'description'), field('pack.rules', row.inputs.rules, 'rules'),
        row.scopeFlag.parentElement, bindRow(node('h5', 'st-sable-settings-subheading'), 'pack.sections'), row.blockList, blockActions);
      row.remove = button(actions, () => label(row.armed ? 'packs.confirmDelete' : 'packs.delete'), 'trash-can', () => {
        if (row.armed) { writePacks(userPacks().filter(pack => pack?.id !== id)); return; }
        row.armed = true; applyLabels(row.labels); row.remove.classList.add('st-sable-armed');
      }, row.labels);
      row.remove.addEventListener('blur', () => {
        if (!row.armed) return;
        row.armed = false; applyLabels(row.labels); row.remove.classList.remove('st-sable-armed');
      });
    }
    button(actions, 'packs.export', 'download', () => {
      const pack = current();
      if (pack) download(PACK_FILE, `${JSON.stringify(exportPack(pack, { random, lang: runtime.snapshot().settings.language }), null, 2)}\n`);
    }, row.labels);
    body.append(actions);
    row.element.append(summary, body);
    return row;
  }
  function renderPackBlocks(row, pack) {
    const seen = new Set(pack.sections.map(s => s.key));
    for (const [key, block] of row.blocks) if (!seen.has(key)) { block.element.remove(); row.blocks.delete(key); }
    let previous = null;
    for (const section of pack.sections) {
      if (!row.blocks.has(section.key)) {
        const block = createBlockRow({
          patch: patch => patchPackSection(pack.id, section.key, patch),
          remove: () => { const packNow = userPacks().find(p => p?.id === pack.id); if (packNow?.sections.length > 1) patchPack(pack.id, { sections: packNow.sections.filter(s => s.key !== section.key) }); },
          canRemove: () => (userPacks().find(p => p?.id === pack.id)?.sections.length ?? 0) > 1,
          rename: value => {
            const packNow = userPacks().find(p => p?.id === pack.id);
            if (!packNow || !SECTION_KEY.test(value) || packNow.sections.some(s => s.key === value && s.key !== section.key)) return false;
            if (value !== section.key) { openBlock = `${pack.id}:${value}`; patchPackSection(pack.id, section.key, { key: value }); }
            return true;
          },
        });
        block.element.dataset.packSection = `${pack.id}:${section.key}`;
        row.blocks.set(section.key, block);
      }
      const block = row.blocks.get(section.key);
      const expected = previous ? previous.nextSibling : row.blockList.firstChild;
      if (block.element !== expected) row.blockList.insertBefore(block.element, expected);
      previous = block.element;
      updateBlockRow(block, section);
      if (openBlock === `${pack.id}:${section.key}`) { openBlock = undefined; block.element.open = true; block.inputs.title.focus(); }
    }
  }
  function renderPacks() {
    const available = view.packs?.available ?? [], seen = new Set(available.map(pack => pack.id));
    for (const [id, row] of packRows) if (!seen.has(id)) { row.element.remove(); packRows.delete(id); }
    let previous = null;
    for (const pack of available) {
      if (!packRows.has(pack.id)) packRows.set(pack.id, createPackRow(pack.id, pack.builtin));
      const row = packRows.get(pack.id), { text: title, adult } = packTitle(pack.title);
      const expected = previous ? previous.nextSibling : packList.firstChild;
      if (row.element !== expected) packList.insertBefore(row.element, expected);
      previous = row.element;
      applyLabels(row.labels);
      row.glyph.replaceChildren(glyphNode(document, pack.icon || '🎒'));
      row.title.textContent = title; row.adult.hidden = !adult;
      row.description.textContent = pack.description ?? '';
      row.defaults.checked = view.settings.packDefaults.includes(pack.id);
      row.scopeRow.hidden = !pack.scope;
      setValue(row.scope, packScopeOf(view.settings, pack));
      const raw = pack.builtin ? null : view.settings.packs.find(item => item.id === pack.id);
      if (raw) {
        setValue(row.inputs.title, raw.title); setValue(row.inputs.icon, raw.icon ?? '');
        setValue(row.inputs.description, raw.description ?? ''); setValue(row.inputs.rules, raw.rules ?? '');
        row.scopeFlag.checked = !!raw.scope;
        renderPackBlocks(row, raw);
      }
    }
    const added = packRows.get(openPack);
    if (added) { openPack = undefined; added.element.open = true; added.inputs?.title.focus(); added.inputs?.title.select(); }
  }

  // Danger zone: instruction overrides and runtime-only request diagnostics.
  const danger = group('danger', 'group.danger');
  danger.append(text('p', 'st-sable-settings-hint', 'dangerHint'), text('h5', 'st-sable-settings-subheading', 'sub.prompts'),
    text('p', 'st-sable-settings-hint', 'prompts.hint'));
  const promptControls = new Map(), promptList = node('div');
  // Built-in sections and the sections of built-in packs (builtin: true) are tunable here; pack titles are localized live.
  const builtinSections = () => getAllSections(view.settings).filter(s => !s.custom || s.builtin);
  const sectionTitle = id => { const s = builtinSections().find(item => item.id === id); return !s ? id : s.custom ? s.title : label(s.title); };
  function promptField(parent, id, fallback, summary, kind = 'section') {
    const input = node('textarea', 'text_pole st-sable-settings-wide'); input.name = `prompts.${id}`;
    input.rows = kind === 'rules' ? 6 : 4; input.maxLength = kind === 'rules' ? 4000 : 2000;
    bind(labels, input, kind === 'rules' ? 'prompts.rules' : kind === 'pack' ? () => `${packTitle(view.packs.available.find(p => p.id === id)?.title).text}: ${label('prompts.packRules')}` : () => sectionTitle(id), 'aria-label');
    const write = value => runtime.updateSettings({ prompts: kind === 'rules' ? { rules: value } : kind === 'pack' ? { packs: { [id]: value } } : { sections: { [id]: value } } });
    input.addEventListener('change', () => { const value = input.value.trim(); write(!value || value === fallback ? null : value); });
    const badge = text('small', '', 'prompts.changed'); badge.dataset.changed = ''; summary.append(badge);
    parent.append(input);
    const reset = button(parent, 'prompts.default', 'arrow-rotate-left', () => write(null)); reset.name = `prompts.${id}.reset`;
    promptControls.set(id, { input, reset, badge, parent });
  }
  const rulesLabel = node('label', 'st-sable-settings-label'); rulesLabel.append(text('span', '', 'prompts.rules'));
  rulesLabel.htmlFor = 'st-sable-rules'; danger.append(rulesLabel);
  promptField(danger, 'rules', COMMON_RULES, rulesLabel, 'rules'); promptControls.get('rules').input.id = rulesLabel.htmlFor;
  danger.append(promptList);
  for (const section of builtinSections()) {
    const row = node('details', 'st-sable-prompt'); row.dataset.promptSection = section.id;
    const summary = node('summary'), glyph = node('span', 'st-sable-settings-glyph');
    summary.append(glyph, text('span', '', () => sectionTitle(section.id))); row.append(summary);
    promptField(row, section.id, section.pack ? BUILTIN_PACKS.find(p => p.id === section.pack).sections.find(s => `${section.pack}_${s.key}` === section.id).instructions : section.instructions, summary);
    promptControls.get(section.id).glyph = glyph; promptList.append(row);
  }
  // Pack rules of the built-in packs (prompts.packs[id]) follow the section list with the same Default button and badge.
  const packPromptList = node('div'); danger.append(packPromptList);
  for (const pack of BUILTIN_PACKS) {
    const row = node('details', 'st-sable-prompt'); row.dataset.promptPack = pack.id;
    const summary = node('summary'), glyph = node('span', 'st-sable-settings-glyph'); glyph.append(glyphNode(document, pack.icon));
    const name = () => packTitle(view.packs.available.find(p => p.id === pack.id)?.title).text;
    summary.append(glyph, text('span', '', name), text('span', 'st-sable-adult', 'packs.adult'), text('small', 'st-sable-pack-kind', 'prompts.packRules'));
    row.append(summary);
    promptField(row, pack.id, pack.rules, summary, 'pack');
    promptControls.get(pack.id).adult = summary.querySelector('.st-sable-adult'); packPromptList.append(row);
  }
  let resetArmed = false;
  const resetPrompts = button(danger, () => label(resetArmed ? 'prompts.confirmResetAll' : 'prompts.resetAll'), 'eraser', () => {
    if (!resetArmed) { resetArmed = true; resetPrompts.classList.add('st-sable-armed'); applyLabels(labels); return; }
    resetArmed = false; resetPrompts.classList.remove('st-sable-armed');
    runtime.updateSettings({ prompts: { rules: null, sections: Object.fromEntries(builtinSections().map(s => [s.id, null])),
      packs: Object.fromEntries(BUILTIN_PACKS.map(pack => [pack.id, null])) } });
  });
  resetPrompts.addEventListener('blur', () => { resetArmed = false; resetPrompts.classList.remove('st-sable-armed'); applyLabels(labels); });
  const formatMessages = messages => (messages ?? []).map(m => `=== ${m.role} ===\n${m.content}`).join('\n\n');
  function copyButton(parent, dump, list = labels) {
    return button(parent, 'preview.copy', 'copy', async () => {
      try {
        const clipboard = document.defaultView.navigator.clipboard;
        if (clipboard?.writeText) { await clipboard.writeText(dump.textContent); notify('success', label('preview.copied')); return; }
      } catch { /* Clipboard permissions may be unavailable; select the text instead. */ }
      const range = document.createRange(); range.selectNodeContents(dump);
      const selection = document.defaultView.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      notify('info', label('preview.selected'));
    }, list);
  }
  danger.append(text('h5', 'st-sable-settings-subheading', 'sub.preview'));
  const previewActions = node('div', 'st-sable-settings-buttons');
  const previewDump = node('pre', 'st-sable-dump st-sable-settings-wide'); previewDump.dataset.preview = '';
  button(previewActions, 'preview.show', 'eye', () => {
    const result = runtime.preview();
    previewDump.textContent = result ? `${formatMessages(result.messages)}${result.injection ? `\n\n${label('previewInjection')}:\n${result.injection}` : ''}\n\n${label('previewSections')}: ${result.requestedSections.join(', ')} · ${label('previewChars')}: ${result.chars} · ≈ ${Math.ceil(result.chars / 4)} ${label('previewTokens')}` : label('previewEmpty');
  });
  copyButton(previewActions, previewDump); danger.append(previewActions, previewDump);
  danger.append(text('h5', 'st-sable-settings-subheading', 'sub.log'));
  const logList = node('div', 'st-sable-log'), logEmpty = text('p', 'st-sable-settings-hint', 'logEmpty');
  let renderedLog, renderedLanguage;
  const logActions = node('div', 'st-sable-settings-buttons'); danger.append(logList, logEmpty, logActions);
  button(logActions, 'log.download', 'download', () => download('sable-log.json', JSON.stringify(view.log ?? [], null, 2)));
  button(logActions, 'log.clear', 'trash-can', () => runtime.clearLog());
  function renderDanger() {
    const sections = builtinSections(), texts = getPromptTexts(view.settings, getAllSections(view.settings));
    let previous = null;
    for (const id of ['rules', ...orderedSectionIds(view.settings.order, sections)]) {
      const control = promptControls.get(id), rules = id === 'rules';
      const changed = rules ? view.settings.prompts?.rules != null : view.settings.prompts?.sections?.[id] != null;
      setValue(control.input, rules ? texts.rules : texts.sections[id]); control.reset.disabled = !changed; control.badge.hidden = !changed;
      if (rules) continue;
      control.glyph.replaceChildren(sectionGlyph(document, sections.find(s => s.id === id), view.settings.visual?.icons));
      const expected = previous ? previous.nextSibling : promptList.firstChild;
      if (expected !== control.parent) promptList.insertBefore(control.parent, expected);
      previous = control.parent;
    }
    for (const pack of BUILTIN_PACKS) {
      const control = promptControls.get(pack.id), changed = view.settings.prompts?.packs?.[pack.id] != null;
      setValue(control.input, texts.packs[pack.id]); control.reset.disabled = !changed; control.badge.hidden = !changed;
      control.adult.hidden = !packTitle(view.packs.available.find(p => p.id === pack.id)?.title).adult;
    }
    // The log array is replaced only by a recorded run or Clear; other publishes (sliders, folds) keep the rows.
    if (view.log === renderedLog && view.settings.language === renderedLanguage) return;
    renderedLog = view.log; renderedLanguage = view.settings.language;
    const currentChat = getContext().getCurrentChatId();
    const open = new Set([...logList.children].filter(row => row.open).map(row => row.dataset.at));
    logList.replaceChildren(); logEmpty.hidden = !!view.log?.length;
    for (const entry of view.log ?? []) {
      const row = node('details', 'st-sable-log-entry'); row.dataset.status = entry.status; row.dataset.at = String(entry.at); row.open = open.has(row.dataset.at);
      const date = new Date(entry.at), time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
      // The chat is named only when the entry came from another chat.
      const elsewhere = entry.chatId !== undefined && entry.chatId !== currentChat ? ` · ${entry.chatId}` : '';
      row.append(node('summary', '', `${time} · ${label(`log.${entry.status}`)} · ${entry.ms} ${label('duration')}${elsewhere} · ${entry.requestedSections.join(', ')} · ${entry.inChars} → ${entry.outChars}`));
      if (entry.error || entry.warnings.length) row.append(node('pre', 'st-sable-dump st-sable-settings-wide', [entry.error, ...entry.warnings].filter(Boolean).join('\n')));
      const rowLabels = [];
      for (const [key, value] of [['log.request', formatMessages(entry.request)], ['log.response', entry.response ?? '']]) {
        const dump = node('pre', 'st-sable-dump st-sable-settings-wide', value);
        const actions = node('div', 'st-sable-settings-buttons'); actions.append(node('span', '', label(key)));
        copyButton(actions, dump, rowLabels); row.append(actions, dump);
      }
      applyLabels(rowLabels); logList.append(row);
    }
  }

  function refillProfiles() {
    const select = controls.get('profileId'); select.replaceChildren();
    const add = (value, caption, disabled = false) => {
      const item = node('option', '', caption); item.value = value; item.disabled = disabled; select.append(item);
    };
    add('', label('chooseProfile'));
    const profiles = getContext().extensionSettings.connectionManager?.profiles ?? [];
    for (const profile of profiles) add(profile.id,
      `${profile.name ?? profile.id}${profile.mode === 'cc' ? '' : ` (${label('notCC')})`}`, profile.mode !== 'cc');
    const selected = runtime.snapshot().settings.profileId;
    if (selected && !profiles.some(profile => profile.id === selected)) add(selected, label('missingProfile'), true);
    select.value = selected;
  }
  function render(next, force) {
    view = next; forced = force;
    applyLabels(labels);
    for (const id of GROUP_IDS) {
      const section = groups.get(id), open = !!view.settings.groups?.[id];
      if (section && section.open !== open) section.open = open;
    }
    for (const [key, input] of controls) {
      if (input.type === 'checkbox') input.checked = !!view.settings[key];
      else if (key !== 'profileId') setValue(input, view.settings[key]);
    }
    renderSections();
    renderCardColors();
    renderCustom();
    renderPacks();
    renderDanger();
    const visual = normalizeVisual(view.settings.visual);
    for (const [key, input] of visualControls) setValue(input, visual[key]);
    renderVisualExtras(visual);
    for (const [key, output] of visualOutputs) output.textContent = key === 'accent' ? visual.accent : formatVisual(key, visual[key]);
    for (const [key, { input, auto, fallback }] of optionalColors) {
      setValue(input, visual[key] ?? fallback);
      auto.setAttribute('aria-pressed', String(!visual[key]));
    }
    seed.disabled = !view.canSeedLegacy;
    reset.disabled = !Object.keys(view.store.modeOverride).length;
    refillProfiles();
    forced = undefined;
  }
  const ctx = getContext(), event = ctx.eventTypes.CONNECTION_PROFILE_LOADED;
  if (event) ctx.eventSource.on(event, refillProfiles);
  else toggle.addEventListener('click', refillProfiles);
  render(view);
  const unsubscribe = runtime.subscribe(next => render(next));
  return { element, dispose() {
    unsubscribe();
    if (event) ctx.eventSource.removeListener(event, refillProfiles);
    else toggle.removeEventListener('click', refillProfiles);
    element.remove();
  } };
}
