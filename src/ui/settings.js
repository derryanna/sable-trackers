import { SECTIONS } from '../sections.js';
import { t } from '../i18n.js';
import { VISUAL_DEFAULTS, VISUAL_RANGES, normalizeVisual } from '../settings.js';
import { applyVisual, glyphNode, sectionGlyph } from './drawer.js';

const CONTEXT_KEYS = ['messages', 'cardChars', 'loreChars', 'maxTokens', 'depth', 'keep'];
const ZERO_ALLOWED = new Set(['cardChars', 'loreChars', 'depth']);
const MODES = ['inject', 'show', 'off'];
const SHAPES = ['text', 'list', 'kv'];
const RANGE_KEYS = ['opacity', 'blur', 'fontSize', 'widthVw', 'radius'];
const RANGE_UNITS = { blur: 'px', fontSize: 'px', widthVw: 'vw', radius: 'px' };
const formatVisual = (key, value) => (key === 'opacity' ? `${Math.round(value * 100)}%` : `${value}${RANGE_UNITS[key]}`);

/** 'c_' + 8 hex, unique among the given ids (SPEC §11). */
export function newCustomId(taken = new Set(), random = globalThis.crypto) {
  for (;;) {
    const id = `c_${[...random.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    if (!taken.has(id)) return id;
  }
}

/** Settings writes belong to the runtime, including per-chat mode overrides. */
export function createSettings(runtime, { document = globalThis.document,
  getContext = () => globalThis.SillyTavern.getContext() } = {}) {
  const host = document.querySelector('#extensions_settings2') ?? document.querySelector('#extensions_settings');
  if (!host) return null;
  let view = runtime.snapshot(), forced, openCustom;
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
  function group(id, key) {
    const section = node('section', 'st-sable-settings-group'); section.dataset.group = id;
    section.append(text('h4', 'st-sable-settings-heading', key)); content.append(section);
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

  // Context: a two-column grid of label + narrow number.
  const context = group('context', 'group.context');
  const contextGrid = node('div', 'st-sable-settings-grid'); context.append(contextGrid);
  for (const key of CONTEXT_KEYS) {
    const row = bind(labels, node('label', 'st-sable-settings-num'), `hint.${key}`, 'title');
    const input = numberInput(key, ZERO_ALLOWED.has(key) ? 0 : 1, undefined, value => runtime.updateSettings({ [key]: value }));
    row.append(text('span', 'st-sable-settings-label', key), input); contextGrid.append(row); controls.set(key, input);
  }

  // Built-in sections: icon + title | mode | period.
  const sectionsGroup = group('sections', 'group.sections');
  const table = node('div', 'st-sable-settings-table');
  const head = node('div', 'st-sable-settings-thead'); head.setAttribute('aria-hidden', 'true');
  head.append(text('span', '', 'section'), text('span', '', 'mode'), bind(labels, text('span', '', 'periodShort'), 'period', 'title'));
  table.append(head);
  const sectionControls = SECTIONS.map(section => {
    const row = node('div', 'st-sable-settings-section'); row.dataset.section = section.id;
    const glyph = node('span', 'st-sable-settings-glyph');
    const name = node('span', 'st-sable-settings-section-name'); name.append(glyph, text('span', '', section.title));
    const mode = options(node('select', 'text_pole'), MODES, value => value); mode.name = 'mode';
    bind(labels, mode, () => `${label(section.title)}: ${label('mode')}`, 'aria-label');
    mode.addEventListener('change', () => runtime.setMode(section.id, mode.value));
    const period = numberInput('period', 0, undefined, value => runtime.updateSettings({ sections: { [section.id]: { period: value } } }));
    bind(labels, period, () => `${label(section.title)}: ${label('period')}`, 'aria-label');
    row.append(name, mode, period); table.append(row);
    return { section, glyph, mode, period };
  });
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
  function createCustomRow(id) {
    const row = { labels: [], armed: false };
    const bindRow = (element, key, attribute) => bind(row.labels, element, key, attribute);
    row.element = node('details', 'st-sable-custom'); row.element.dataset.customId = id;
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
      title: input('title', 60, value => patchCustom(id, { title: value || label('newBlockTitle') })),
      icon: input('icon', 40, value => patchCustom(id, { icon: value })),
      shape: options(node('select', 'text_pole'), SHAPES, value => `shape.${value}`, row.labels),
      max: numberInput('max', 1, 20, value => patchCustom(id, { max: value })),
      mode: options(node('select', 'text_pole'), MODES, value => value, row.labels),
      period: numberInput('period', 1, undefined, value => patchCustom(id, { period: value })),
      instructions: input('instructions', 2000, value => patchCustom(id, { instructions: value })),
    };
    inputs.shape.name = 'shape'; inputs.mode.name = 'mode'; inputs.instructions.rows = 3;
    inputs.shape.addEventListener('change', () => patchCustom(id, { shape: inputs.shape.value }));
    inputs.mode.addEventListener('change', () => patchCustom(id, { mode: inputs.mode.value }));
    bindRow(inputs.icon, 'custom.iconHint', 'title'); inputs.icon.placeholder = '📌';
    bindRow(inputs.instructions, 'custom.instructionsHint', 'placeholder');
    const small = node('div', 'st-sable-custom-fields');
    small.append(field('custom.icon', inputs.icon, 'icon'), field('custom.shape', inputs.shape, 'shape'),
      field('custom.max', inputs.max, 'max'), field('mode', inputs.mode, 'mode'), field('periodShort', inputs.period, 'period'));
    const actions = node('div', 'st-sable-custom-actions');
    // Two taps delete, so a stray tap cannot lose the instructions.
    row.remove = button(actions, () => label(row.armed ? 'custom.confirmDelete' : 'custom.delete'), 'trash-can', () => {
      if (row.armed) { writeCustom(customSections().filter(item => item?.id !== id)); return; }
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
  function updateCustomRow(row, item) {
    const shape = SHAPES.includes(item.shape) ? item.shape : 'list', mode = MODES.includes(item.mode) ? item.mode : 'show';
    row.glyph.replaceChildren(glyphNode(document, item.icon || '📌'));
    row.title.textContent = item.title || label('newBlockTitle');
    row.mode.textContent = label(mode); row.mode.dataset.mode = mode;
    applyLabels(row.labels);
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
      if (!customRows.has(item.id)) customRows.set(item.id, createCustomRow(item.id));
      const row = customRows.get(item.id);
      // Rows move only when out of place, so a focused field is not detached.
      const expected = previous ? previous.nextSibling : customList.firstChild;
      if (row.element !== expected) customList.insertBefore(row.element, expected);
      previous = row.element;
      updateCustomRow(row, item);
    }
    customEmpty.hidden = items.length > 0;
    const added = customRows.get(openCustom);
    if (added) { openCustom = undefined; added.element.open = true; added.inputs.title.focus(); added.inputs.title.select(); }
  }

  // Appearance (SPEC §12): sliders preview live on input and persist on change.
  const visualGroup = group('visual', 'group.visual');
  const visualGrid = node('div', 'st-sable-settings-grid'); visualGroup.append(visualGrid);
  const visualControls = new Map(), visualOutputs = new Map();
  const visualWith = (key, value) => normalizeVisual({ ...runtime.snapshot().settings.visual, [key]: value });
  const previewVisual = visual => {
    for (const target of document.querySelectorAll('.st-sable-drawer, .st-sable-tab')) applyVisual(target, visual);
  };
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
    input.addEventListener('change', () => runtime.updateSettings({ visual: visualWith(key, input.value) }));
  }
  for (const key of RANGE_KEYS) {
    const [min, max, step] = VISUAL_RANGES[key];
    const input = node('input'); input.type = 'range'; input.name = key;
    input.min = String(min); input.max = String(max); input.step = String(step);
    visualField(key, input);
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
  optionalColor('base', '#0e0e12');
  optionalColor('text', '#eeeae7');
  const accent = node('input'); accent.type = 'color'; accent.name = 'accent';
  visualField('accent', accent);
  const icons = options(node('select', 'text_pole'), ['fa', 'emoji'], value => `icons.${value}`); icons.name = 'icons';
  visualField('icons', icons, false);
  const visualActions = node('div', 'st-sable-settings-buttons'); visualGroup.append(visualActions);
  button(visualActions, 'resetVisual', 'eraser', () => runtime.updateSettings({ visual: { ...VISUAL_DEFAULTS } }));

  // Actions.
  const actions = group('actions', 'group.actions');
  const actionButtons = node('div', 'st-sable-settings-buttons'); actions.append(actionButtons);
  button(actionButtons, 'runNow', 'rotate', () => { void runtime.refresh(); });
  const seed = button(actionButtons, 'seedLegacy', 'file-import', () => { void runtime.seedLegacy(); });
  const reset = button(actionButtons, 'resetOverrides', 'arrow-rotate-left', () => {
    for (const id of Object.keys(runtime.snapshot().store.modeOverride)) runtime.setMode(id, null, true);
  });
  for (const key of ['perChatOverrides', 'showPanel', 'showFloatingButton']) checkbox(actions, key);

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
    for (const [key, input] of controls) {
      if (input.type === 'checkbox') input.checked = !!view.settings[key];
      else if (key !== 'profileId') setValue(input, view.settings[key]);
    }
    for (const { section, glyph, mode, period } of sectionControls) {
      glyph.replaceChildren(sectionGlyph(document, section, view.settings.visual?.icons));
      setValue(mode, view.modes[section.id]); setValue(period, view.settings.sections[section.id].period);
    }
    renderCustom();
    const visual = normalizeVisual(view.settings.visual);
    for (const [key, input] of visualControls) setValue(input, visual[key]);
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
