import { getSections, groupedOrder, bondScales } from '../sections.js';
import { dropIndex, moveToFolder, planDrop, slotFor } from '../folders.js';
import { newCustomId } from './settings.js';
import { t } from '../i18n.js';
import { normalizeVisual, VISUAL_DEFAULTS } from '../settings.js';
import { sanitizeSection } from '../parse.js';
import { packScopeOf } from '../packs/index.js';

export function displayNode(document, view, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = `st-sable-${className}`;
  if (text !== undefined) element.textContent = String(text).replace(/\{\{(user|char)\}\}/g,
    (macro, key) => (key === 'user' ? view.name1 : view.name2) ?? macro);
  return element;
}

/** One-level undo (SPEC §24): `show(text, restore)` replaces any pill shown; the pill hides after UNDO_MS, on a tap of
 *  its text, or once the button has called `restore()`. The snapshot lives in the closure only, nothing is persisted.
 *  `label(key)` is read at show time, so the button follows the language. */
export const UNDO_MS = 5000;
export function createUndoPill(document, label, timers = document.defaultView) {
  const element = document.createElement('div');
  element.className = 'st-sable-undo'; element.setAttribute('role', 'status'); element.hidden = true;
  const text = document.createElement('span'); text.className = 'st-sable-undo-text';
  const action = document.createElement('button'); action.type = 'button'; action.className = 'st-sable-undo-button';
  action.dataset.control = 'undo';
  element.append(text, action);
  let restore = null, timer;
  function hide() { timers.clearTimeout(timer); timer = undefined; restore = null; element.hidden = true; }
  text.addEventListener('click', hide);
  action.addEventListener('click', () => { const run = restore; hide(); run?.(); });
  function show(message, callback) {
    timers.clearTimeout(timer);
    restore = callback; text.textContent = String(message);
    action.textContent = label('undo.restore'); action.title = label('undo.restore');
    element.hidden = false;
    timer = timers.setTimeout(hide, UNDO_MS);
  }
  return { element, show, hide, get shown() { return !element.hidden; } };
}

// Monochrome Font Awesome glyphs for card titles, like the reference; registry emoji are the fallback.
export const SECTION_ICONS = Object.freeze({
  world: 'globe', offscreen: 'user-clock', threads: 'code-branch', story: 'seedling', npcs: 'masks-theater',
  thoughts: 'comment-dots', bonds: 'handshake', dossiers: 'address-card', planner: 'compass', banlist: 'ban',
});

/** A signed scale value as text (SPEC §22): «+65», «−40» (a true minus sign), «0». */
export const signedNumber = number => (number > 0 ? `+${number}` : number < 0 ? `−${Math.abs(number)}` : '0');

const BLACK = '0,0,0', WHITE = '255,255,255';
const hexRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

/** WCAG 2 relative luminance of '#rrggbb' (sRGB linearisation threshold 0.04045). */
export function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink ('r,g,b') for text and overlays on a colour: black or white, whichever has the higher WCAG
 *  contrast ratio. The crossover is at luminance ≈ 0.179, so pastel light-theme colours get black. */
export function inkFor(hex) {
  const light = luminance(hex);
  return (light + 0.05) / 0.05 >= 1.05 / (light + 0.05) ? BLACK : WHITE;
}

/** Colour variables for the visual settings; null means "remove", so style.css uses its dark-glass fallback. */
export function visualColors(visual) {
  const value = normalizeVisual(visual);
  // Overlay ink comes from the base only; a custom text colour never changes it.
  const ink = value.base ? inkFor(value.base) : null;
  // The default accent follows the ink in style.css, so it stays visible on any base.
  const accent = value.accent === VISUAL_DEFAULTS.accent ? null : value.accent;
  return {
    'base-rgb': value.base ? hexRgb(value.base).join(',') : null,
    'ink-rgb': ink,
    accent,
    'accent-ink-rgb': accent ? inkFor(accent) : (ink ?? WHITE) === WHITE ? BLACK : WHITE,
    text: value.text ?? (ink ? `rgb(${ink})` : null),
    tone: ink && (ink === BLACK ? 'light' : 'dark'),
  };
}

function applyCardColor(card, color) {
  for (const [key, value] of [['accent', color], ['accent-ink-rgb', color ? inkFor(color) : null]]) {
    if (value) card.style.setProperty(`--st-sable-${key}`, value);
    else card.style.removeProperty(`--st-sable-${key}`);
  }
  if (color) card.dataset.stSableTinted = '1'; else delete card.dataset.stSableTinted;
}

// Last background value per element: a data URL can be ~600 KB, so unchanged images are not re-set on every render.
const appliedImages = new WeakMap();

/** Visual settings (SPEC §12) as CSS custom properties and data attributes; style.css falls back to the defaults. */
export function applyVisual(element, visual) {
  const value = normalizeVisual(visual), colors = visualColors(value);
  const set = (name, css) => {
    if (css === null) element.style.removeProperty(`--st-sable-${name}`);
    else element.style.setProperty(`--st-sable-${name}`, css);
  };
  // A data attribute only while the value differs from the default look.
  const flag = (name, css) => {
    if (css === null) delete element.dataset[name];
    else element.dataset[name] = css;
  };
  for (const [name, css] of [['opacity', String(value.opacity)], ['blur', `${value.blur}px`], ['font', `${value.fontSize}px`],
    ['width', `${value.widthVw}vw`], ['radius', `${value.radius}px`], ['card-fill', String(value.cardFill)],
    ['border', String(value.border)], ['title-weight', String(value.titleWeight)], ['bg-dim', String(value.bgDim)]]) set(name, css);
  for (const name of ['base-rgb', 'ink-rgb', 'accent', 'accent-ink-rgb', 'text']) set(name, colors[name]);
  // Person cards (SPEC §21) take the npcs card colour.
  for (const card of element.querySelectorAll('.st-sable-card')) applyCardColor(card, value.cardColors[card.dataset.section ?? (card.dataset.person === undefined ? '' : 'npcs')]);
  // Light bases need darker status colours; see style.css.
  flag('stSableTone', colors.tone || null);
  applyEffects(element, value);
  flag('stSableTitleFont', value.titleFont === 'theme' ? null : value.titleFont);
  flag('stSableChip', value.chipStyle === 'filled' ? null : value.chipStyle);
  flag('stSableAccentBar', value.accentBar ? null : 'off');
  flag('stSableSpacing', value.spacing === 'cozy' ? null : value.spacing);
  // The background is a layer of the panel only; the edge tab never gets it.
  const image = element.classList.contains('st-sable-tab') ? null : value.bgImage;
  flag('stSableBg', image ? '1' : null);
  flag('stSableFit', image && value.bgFit !== 'cover' ? value.bgFit : null);
  // normalizeVisual guarantees no quotes, parentheses, backslashes or whitespace inside url("…").
  const css = image ? `url("${image}")` : null;
  if (appliedImages.get(element) !== css) { set('bg-image', css); appliedImages.set(element, css); }
}

// Live cards (SPEC §16): shimmer period per speed knob, number tick and dice animation lengths (ms).
const SHIMMER_DURATIONS = { slow: '7s', medium: '4s', fast: '2s' };
export const TICK_MS = 250, DICE_MS = 400;

/** Effects level and fx set (SPEC §16) on the drawer, the tab and the reply panel: `data-st-sable-effects="<level>"`,
 *  `data-st-sable-fx` = the names of the effects that are on (only at `full`) and the fx knobs as variables. The system
 *  reduced-motion setting forces the level to `off`, so the rAF paths that read the attribute stop too; style.css has
 *  its own media query as well. Null colours leave the variable unset, so the CSS falls back to the accent or the ink. */
export function applyEffects(element, visual) {
  const value = normalizeVisual(visual), { fx } = value;
  const reduced = !!element.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const level = reduced ? 'off' : value.effects;
  element.dataset.stSableEffects = level;
  const on = Object.keys(fx).filter(name => fx[name].on);
  if (level === 'full' && on.length) element.dataset.stSableFx = on.join(' '); else delete element.dataset.stSableFx;
  const accent = value.accent === VISUAL_DEFAULTS.accent ? null : value.accent;
  const rgb = hex => (hex ? hexRgb(hex).join(',') : null);
  for (const [name, css] of [['glow-rgb', rgb(fx.glow.color ?? accent)], ['glow', String(fx.glow.intensity)],
    ['shimmer-rgb', rgb(fx.shimmer.color ?? accent)], ['shimmer-duration', SHIMMER_DURATIONS[fx.shimmer.speed]],
    ['rain-rgb', rgb(fx.rain.color)], ['rain-density', String(fx.rain.density)], ['rain-angle', `${fx.rain.angle}deg`]]) {
    if (css === null) element.style.removeProperty(`--st-sable-${name}`); else element.style.setProperty(`--st-sable-${name}`, css);
  }
  return level;
}

/** One emoji/text glyph, or Font Awesome classes ('fa-key' or 'fa-solid fa-key'); never parsed as HTML. */
export function glyphNode(document, spec) {
  const value = String(spec ?? '').trim(), classes = value.split(/\s+/);
  let element;
  if (value && classes.every(name => /^fa-[a-z0-9-]+$/.test(name))) {
    element = document.createElement('i');
    if (!classes.some(name => ['fa-solid', 'fa-regular', 'fa-brands'].includes(name))) element.classList.add('fa-solid');
    element.classList.add(...classes);
  } else {
    element = document.createElement('span');
    element.textContent = value;
  }
  element.setAttribute('aria-hidden', 'true');
  return element;
}

/** Title glyph: built-ins use Font Awesome unless visual.icons is 'emoji'; custom sections keep their own icon. */
export function sectionGlyph(document, section, icons = 'fa') {
  const fa = SECTION_ICONS[section?.id];
  return glyphNode(document, icons !== 'emoji' && fa ? `fa-${fa}` : section?.icon);
}

// Markers inside cards: [Font Awesome name, emoji].
const MARKERS = {
  seed: ['seedling', '🌱'], timer: ['hourglass-half', '⏳'],
  time: ['clock', '🕒'], location: ['location-dot', '📍'], weather: ['cloud-sun-rain', '🌦️'],
};
const PRIORITIES = ['high', 'mid', 'low'];
const revealed = new Set();
// The NPC-keyed sections that the people layout (SPEC §21) shows as person cards.
const PEOPLE = Object.freeze(['npcs', 'thoughts', 'bonds', 'dossiers']);
const MODES = Object.freeze(['inject', 'show', 'off']);

// "18+" is part of the intimacy pack's title (SPEC §15 Decisions); the UI shows it as a badge instead.
export function packTitle(title) {
  const text = String(title ?? '');
  const adult = /18\+/.test(text);
  return { adult, text: (adult ? text.replace(/\s*\(?18\+\)?/, '').trim() : text) || text };
}

/** DOM-only view. Model text is never parsed as HTML. */
export function createDrawer(runtime, { document = globalThis.document, onSettings } = {}) {
  const win = document.defaultView;
  let view = runtime.snapshot(), opener, drag;
  let modeMenu, revealOff = false, rollNote = null, rollTimer;
  // Live cards (SPEC §16): cards with a change keep a title dot until unfolded or the next run; the last dice roll
  // drives the spin, the result flash and the crit glow of the renders within DICE_MS of it.
  let freshCards = new Set(), lastEntryKey, rolling = null, rolled = null;
  const cleanups = [];
  const label = key => t(key, view.settings.language);
  // Packs and folders share containers (SPEC §15/§18); the stored order stays flat.
  const sections = () => getSections(view.settings, view.packs?.enabled ?? []);
  const enabled = () => view.packs?.enabled ?? [];
  // People layout (SPEC §21): the four NPC-keyed sections read as one block, consumed from any folder that lists them.
  const peopleOn = () => view.settings.layout === 'people';
  const folderMembers = folder => (peopleOn() ? folder.members.filter(id => !PEOPLE.includes(id)) : folder.members);
  const drawerFolders = () => (peopleOn() ? [{ id: 'people', members: PEOPLE },
    ...(view.settings.folders ?? []).map(folder => ({ ...folder, members: folderMembers(folder) }))] : view.settings.folders);
  const grouped = () => groupedOrder(view.settings.order, sections(), enabled(), drawerFolders());
  let containerList = [];
  const containers = () => containerList;
  const describeContainers = () => [
    ...(view.packs?.available ?? []).filter(pack => enabled().includes(pack.id)).map(pack => ({ kind: 'pack', id: pack.id,
      key: `pack:${pack.id}`, title: packTitle(pack.title).text, adult: packTitle(pack.title).adult, glyph: () => packGlyph(pack),
      members: sections().filter(s => s.pack === pack.id).map(s => s.id), target: mode => runtime.setPackMode(pack.id, mode) })),
    // A folder of NPC sections only has nothing left to show in the people layout.
    ...(view.settings.folders ?? []).filter(folder => !folder.members.length || folderMembers(folder).length).map(folder => ({ ...folder,
      members: folderMembers(folder), kind: 'folder', key: `folder:${folder.id}`, adult: false,
      glyph: () => glyphNode(document, folder.icon || (view.settings.visual?.icons === 'emoji' ? '📁' : 'fa-folder')),
      target: mode => (peopleOn() ? runtime.setSectionsMode(folderMembers(folder), mode) : runtime.setFolderMode(folder.id, mode)) })),
    ...(peopleOn() ? [{ kind: 'people', id: 'people', key: 'people', title: label('people'), adult: false,
      glyph: () => glyphNode(document, view.settings.visual?.icons === 'emoji' ? '👥' : 'fa-users'),
      members: PEOPLE.filter(id => sections().some(section => section.id === id)), target: mode => runtime.setSectionsMode(PEOPLE, mode) }] : []),
  ];
  const containerOf = id => containers().find(group => group.members.includes(id));
  const groupNode = key => [...cards.children].find(group => group.dataset.container === key);
  /** Collapse each positioned container to its key; empty folders have no order token. */
  function tokens() {
    const result = [];
    for (const id of grouped()) { const token = containerOf(id)?.key ?? id; if (result.at(-1) !== token) result.push(token); }
    return result;
  }
  /** Move a flat card or a container block one step among top-level items. */
  function moveToken(token, delta) {
    const list = tokens(), index = list.indexOf(token), target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    const order = grouped();
    const keys = new Set(containers().map(group => group.key));
    runtime.updateSettings({ order: list.flatMap(item => (keys.has(item) ? order.filter(id => containerOf(id)?.key === item) : [item])) });
  }
  /** Move a member inside its own container; the rest of the order is untouched. */
  function moveMember(id, delta) {
    const pack = containerOf(id)?.key, order = grouped(), block = order.filter(item => containerOf(item)?.key === pack);
    const index = block.indexOf(id), target = index + delta;
    if (target < 0 || target >= block.length) return;
    [block[index], block[target]] = [block[target], block[index]];
    let cursor = 0;
    runtime.updateSettings({ order: order.map(item => (containerOf(item)?.key === pack ? block[cursor++] : item)) });
  }
  const node = (tag, className, text) => displayNode(document, view, tag, className, text);
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };
  function button(text, key, action, className = 'icon-button') {
    const element = node('button', className, text);
    element.type = 'button';
    element.title = label(key);
    element.setAttribute('aria-label', label(key));
    element.addEventListener('click', action);
    return element;
  }
  function icon(name, tag = 'i') {
    const element = document.createElement(tag);
    element.className = `fa-solid fa-${name}`;
    element.setAttribute('aria-hidden', 'true');
    return element;
  }
  const drawer = node('aside', 'drawer');
  drawer.hidden = true;
  drawer.id = 'st-sable-drawer';
  drawer.setAttribute('aria-label', label('sable'));
  const header = node('header', 'header');
  const title = node('h2', 'title');
  title.append(icon('wand-magic-sparkles'), document.createTextNode(` ${label('sable')}`));
  header.append(title);
  const refresh = button('', 'refresh', () => { void runtime.refresh(); });
  const pin = button('', 'pin', () => runtime.updateSettings({ pinned: !view.settings.pinned }));
  const settings = button('', 'settings', () => openSettings());
  /** The gear path: close the drawer and show our block in the Extensions tab; `group` opens that settings group first. */
  function openSettings(group) {
    hide(false);
    if (group && !view.settings.groups?.[group]) runtime.updateSettings({ groups: { [group]: true } });
    if (onSettings) return onSettings(group);
    const tab = document.querySelector('#extensions-settings-button');
    if (!tab?.querySelector('.openIcon')) (tab?.querySelector('.drawer-toggle') ?? tab)?.click();
    const section = document.querySelector('#st-sable-settings');
    const content = section?.querySelector('.inline-drawer-content');
    if (content && win.getComputedStyle(content).display === 'none') section.querySelector('.inline-drawer-toggle')?.click();
    const target = group ? section?.querySelector(`[data-group="${group}"]`) ?? section : section;
    target?.scrollIntoView?.({ block: 'center' });
  }
  const close = button('', 'close', () => hide());
  for (const [element, name] of [[refresh, 'rotate'], [pin, 'thumbtack'], [settings, 'gear'], [close, 'xmark']]) element.append(icon(name));
  // Packs (SPEC §15): a header button opens the sheet; ✕ stays in the corner.
  const packs = button('', 'packs.open', () => (sheet.hidden ? openSheet() : closeSheet()));
  packs.dataset.control = 'packs';
  packs.setAttribute('aria-haspopup', 'dialog');
  packs.setAttribute('aria-expanded', 'false');
  header.append(refresh, pin, settings, packs, close);
  const sheet = node('div', 'sheet');
  sheet.hidden = true;
  sheet.id = 'st-sable-sheet';
  packs.setAttribute('aria-controls', sheet.id);
  const sheetPanel = node('div', 'sheet-panel');
  sheetPanel.setAttribute('role', 'dialog');
  sheetPanel.setAttribute('aria-modal', 'true');
  const sheetHeader = node('div', 'sheet-header');
  const sheetTitle = node('h3', 'sheet-title'); sheetTitle.id = 'st-sable-sheet-title';
  sheetPanel.setAttribute('aria-labelledby', sheetTitle.id);
  const sheetClose = button('', 'packs.close', () => closeSheet());
  sheetClose.append(icon('xmark'));
  sheetHeader.append(sheetTitle, sheetClose);
  const sheetHint = node('p', 'sheet-hint');
  const packList = node('ul', 'pack-list');
  sheetPanel.append(sheetHeader, sheetHint, packList);
  sheet.append(sheetPanel);
  // The scrim is the sheet itself: a tap on it (outside the panel) closes.
  sheet.addEventListener('pointerdown', event => { if (event.target === sheet) closeSheet(false); });
  const cards = node('div', 'cards');
  const hiddenRow = node('div', 'hidden-row');
  const hiddenToggle = button('', 'hiddenSections', () => {
    revealOff = !revealOff;
    render(view);
    hiddenToggle.focus();
  }, 'hidden-toggle');
  hiddenToggle.setAttribute('aria-controls', 'st-sable-cards');
  cards.id = 'st-sable-cards';
  hiddenRow.append(hiddenToggle);
  const status = node('footer', 'status');
  status.setAttribute('role', 'status');
  // Legacy import (SPEC §28): a banner above the cards while the chat has old Sable data and no state of its own.
  // Only its buttons import or hide (per chat); opening the drawer never does.
  const banner = node('div', 'legacy-banner');
  banner.setAttribute('role', 'region');
  const bannerText = node('span', 'legacy-text');
  const afterBanner = () => { if (banner.hidden && banner.contains(document.activeElement)) close.focus(); };
  const seed = button('', 'legacy.import', () => { void runtime.seedLegacy(); afterBanner(); }, 'legacy-action');
  seed.dataset.control = 'legacy-import';
  const bannerHide = button('', 'legacy.hide', () => { runtime.hideLegacyBanner(); afterBanner(); }, 'legacy-action');
  bannerHide.dataset.control = 'legacy-hide';
  const bannerActions = node('div', 'legacy-actions');
  bannerActions.append(seed, bannerHide);
  banner.append(bannerText, bannerActions);
  // Rain overlay (SPEC §16): one CSS-only layer behind the cards, display: none unless the level is full and rain is on.
  const rain = node('div', 'rain');
  rain.setAttribute('aria-hidden', 'true');
  // The undo pill (SPEC §24) sits above the status line, in the flow, so it never covers a card.
  const undo = createUndoPill(document, label);
  // First-run hints (SPEC §27): one small dialog above the card list until settings.hints.done.
  const hint = node('div', 'hint');
  hint.id = 'st-sable-hint'; hint.hidden = true;
  hint.setAttribute('role', 'dialog');
  hint.setAttribute('aria-labelledby', 'st-sable-hint-title');
  drawer.append(rain, header, banner, hint, cards, hiddenRow, undo.element, status, sheet);
  // Edge pull tab: glued to the screen edge when closed, to the panel's left edge when open.
  const tab = button('', 'open', () => { if (drawer.hidden) open(tab); else hide(false); }, 'tab');
  tab.append(icon('wand-magic-sparkles'), icon('chevron-right'));
  tab.setAttribute('aria-controls', drawer.id);
  const menu = node('div', 'menu-entry');
  const menuIcon = icon('wand-magic-sparkles', 'div');
  menuIcon.classList.add('extensionsMenuExtensionButton');
  menu.append(menuIcon, node('span', '', label('sable')));
  menu.classList.add('list-group-item', 'flex-container', 'flexGap5');
  menu.tabIndex = 0;
  menu.setAttribute('role', 'button');
  menu.setAttribute('aria-controls', drawer.id);
  listen(menu, 'click', () => open(menu));
  listen(menu, 'keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open(menu); } });
  document.body.append(tab, drawer);
  document.querySelector('#extensionsMenu')?.append(menu);

  function syncExpanded() {
    const expanded = String(!drawer.hidden), key = drawer.hidden ? 'open' : 'closeSable';
    tab.setAttribute('aria-expanded', expanded);
    menu.setAttribute('aria-expanded', expanded);
    tab.title = label(key);
    tab.setAttribute('aria-label', label(key));
  }
  function open(source = document.activeElement) {
    opener = source;
    drawer.hidden = false;
    syncExpanded();
    close.focus();
  }
  function hide(restoreFocus = true) {
    closeModeMenu(false);
    closeSheet(false);
    stopTicks();
    drawer.hidden = true;
    syncExpanded();
    if (restoreFocus) opener?.focus?.();
  }
  function openSheet() {
    closeModeMenu(false);
    sheet.hidden = false;
    packs.setAttribute('aria-expanded', 'true');
    renderSheet();
    sheetClose.focus();
  }
  function closeSheet(restoreFocus = true) {
    if (sheet.hidden) return;
    sheet.hidden = true;
    packs.setAttribute('aria-expanded', 'false');
    if (restoreFocus) packs.focus();
  }
  listen(document, 'pointerdown', event => {
    if (modeMenu && !modeMenu.wrap.contains(event.target)) closeModeMenu(false);
    if (!sheet.hidden && !sheetPanel.contains(event.target) && !packs.contains(event.target)) closeSheet(false);
    if (!drawer.hidden && !view.settings.pinned && !drawer.contains(event.target)
      && !tab.contains(event.target) && !menu.contains(event.target)) hide(false);
  });
  listen(document, 'click', event => {
    if (modeMenu && !modeMenu.wrap.contains(event.target)) closeModeMenu(false);
  });
  listen(document, 'keydown', event => {
    if (event.key !== 'Escape') return;
    if (drag?.moved) { event.preventDefault(); cancelDrag(); return; }
    if (modeMenu) { event.preventDefault(); closeModeMenu(); }
    else if (!sheet.hidden) { event.preventDefault(); closeSheet(); }
    else if (!drawer.hidden) hide();
  });

  // Packs sheet: one row per available pack with a per-chat switch; scope packs that are on add the three-way scope toggle.
  function packGlyph(pack) {
    return glyphNode(document, pack.icon || (view.settings.visual?.icons === 'emoji' ? '🎒' : 'fa-box-open'));
  }
  function renderSheet() {
    sheetTitle.textContent = label('packs');
    sheetHint.textContent = label('packs.sheetHint');
    sheetClose.title = label('packs.close'); sheetClose.setAttribute('aria-label', label('packs.close'));
    const focused = document.activeElement, focusPack = focused?.closest?.('[data-pack]')?.dataset.pack, focusRole = focused?.dataset.control;
    packList.replaceChildren();
    for (const pack of view.packs?.available ?? []) {
      const on = view.packs.enabled.includes(pack.id), { text, adult } = packTitle(pack.title);
      const row = node('li', 'pack-row'); row.dataset.pack = pack.id;
      const main = node('div', 'pack-main');
      const glyph = node('span', 'pack-icon'); glyph.append(packGlyph(pack));
      const copy = node('div', 'pack-text');
      const heading = node('div', 'pack-title'); heading.append(node('span', '', text));
      if (adult) heading.append(node('span', 'adult', label('packs.adult')));
      copy.append(heading);
      if (pack.description) copy.append(node('div', 'pack-desc', pack.description));
      const toggle = button('', 'packs.on', () => runtime.setPack(pack.id, !on), 'switch');
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', String(on));
      toggle.setAttribute('aria-label', `${text}: ${label('packs.on')}`); toggle.title = `${text}: ${label('packs.on')}`;
      toggle.dataset.control = 'switch';
      toggle.append(node('span', 'switch-knob'));
      main.append(glyph, copy, toggle);
      row.append(main);
      if (pack.scope && on) {
        const segment = node('div', 'segment');
        segment.setAttribute('role', 'radiogroup');
        segment.setAttribute('aria-label', `${text}: ${label('packs.scope')}`);
        segment.append(node('span', 'segment-label', label('packs.scope')));
        const current = packScopeOf(view.settings, pack);
        for (const scope of ['all', 'user', 'others']) {
          const option = button(label(`scope.${scope}`), `scope.${scope}`, () => {
            if (scope !== current) runtime.updateSettings({ packScope: { [pack.id]: scope } });
          }, 'segment-option');
          option.setAttribute('role', 'radio');
          option.setAttribute('aria-checked', String(scope === current));
          option.dataset.control = `scope-${scope}`; option.dataset.scope = scope;
          segment.append(option);
        }
        row.append(segment);
      }
      packList.append(row);
    }
    if (focusPack && focusRole && sheetPanel.contains(focused) === false) {
      const row = packList.querySelector(`[data-pack="${focusPack}"]`);
      (row?.querySelector(`[data-control="${focusRole}"]`) ?? row?.querySelector('[data-control="switch"]'))?.focus();
    }
  }

  /** The three lines of hint 2: what each mode means. */
  function modeLegend(className) {
    const legend = node('div', className);
    for (const mode of MODES) legend.append(node('div', '', label(`legend.${mode}`)));
    return legend;
  }
  // Hint step 0–2 lives in memory: a reload starts from the first one until «Don't show again» or the end.
  let hintStep = 0, hintKey, hintsDone;
  function renderHint() {
    const done = !!view.settings.hints?.done;
    if (hintsDone && !done) hintStep = 0;
    hintsDone = done;
    hint.hidden = done;
    if (done) { hint.replaceChildren(); hintKey = undefined; return; }
    const key = JSON.stringify([hintStep, view.settings.language, view.settings.profileId, view.profiles]);
    if (key === hintKey) return;
    hintKey = key;
    const focusRole = hint.contains(document.activeElement) ? document.activeElement.dataset.control : null;
    const step = hintStep + 1;
    hint.dataset.step = String(step);
    const top = node('div', 'hint-top');
    const heading = node('h3', 'hint-title', label(`hints.${step}.title`)); heading.id = 'st-sable-hint-title';
    top.append(heading, node('span', 'hint-count', `${step}/3`));
    const body = node('div', 'hint-body');
    if (step === 1) {
      const profiles = view.profiles ?? [];
      if (profiles.some(profile => profile.cc)) {
        // The same source and filter as the settings control: non chat-completion profiles are listed but disabled.
        const row = node('label', 'hint-row');
        const select = node('select', 'hint-select');
        select.dataset.control = 'hint-profile';
        const add = (value, caption, disabled = false) => {
          const option = node('option', '', caption); option.value = value; option.disabled = disabled; select.append(option);
        };
        add('', label('chooseProfile'));
        for (const profile of profiles) add(profile.id, `${profile.name}${profile.cc ? '' : ` (${label('notCC')})`}`, !profile.cc);
        const selected = view.settings.profileId;
        if (selected && !profiles.some(profile => profile.id === selected)) add(selected, label('missingProfile'), true);
        select.value = selected;
        select.addEventListener('change', () => runtime.updateSettings({ profileId: select.value }));
        row.append(node('span', 'hint-text', label('hints.1.text')), select);
        body.append(row);
      } else body.append(node('p', 'hint-text', label('hints.1.none')));
    } else if (step === 2) body.append(modeLegend('hint-legend'));
    else body.append(node('p', 'hint-text', label('hints.3.text')));
    const actions = node('div', 'hint-actions');
    const never = node('label', 'hint-never');
    const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.control = 'hint-never';
    box.addEventListener('change', () => { if (box.checked) runtime.updateSettings({ hints: { done: true } }); });
    never.append(box, node('span', '', label('hints.never')));
    const last = hintStep === 2;
    const next = button(label(last ? 'hints.done' : 'hints.next'), last ? 'hints.done' : 'hints.next', () => {
      if (last) { runtime.updateSettings({ hints: { done: true } }); return; }
      hintStep += 1;
      renderHint();
      hint.querySelector('[data-control="hint-next"]')?.focus();
    }, 'hint-next');
    next.dataset.control = 'hint-next';
    actions.append(never, next);
    hint.replaceChildren(top, body, actions);
    if (focusRole) hint.querySelector(`[data-control="${focusRole}"]`)?.focus();
  }

  function closeModeMenu(restoreFocus = true) {
    if (!modeMenu) return;
    const { chip, popup, hosts, commit } = modeMenu;
    modeMenu = undefined;
    popup.remove();
    for (const host of hosts) host.classList.remove('st-sable-menu-open');
    chip.setAttribute('aria-expanded', 'false');
    if (restoreFocus) chip.focus();
    // A typed period is kept however the menu closes (Enter, a tap outside, a mode choice); Escape restores it first.
    commit?.();
  }
  // A card chip writes one section; a group chip (SPEC §15) writes every member of the pack in one go.
  const cardTarget = id => ({ current: view.modes[id], apply: mode => runtime.setMode(id, mode),
    gone: () => !cards.querySelector(`[data-section="${id}"]`), period: () => periodOf(id) });
  /** The period row of a card's mode menu (SPEC §28): the same global value the Sections table writes (a custom block
   *  keeps it in customSections, everything else in settings.sections), never a per-chat override. */
  function periodOf(id) {
    const section = sections().find(item => item.id === id);
    if (!section) return undefined;
    const own = section.custom && !section.pack;
    return { value: Number((own ? section.period : view.settings.sections[id]?.period) ?? 1),
      hint: id === 'dossiers' ? label('menu.periodDossiers') : '',
      write: period => {
        if (!own) { runtime.updateSettings({ sections: { [id]: { period } } }); return; }
        const list = runtime.snapshot().settings.customSections;
        runtime.updateSettings({ customSections: (Array.isArray(list) ? list : []).map(item => (item?.id === id ? { ...item, period } : item)) });
      } };
  }
  const groupTarget = pack => ({ current: groupState(pack).mode, apply: pack.target,
    gone: () => !groupNode(pack.key) });
  /** target = { current: the checked mode (null when mixed), apply(mode), gone(): the chip's card or group left the list,
   *  period?(): { value, hint, write(n) } for the «Every N replies» row }. */
  function openModeMenu(chip, wrap, target, entries = ['inject', 'show', 'off'].map(mode => ({ value: mode, text: label(mode) }))) {
    if (modeMenu?.chip === chip) { closeModeMenu(); return; }
    closeModeMenu(false);
    const popup = node('div', 'mode-menu');
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', chip.getAttribute('aria-label'));
    const choices = entries.map(({ value: mode, text, disabled }) => {
      const item = button('', mode, () => {
        closeModeMenu();
        target.apply(mode);
        // Switching off can remove the chip; keep keyboard focus on the reveal control.
        if (target.gone()) hiddenToggle.focus();
      }, 'mode-option');
      item.dataset.mode = mode; item.disabled = !!disabled;
      item.title = text; item.setAttribute('aria-label', text);
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(target.current === mode));
      item.tabIndex = -1;
      const check = icon('check'); check.style.visibility = target.current === mode ? 'visible' : 'hidden';
      item.append(check, document.createTextNode(text));
      popup.append(item);
      return item;
    });
    const period = target.period?.();
    let periodInput, commit;
    if (period) {
      const row = node('label', 'mode-period');
      periodInput = node('input', 'period-input');
      Object.assign(periodInput, { type: 'number', name: 'period', min: '0', max: '99', step: '1', inputMode: 'numeric', value: String(period.value) });
      periodInput.dataset.control = 'period';
      periodInput.setAttribute('aria-label', `${chip.title}: ${label('menu.period')}`);
      row.append(node('span', 'mode-period-label', label('menu.period')), periodInput);
      popup.append(row);
      if (period.hint) popup.append(node('p', 'mode-period-hint', period.hint));
      commit = () => {
        const raw = periodInput.value.trim(), value = Number(raw);
        if (raw === '' || !Number.isInteger(value) || value < 0) return;
        if (Math.min(99, value) !== period.value) period.write(Math.min(99, value));
      };
      periodInput.addEventListener('change', () => closeModeMenu());
    }
    // The mode legend (SPEC §27) is the menu's footer, after the period row (SPEC §28).
    if (entries.every(({ value }) => MODES.includes(value))) popup.append(modeLegend('menu-legend'));
    // The mode legend (SPEC §27) closes every mode menu; other menus (the folder picker) reuse this one without it.
    popup.addEventListener('keydown', event => {
      if (periodInput && event.target === periodInput) {
        // Arrows step the number natively; Enter keeps the value, Escape drops the typed text, Shift+Tab goes back.
        if (event.key === 'Escape') periodInput.value = String(period.value);
        else if (event.key === 'Enter') { event.preventDefault(); closeModeMenu(); }
        else if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); (choices.find(item => item.getAttribute('aria-checked') === 'true' && !item.disabled) ?? choices.find(item => !item.disabled))?.focus(); }
        else if (event.key === 'Tab') closeModeMenu();
        return;
      }
      const available = choices.filter(item => !item.disabled), index = available.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : available.length - 1)) % available.length;
        available[target]?.focus();
      } else if (['Enter', ' '].includes(event.key)) {
        event.preventDefault(); available[index]?.click();
      } else if (event.key === 'Tab' && periodInput && !event.shiftKey) {
        event.preventDefault(); periodInput.focus(); periodInput.select?.();
      } else if (event.key === 'Tab') closeModeMenu();
    });
    // The open card and, for a member, its group let the menu extend past their edges (style.css).
    const hosts = [wrap.closest('.st-sable-card'), wrap.closest('.st-sable-group')].filter(Boolean);
    modeMenu = { chip, wrap, popup, hosts, commit };
    wrap.append(popup);
    for (const host of hosts) host.classList.add('st-sable-menu-open');
    chip.setAttribute('aria-expanded', 'true');
    (choices.find(item => item.dataset.mode === target.current && !item.disabled) ?? choices.find(item => !item.disabled))?.focus();
  }
  /** The mode chip of a card or a group header: `mode` null shows «mixed». */
  function modeChip(name, mode, target) {
    const wrap = node('div', 'mode-wrap');
    const chip = button(label(mode ?? 'mixed'), 'inject', () => openModeMenu(chip, wrap, target), 'mode');
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    chip.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        if (!modeMenu || modeMenu.chip !== chip) openModeMenu(chip, wrap, target);
      }
    });
    wrap.append(chip);
    chip.title = name;
    chip.setAttribute('aria-label', `${name}: ${label(mode ?? 'mixed')}`); chip.dataset.control = 'mode'; chip.dataset.mode = mode ?? 'mixed';
    return wrap;
  }

  // Fold state of NPC/dossier/delta rows survives re-renders (mode taps, new states).
  let openRows = new Map();
  const muted = text => node('span', 'muted', text);
  const quote = text => (view.settings.language === 'ru' ? `«${text}»` : `“${text}”`);
  function line(parent, text, className = 'line') { if (text) parent.append(node('div', className, text)); }
  function fields(parent, value, keys) {
    const list = node('dl', 'kv');
    for (const key of keys) if (value?.[key]) list.append(node('dt', '', fieldLabel(key)), node('dd', '', value[key]));
    if (list.childNodes.length) parent.append(list);
  }
  let spoilerId = 0;
  function spoiler(parent, npc) {
    const block = node('div', 'spoiler-block'), list = node('dl', 'kv');
    list.id = `st-sable-spoiler-${++spoilerId}`;
    const toggle = button('', 'secret', () => {
      if (revealed.has(npc.id)) revealed.delete(npc.id); else revealed.add(npc.id);
      paint();
    }, 'spoiler');
    toggle.dataset.control = 'spoiler';
    toggle.setAttribute('aria-controls', list.id);
    function paint() {
      const shown = revealed.has(npc.id);
      toggle.setAttribute('aria-expanded', String(shown));
      toggle.replaceChildren(view.settings.visual?.icons === 'emoji' ? glyphNode(document, '🙊') : icon(shown ? 'eye' : 'eye-slash'), node('span', '', label('secret')));
      list.hidden = !shown;
      list.replaceChildren();
      // Keep concealed text out of the DOM until the reader asks for it.
      if (shown) for (const key of ['secret', 'truth']) if (npc[key]) list.append(node('dt', '', label(key)), node('dd', '', npc[key]));
    }
    paint(); block.append(toggle, list); parent.append(block);
  }
  function details(parent, parts, expanded, key) {
    const item = node('details', 'detail');
    item.dataset.key = key;
    item.open = openRows.get(key) ?? expanded;
    const summary = node('summary', 'summary');
    summary.append(...parts);
    item.append(summary);
    parent.append(item);
    return item;
  }
  function turns(count) {
    const key = `turns.${new Intl.PluralRules(view.settings.language).select(count)}`;
    return label(key) === key ? label('turns') : label(key);
  }
  // List and meta markers follow visual.icons like the card titles.
  function marker(name) {
    const [fa, emoji] = MARKERS[name];
    return view.settings.visual?.icons === 'emoji' ? node('span', 'emoji', emoji) : icon(fa);
  }
  function listItem(glyph, text, meta) {
    const item = node('li', 'item');
    const mark = node('span', 'glyph', typeof glyph === 'string' ? glyph : undefined); mark.setAttribute('aria-hidden', 'true');
    if (typeof glyph !== 'string') mark.append(glyph);
    item.append(mark, node('span', 'item-text', text));
    if (meta) item.append(node('span', 'item-meta', meta));
    return item;
  }
  // Dice (SPEC §15): any stats/kv percentage row uses the chat-local integration.
  function diceFor(section) {
    if (!['stats', 'kv'].includes(section.shape)) return null;
    return (key, chance) => {
      // kv values may carry a label after the number ("15 (estimate)"); the leading number is the chance.
      if (!/%$/.test(key) || !Number.isFinite(chance)) return null;
      chance = Math.min(100, Math.max(0, chance));
      const die = button('', 'dice', event => {
        event.preventDefault();
        const result = runtime.rollDice(section.id, key, chance);
        if (!result) return;
        const at = Date.now(), crit = (result.hit && /crit/i.test(result.label)) || result.roll === 1 || result.roll === 100;
        rolling = { id: section.id, key, at }; rolled = { id: section.id, at, crit };
        rollNote = `${label('dice.rolled')}: ${result.roll} vs ${result.label} ${result.chance} → ${label(result.hit ? 'dice.hit' : 'dice.miss')}`;
        render(runtime.snapshot());
        win.clearTimeout(rollTimer);
        rollTimer = win.setTimeout(() => { rollNote = null; renderStatus(); }, 6000);
      }, 'dice');
      die.dataset.control = 'dice';
      die.append(view.settings.visual?.icons === 'emoji' ? node('span', 'emoji', '🎲') : icon('dice'));
      // The die is rebuilt by the render the roll triggers; a negative delay resumes the spin where it was.
      const elapsed = rolling?.id === section.id && rolling.key === key ? Date.now() - rolling.at : DICE_MS;
      if (elapsed < DICE_MS) {
        die.classList.add('st-sable-rolling');
        die.style.setProperty('--st-sable-roll-delay', `-${elapsed}ms`);
        die.addEventListener('animationend', () => die.classList.remove('st-sable-rolling'), { once: true });
      }
      const wrap = node('span', 'dice-row'); wrap.append(die);
      const result = view.store.roll;
      if (result?.sectionId === section.id && result.key === key) {
        const text = node('span', 'roll-result');
        text.textContent = `${result.roll} → ${label(result.hit ? 'dice.hit' : 'dice.miss')}`;
        text.dataset.stSableRoll = result.consumedAt == null || view.rollArmed ? 'pending' : 'done';
        if (rolled?.id === section.id && Date.now() - rolled.at < DICE_MS) text.toggleAttribute('data-st-sable-rolled', true);
        wrap.append(text);
      }
      return wrap;
    };
  }
  // Live cards (SPEC §16): bond scales and pack stats are keyed rows that keep their node across renders, so the bar
  // fill slides to its new value (a transform transition in style.css) and a changed value is flagged for exactly one
  // render. Every row is a <details>: a delta or a stat note opens the reason on tap; a static row keeps the same markup
  // and ignores the tap, so a delta appearing later never swaps the node. A brand-new row appears at its value.
  const ticks = new Map();
  const ticksOn = () => drawer.dataset.stSableEffects === 'full' && !!view.settings.visual?.fx?.ticks?.on
    && typeof win?.requestAnimationFrame === 'function';
  function stopTick(score, settle = true) {
    const tick = ticks.get(score);
    if (!tick) return;
    win.cancelAnimationFrame(tick.frame);
    ticks.delete(score);
    if (settle) score.textContent = tick.final;
  }
  const stopTicks = () => { for (const score of [...ticks.keys()]) stopTick(score); };
  /** One rAF run of at most TICK_MS: the number counts from the old value to the new one, then the run ends. */
  function startTick(score, from, to, format) {
    stopTick(score, false);
    const started = win.performance.now(), tick = { final: format(to), frame: 0 };
    const step = now => {
      const progress = Math.min(1, (now - started) / TICK_MS);
      score.textContent = progress < 1 ? format(Math.round(from + (to - from) * progress)) : tick.final;
      if (progress < 1) tick.frame = win.requestAnimationFrame(step); else ticks.delete(score);
    };
    ticks.set(score, tick);
    tick.frame = win.requestAnimationFrame(step);
  }
  const place = (parent, element, previous) => {
    const expected = previous ? previous.nextSibling : parent.firstChild;
    if (element !== expected) parent.insertBefore(element, expected);
  };
  // Existing keyed children by key; a duplicate key (a model slip) keeps the first node and drops the rest.
  function keyedChildren(parent, selector) {
    const map = new Map();
    for (const item of parent.querySelectorAll(selector)) { if (map.has(item.dataset.key)) dropRow(item); else map.set(item.dataset.key, item); }
    return map;
  }
  const dropRow = item => { for (const score of item.querySelectorAll('.st-sable-score')) stopTick(score, false); item.remove(); };
  const unique = (seen, key) => { let candidate = key; for (let n = 2; seen.has(candidate); n++) candidate = `${key}#${n}`; seen.add(candidate); return candidate; };
  /** Creates or updates the row for `key`. spec: { name, title, stat, friction, value, max, plain, unit, delta, reason, openable, die,
   *  signed, history }; `plain` shows the bare number (bond scales are always out of 100), `signed` draws a centred bar for
   *  −max…+max with a signed number, `history` (numbers) adds the sparkline under the bar (SPEC §22). */
  /** The history line under a bar (SPEC §22, §26): one span per `{ mesId, value }` point, kept in place and resized;
   *  absent under 2 points or with `visual.sparklines` off. Heights span the scale's range, at least 8 %. It is the
   *  summary's last fixed child (the first four are read by position; the grid puts it under the bar), so a closed row
   *  still shows it. It is a button: a tap picks the bar under the pointer and jumps to its reply (`spark-label` below
   *  names it), a second tap on the same bar hides the label; ←/→ move the pick, Enter jumps. */
  function sparkline(row, spec, signed) {
    let spark = row.querySelector(':scope > .st-sable-spark');
    const points = view.settings.visual?.sparklines === false || !Array.isArray(spec.history) ? []
      : spec.history.filter(point => Number.isFinite(point?.value) && Number.isInteger(point?.mesId)).slice(-12);
    const key = row.parentElement?.dataset.key;
    if (points.length < 2) {
      spark?.remove(); row.querySelector(':scope > .st-sable-spark-label')?.remove(); picks().delete(key);
      return;
    }
    if (!spark) {
      spark = node('div', 'spark'); spark.setAttribute('role', 'button'); spark.tabIndex = 0;
      spark.addEventListener('click', sparkClick); spark.addEventListener('keydown', sparkKey);
      row.append(spark);
    }
    spark.setAttribute('aria-label', label('spark.history'));
    spark.className = `st-sable-spark ${spec.friction ? 'st-sable-friction' : 'st-sable-affinity'}`;
    while (spark.children.length > points.length) spark.lastElementChild.remove();
    while (spark.children.length < points.length) spark.append(document.createElement('span'));
    const min = signed ? -spec.max : 0, max = spec.max;
    points.forEach(({ value }, index) => {
      const span = spark.children[index], ratio = (Math.min(max, Math.max(min, value)) - min) / (max - min);
      span.style.height = `${Math.max(8, Math.round(ratio * 1000) / 10)}%`;
      span.classList.toggle('st-sable-negative', signed && value < 0);
    });
    sparks.set(spark, { key, points, title: spec.name, signed });
    showPick(spark);
  }
  // Picked bars by row key, per chat store, so a pick survives re-renders but not a chat switch.
  const sparks = new WeakMap(), pickStores = new WeakMap(), noStore = new Map();
  function picks() {
    const store = view.store;
    if (!store || typeof store !== 'object') return noStore;
    if (!pickStores.has(store)) pickStores.set(store, new Map());
    return pickStores.get(store);
  }
  const messageNode = mesId => document.querySelector(`#chat .mes[mesid="${mesId}"]`);
  /** Marks the picked bar and writes the label row right after the sparkline; no pick (or a pruned one) removes it. */
  function showPick(spark) {
    const data = sparks.get(spark), mesId = picks().get(data.key);
    const index = mesId === undefined ? -1 : data.points.findIndex(point => point.mesId === mesId);
    [...spark.children].forEach((span, at) => span.classList.toggle('st-sable-spark-active', at === index));
    let text = spark.nextElementSibling?.classList.contains('st-sable-spark-label') ? spark.nextElementSibling : null;
    if (index < 0) { if (mesId !== undefined) picks().delete(data.key); text?.remove(); return; }
    if (!text) {
      text = node('div', 'spark-label'); text.setAttribute('aria-live', 'polite');
      // Inside the summary: a tap on the label must not fold the row.
      text.addEventListener('click', event => event.preventDefault());
      spark.after(text);
    }
    const { value } = data.points[index];
    text.textContent = `${label('spark.reply')} #${mesId} · ${data.title} ${data.signed ? signedNumber(value) : value}`
      + (messageNode(mesId) ? '' : ` ${label('spark.notLoaded')}`);
  }
  function pickSpark(spark, index, jump) {
    const data = sparks.get(spark);
    if (!data) return;
    const point = data.points[Math.min(data.points.length - 1, Math.max(0, index))];
    picks().set(data.key, point.mesId);
    showPick(spark);
    if (jump) messageNode(point.mesId)?.scrollIntoView?.({ block: 'center',
      behavior: drawer.dataset.stSableEffects === 'off' ? 'auto' : 'smooth' });
  }
  const pickedIndex = spark => {
    const data = sparks.get(spark), mesId = picks().get(data?.key);
    return mesId === undefined ? -1 : data.points.findIndex(point => point.mesId === mesId);
  };
  function sparkClick(event) {
    // The sparkline sits inside a <summary>: the tap is the sparkline's, not the row's.
    event.preventDefault(); event.stopPropagation();
    const spark = event.currentTarget, data = sparks.get(spark);
    if (!data) return;
    const box = spark.getBoundingClientRect(), count = data.points.length;
    const index = box.width > 0 ? Math.floor((event.clientX - box.left) / box.width * count) : count - 1;
    const at = Math.min(count - 1, Math.max(0, index));
    if (at === pickedIndex(spark)) { picks().delete(data.key); showPick(spark); return; }
    pickSpark(spark, at, true);
  }
  function sparkKey(event) {
    const spark = event.currentTarget, data = sparks.get(spark);
    if (!data) return;
    const current = pickedIndex(spark), last = data.points.length - 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      pickSpark(spark, current < 0 ? last : current + step, false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickSpark(spark, current < 0 ? last : current, true);
    }
  }
  function scaleRow(existing, key, spec) {
    const kind = spec.max == null ? 'counter' : 'bar';
    let wrap = existing.get(key);
    if (wrap && wrap.dataset.kind !== kind) { dropRow(wrap); wrap = undefined; }
    const fresh = !wrap;
    if (fresh) {
      wrap = node('details', 'scale'); wrap.dataset.key = key; wrap.dataset.kind = kind;
      const row = node('summary', 'scale-row');
      row.addEventListener('click', event => { if (wrap.classList.contains('st-sable-static')) event.preventDefault(); });
      row.append(node('span', 'scale-name'));
      if (kind === 'bar') {
        const bar = node('span', 'bar'); bar.setAttribute('role', 'meter'); bar.setAttribute('aria-valuemin', '0');
        bar.append(node('span', 'bar-fill')); row.append(bar);
      } else row.append(node('span', 'bar-gap'));
      row.append(node('span', 'score'), node('span', 'badge'));
      wrap.append(row, node('div', 'reason'));
    }
    const [row, reason] = wrap.children, [name, bar, score, badge] = row.children;
    row.classList.toggle('st-sable-stat-row', !!spec.stat);
    row.classList.toggle('st-sable-counter', kind === 'counter');
    name.textContent = spec.name;
    if (spec.title) name.title = spec.title; else name.removeAttribute('title');
    const value = Number(spec.value), previous = fresh ? undefined : Number(wrap.dataset.value);
    const changed = !fresh && previous !== value;
    const signed = kind === 'bar' && !!spec.signed;
    const format = number => `${signed ? signedNumber(number) : number}${spec.max == null || spec.plain ? '' : `/${spec.max}`}${spec.unit ? ` ${spec.unit}` : ''}`;
    if (kind === 'bar') {
      // A signed scale (SPEC §22) fills from the centre: right for positive, left for negative; the opposite side takes
      // the other tint (warm for an affinity scale, the accent for a friction one).
      const negative = signed && value < 0, warm = negative ? !spec.friction : !!spec.friction;
      bar.className = `st-sable-bar ${warm ? 'st-sable-friction' : 'st-sable-affinity'}${signed ? ' st-sable-signed' : ''}${negative ? ' st-sable-negative' : ''}`;
      bar.setAttribute('aria-label', spec.name);
      bar.setAttribute('aria-valuemin', String(signed ? -spec.max : 0));
      bar.setAttribute('aria-valuemax', String(spec.max));
      bar.setAttribute('aria-valuenow', String(value));
      const ratio = Math.min(1, Math.max(0, (signed ? Math.abs(value) : value) / spec.max)), fill = bar.firstElementChild;
      fill.style.transform = `scaleX(${ratio})`;
      fill.style.setProperty('--st-sable-ratio', String(ratio));
      fill.style.left = signed && !negative ? '50%' : '';
      fill.style.right = negative ? '50%' : '';
      // Value colour (full): affinity bars pulse under 20 %; friction and signed bars are not "low" when they drop.
      bar.toggleAttribute('data-st-sable-low', !spec.friction && !signed && ratio < 0.2);
      sparkline(row, spec, signed);
    }
    if (changed && Number.isFinite(previous) && ticksOn()) startTick(score, previous, value, format);
    else { stopTick(score, false); score.textContent = format(value); }
    const delta = Number.isFinite(spec.delta) && spec.delta !== 0 ? spec.delta : 0;
    badge.hidden = !delta;
    if (delta) { badge.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`; badge.className = `st-sable-badge ${delta > 0 ? 'st-sable-up' : 'st-sable-down'}`; }
    row.querySelector('.st-sable-dice-row')?.remove();
    const die = spec.die?.();
    // The die keeps its place in the first column, before the sparkline (null = the end of the row).
    if (die) row.insertBefore(die, row.querySelector(':scope > .st-sable-spark'));
    const openable = !!delta || !!spec.openable;
    wrap.classList.toggle('st-sable-delta', !!delta);
    wrap.classList.toggle('st-sable-static', !openable);
    reason.textContent = spec.reason || '—';
    wrap.open = openable && (openRows.get(key) ?? false);
    wrap.toggleAttribute('data-st-sable-changed', changed);
    wrap.dataset.value = String(value);
    return { element: wrap, changed };
  }
  /** Bond groups keyed `bonds:<id>`; a person card (SPEC §21) keys them `person:<id>` and leaves the name to its header. */
  function renderBonds(body, value, prefix = 'bonds', named = true) {
    for (const child of [...body.children]) if (!child.classList.contains('st-sable-bond')) child.remove();
    const groups = keyedChildren(body, ':scope > .st-sable-bond'), seen = new Set();
    let changedAny = false, previousGroup = null;
    for (const bond of value) {
      const groupKey = unique(seen, `${prefix}:${bond.id}`);
      let group = groups.get(groupKey); groups.delete(groupKey);
      if (!group) { group = node('div', 'bond'); group.dataset.key = groupKey; group.append(node('div', 'bond-name')); }
      const head = group.firstElementChild;
      head.replaceChildren(...(named ? [node('span', 'name', bond.name || bond.id)] : []), muted(`${named ? ' ' : ''}→ ${bond.toward || '—'}`));
      const rows = keyedChildren(group, ':scope > details');
      let previous = head;
      // Active scales only (SPEC §20); the warm tint follows each scale's `friction`.
      for (const { key: scale, builtin, title, friction, signed } of bondScales(view.settings)) {
        const score = bond.stats?.[scale];
        if (!Number.isFinite(score)) continue;
        const change = bond.changes?.[scale], key = `${groupKey}:${scale}`, name = builtin ? label(title) : title;
        const { element, changed } = scaleRow(rows, key, { name, title: name, friction, signed,
          value: score, max: 100, plain: true, delta: change?.delta, reason: change?.reason,
          history: view.store?.history?.[bond.id]?.[scale] });
        rows.delete(key); changedAny ||= changed;
        place(group, element, previous); previous = element;
      }
      for (const leftover of rows.values()) dropRow(leftover);
      place(body, group, previousGroup); previousGroup = group;
    }
    for (const leftover of groups.values()) dropRow(leftover);
    return changedAny;
  }
  // Stats rows (SPEC §15) share the bond row: a bar when max is set, a plain counter otherwise; a delta or a note opens on tap.
  function renderStats(section, body, value, dice) {
    for (const child of [...body.children]) if (!child.classList.contains('st-sable-stats')) child.remove();
    let group = body.querySelector(':scope > .st-sable-stats');
    if (!group) { group = node('div', 'stats'); body.append(group); }
    const rows = keyedChildren(group, ':scope > details'), seen = new Set();
    let changedAny = false, previous = null;
    for (const item of value) {
      const key = unique(seen, `${section.id}:${item.key}`);
      const { element, changed } = scaleRow(rows, key, { name: item.key, stat: true, value: item.value, max: item.max, unit: item.unit,
        delta: item.delta, reason: item.note, openable: !!item.note, die: () => dice?.(item.key, item.value),
        history: view.store?.history?.[section.id]?.[String(item.key).trim()] });
      rows.delete(key); changedAny ||= changed;
      place(group, element, previous); previous = element;
    }
    for (const leftover of rows.values()) dropRow(leftover);
    if (!group.childNodes.length) group.remove();
    return changedAny;
  }
  /** Fills a card body from the state. Keyed sections reconcile their rows in place and report whether a value changed;
   *  every other body is rebuilt. An empty body shows "—". */
  function renderBody(section, body, state) {
    const { id } = section, value = state[id];
    const keyed = id === 'bonds' || (section.custom && section.shape === 'stats');
    let changed = false;
    if (keyed && Array.isArray(value)) changed = id === 'bonds' ? renderBonds(body, value) : renderStats(section, body, value, diceFor(section));
    else { body.replaceChildren(); if (value) fillBody(section, body, value, state); }
    if (!body.childNodes.length) body.append(node('span', 'empty', '—'));
    return changed;
  }
  function fillBody(section, body, value, state) {
    const { id } = section;
    if (section.custom) {
      if (section.shape === 'text') {
        const line = node('p', 'line', value);
        body.append(line); return;
      }
      if (!Array.isArray(value) || !value.length) return;
      const dice = diceFor(section);
      if (section.shape === 'list') {
        const list = node('ul', 'list');
        for (const text of value) list.append(listItem('•', text));
        body.append(list);
      } else if (section.shape === 'kv') {
        const list = node('dl', 'kv');
        for (const item of value) {
          const cell = node('dd', '', item.value);
          const die = dice?.(item.key, parseFloat(String(item.value)));
          if (die) { cell.replaceChildren(node('span', '', item.value), die); cell.classList.add('st-sable-kv-dice'); }
          list.append(node('dt', '', item.key), cell);
        }
        body.append(list);
      } else if (section.shape === 'tags') {
        const chips = node('div', 'chips');
        for (const tag of value) { const chip = node('span', 'tag', tag); chip.classList.add('st-sable-ban'); chips.append(chip); }
        body.append(chips);
      }
      return;
    }
    switch (id) {
      case 'world': {
        const meta = node('div', 'meta');
        for (const key of ['time', 'location', 'weather']) {
          if (!value[key]) continue;
          const item = node('span', 'meta-item'); item.title = label(key);
          item.append(marker(key), node('span', '', value[key]));
          meta.append(item);
        }
        if (meta.childNodes.length) body.append(meta);
        line(body, value.summary);
        const pc = ['outfit', 'position', 'visible_condition', 'carrying'].map(key => value.pc?.[key]).filter(Boolean);
        if (pc.length) {
          const row = node('div', 'you');
          row.append(node('span', 'key', label('you')), node('span', '', pc.join(' · ')));
          body.append(row);
        }
        break;
      }
      case 'offscreen':
        for (const item of value) {
          const row = node('div', 'person');
          row.append(node('span', 'name', item.name), muted(` — ${item.doing || '—'}`));
          body.append(row);
        }
        break;
      case 'threads':
        for (const item of value) {
          const priority = PRIORITIES.includes(item.priority) ? item.priority : 'low';
          const row = node('div', 'thread');
          const dot = node('span', 'dot');
          dot.classList.add(`st-sable-priority-${priority}`);
          dot.setAttribute('role', 'img');
          dot.setAttribute('aria-label', label(`priority.${priority}`));
          dot.title = label(`priority.${priority}`);
          row.append(dot, node('span', '', item.text));
          body.append(row);
        }
        break;
      case 'story': {
        const phases = node('div', 'chips');
        for (const key of ['arc_phase', 'scene_phase']) if (value[key]) {
          const chip = node('span', 'tag');
          chip.append(node('span', 'tag-key', label(key)), node('span', '', value[key]));
          phases.append(chip);
        }
        if (phases.childNodes.length) body.append(phases);
        const list = node('ul', 'list');
        for (const seed of value.seeds ?? []) {
          const age = Number.isFinite(seed.planted_turn) ? Math.max(0, (state.meta?.turn ?? 0) - seed.planted_turn) : null;
          list.append(listItem(marker('seed'), seed.text, age === null ? '' : `${age} ${turns(age)}`));
        }
        for (const timer of value.timers ?? []) list.append(listItem(marker('timer'), timer.text, timer.due));
        if (list.childNodes.length) body.append(list);
        break;
      }
      case 'npcs':
        for (const npc of [...value].sort((a, b) => Number(!!b.present) - Number(!!a.present))) {
          const presence = node('span', 'presence');
          presence.setAttribute('role', 'img');
          presence.setAttribute('aria-label', label(npc.present ? 'here' : 'away'));
          const parts = [presence, node('span', 'name', npc.name || npc.id)];
          if (!npc.present) parts.push(node('span', 'pill', label('away')));
          parts.push(node('span', 'mood', npc.mood || '—'));
          const item = details(body, parts, !!npc.present, `npcs:${npc.id}`);
          item.classList.add(npc.present ? 'st-sable-present' : 'st-sable-absent');
          fields(item, npc, ['agenda', 'outfit', 'position', 'action', 'wants_toward', ...(view.settings.spoilers ? [] : ['secret', 'truth'])]);
          if (view.settings.spoilers && (npc.secret || npc.truth)) spoiler(item, npc);
        }
        break;
      case 'thoughts':
        for (const thought of value) if (state.npcs?.some(npc => npc.id === thought.id && npc.present)) {
          const item = node('div', 'thought');
          item.append(node('div', 'speaker', thought.name || thought.id), node('blockquote', 'quote', quote(thought.thought)));
          body.append(item);
        }
        break;
      case 'dossiers':
        for (const dossier of value) {
          const parts = [node('span', 'name', dossier.name)];
          if (dossier.role) parts.push(node('span', 'mood', dossier.role));
          fields(details(body, parts, false, `dossiers:${dossier.name}`), dossier, ['look', 'voice', 'hook']);
        }
        break;
      case 'planner': {
        if (value.beats?.length) {
          const list = node('ol', 'beats');
          for (const beat of value.beats) {
            const item = node('li');
            line(item, beat.beat, 'beat');
            line(item, beat.why, 'why');
            list.append(item);
          }
          body.append(list);
        }
        if (value.remember) {
          const note = node('div', 'note');
          note.append(node('span', 'key', label('remember')), node('span', '', value.remember));
          body.append(note);
        }
        break;
      }
      case 'banlist': {
        const chips = node('div', 'chips');
        for (const item of value) {
          const chip = node('span', 'tag');
          chip.classList.add('st-sable-ban');
          chip.append(node('span', '', item.pattern));
          if (item.example) chip.append(document.createTextNode(' '), node('span', 'example', quote(item.example)));
          chips.append(chip);
        }
        body.append(chips);
        break;
      }
    }
  }

  const sectionTitle = section => (section.custom ? section.title : label(section.title));
  const cardState = id => {
    const mode = view.modes[id];
    return { mode, folded: mode === 'off' || !!view.settings.folded[id] };
  };
  function buildHeader(section) {
    const { id } = section, { mode, folded } = cardState(id), name = sectionTitle(section);
    const heading = node('div', 'card-header');
    const handle = button('', 'reorder', () => {}, 'handle'); handle.dataset.control = 'handle';
    handle.append(icon('grip-vertical'));
    handle.addEventListener('pointerdown', event => beginDrag(event, { section: id }));
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      // A member moves inside its group only; a flat card steps over whole groups.
      if (containerOf(id)) moveMember(id, event.key === 'ArrowUp' ? -1 : 1); else moveToken(id, event.key === 'ArrowUp' ? -1 : 1);
    });
    const title = node('h3', 'card-title');
    const glyph = sectionGlyph(document, section, view.settings.visual?.icons);
    glyph.classList.add('st-sable-card-icon');
    glyph.setAttribute('aria-hidden', 'true');
    const dot = node('span', 'change-dot'); dot.hidden = true;
    dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', label('changed'));
    title.append(glyph, node('span', 'card-label', name), dot);
    const wrap = modeChip(name, mode, cardTarget(id));
    const fold = button('', 'fold', () => {
      if (folded) freshCards.delete(id);
      runtime.updateSettings({ folded: { ...view.settings.folded, [id]: !folded } });
    }, 'fold');
    fold.append(icon('chevron-down'));
    fold.dataset.control = 'fold'; fold.disabled = mode === 'off'; fold.setAttribute('aria-expanded', String(!folded));
    fold.setAttribute('aria-controls', `st-sable-body-${id}`);
    heading.addEventListener('click', event => {
      if (mode !== 'off' && !event.target.closest('button, .st-sable-mode-wrap')) fold.click();
    });
    heading.append(handle, title, wrap, fold);
    return heading;
  }
  // Card colour from the card (SPEC §28): «Цвет…» opens an inline row with the swatch and «auto» of Appearance → Cards →
  // Card colours. `key` is the card (a section id or person:<id>), `colorId` the cardColors entry it writes.
  const colorRows = new Set();
  let colorRowId = 0;
  function colorControls(key, colorId, name) {
    const open = colorRows.has(key), result = [];
    const toggle = button('', 'card.color', () => {
      if (colorRows.has(key)) colorRows.delete(key); else colorRows.add(key);
      render(view);
    }, 'edit');
    toggle.append(icon('palette'), document.createTextNode(` ${label('card.color')}`));
    toggle.setAttribute('aria-label', `${label('card.colorLabel')}: ${name}`);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.dataset.control = 'color';
    result.push(toggle);
    if (!open) return result;
    const visual = normalizeVisual(view.settings.visual), current = visual.cardColors[colorId];
    const row = node('div', 'color-row'); row.id = `st-sable-color-row-${++colorRowId}`; row.dataset.cardColor = colorId;
    toggle.setAttribute('aria-controls', row.id);
    const write = color => {
      const now = normalizeVisual(runtime.snapshot().settings.visual), colors = { ...now.cardColors };
      if (color) colors[colorId] = color; else delete colors[colorId];
      // saveSettings does not deep-merge visual: the whole object goes back.
      runtime.updateSettings({ visual: normalizeVisual({ ...now, cardColors: colors }) });
    };
    const input = node('input', 'color-input'); input.type = 'color'; input.name = `cardColors.${colorId}`;
    input.value = current ?? visual.accent; input.dataset.control = 'color-input';
    input.setAttribute('aria-label', `${name}: ${label('card.colorLabel')}`);
    input.addEventListener('input', () => { const card = row.closest('.st-sable-card'); if (card) applyCardColor(card, input.value); });
    input.addEventListener('change', () => write(input.value));
    const auto = button(label('visual.auto'), 'visual.auto', () => { if (current) write(null); }, 'color-auto');
    auto.dataset.control = 'color-auto';
    auto.setAttribute('aria-label', `${name}: ${label('visual.auto')}`);
    auto.setAttribute('aria-pressed', String(!current));
    row.append(input, auto);
    result.push(row);
    return result;
  }
  // The pencil lives under the card, not in the header: a fifth header control made long titles wrap on phones.
  function buildFooter(section) {
    const { id } = section, { mode, folded } = cardState(id), name = section.custom ? section.title : label(section.title);
    const footer = node('div', 'card-footer'); footer.hidden = folded || mode === 'off';
    const edit = button('', 'edit', () => toggleEditor(section), 'edit');
    edit.append(icon('pen'), document.createTextNode(` ${label('edit')}`));
    edit.setAttribute('aria-label', `${label('edit')}: ${name}`);
    edit.setAttribute('aria-pressed', String(editors.has(id)));
    edit.dataset.control = 'edit';
    footer.append(edit);
    if (!section.pack) {
      const wrap = node('div', 'mode-wrap'), move = button('', 'folders.move', () => openFolderMenu(id, move, wrap), 'edit');
      move.dataset.control = 'folder'; move.setAttribute('aria-haspopup', 'menu'); move.setAttribute('aria-expanded', 'false');
      move.append(icon('folder-plus'), document.createTextNode(label('folders.move')));
      move.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openFolderMenu(id, move, wrap); } });
      wrap.append(move); footer.append(wrap);
    }
    footer.append(...colorControls(id, id, name));
    return footer;
  }
  function buildCard(section) {
    const { id } = section, { mode, folded } = cardState(id);
    const card = node('section', 'card'); card.dataset.section = id; card.dataset.mode = mode;
    applyCardColor(card, view.settings.visual?.cardColors?.[id]);
    card.classList.toggle('st-sable-off', mode === 'off');
    const body = node('div', 'card-body'); body.id = `st-sable-body-${id}`; body.hidden = folded;
    const editor = editors.get(id);
    if (editor) { body.append(editor.element); editor.card = card; }
    else if (mode !== 'off') renderBody(section, body, view.entry?.state ?? {});
    if (!body.childNodes.length) body.append(node('span', 'empty', '—'));
    card.append(buildHeader(section), body, buildFooter(section));
    return card;
  }
  /** A card that survives the render: header and footer follow the view, the body is refilled in place. Returns
   *  whether a keyed value changed. */
  function updateCard(card, section) {
    refreshCard(card, section);
    const body = card.querySelector('.st-sable-card-body');
    if (cardState(section.id).mode === 'off') { body.replaceChildren(node('span', 'empty', '—')); return false; }
    return renderBody(section, body, view.entry?.state ?? {});
  }
  function refreshCard(card, section) {
    const { mode, folded } = cardState(section.id);
    card.dataset.mode = mode;
    applyCardColor(card, view.settings.visual?.cardColors?.[section.id]);
    card.classList.toggle('st-sable-off', mode === 'off');
    card.firstElementChild.replaceWith(buildHeader(section));
    card.querySelector('.st-sable-card-body').hidden = folded;
    card.querySelector('.st-sable-card-footer')?.replaceWith(buildFooter(section));
  }
  // Pack groups (SPEC §15): one container per enabled pack, keyed by pack id and kept across renders; its header is
  // rebuilt like a card header (handle, glyph + title, aggregate mode chip, fold) and its body holds the member cards.
  function groupState(pack) {
    const modes = new Set(pack.members.map(id => view.modes[id]));
    return { mode: modes.size === 1 ? [...modes][0] : null, folded: !!view.settings.folded[pack.key] };
  }
  function buildGroupHeader(pack) {
    const { mode, folded } = groupState(pack), { title: text, adult, key } = pack;
    const heading = node('div', 'card-header'); heading.classList.add('st-sable-group-header');
    const handle = button('', 'reorder', () => {}, 'handle'); handle.dataset.control = 'handle';
    handle.append(icon('grip-vertical'));
    handle.addEventListener('pointerdown', event => beginDrag(event, { container: pack.key }));
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      moveToken(key, event.key === 'ArrowUp' ? -1 : 1);
    });
    handle.disabled = !pack.members.length;
    const title = node('h3', 'card-title'); title.classList.add('st-sable-group-title');
    const glyph = pack.glyph(); glyph.classList.add('st-sable-card-icon');
    title.append(glyph, node('span', 'card-label', text));
    if (adult) title.append(node('span', 'adult', label('packs.adult')));
    const wrap = modeChip(text, mode, groupTarget(pack));
    const fold = button('', pack.kind === 'pack' ? 'packs.fold' : 'folders.fold', () => runtime.updateSettings({ folded: { ...view.settings.folded, [key]: !folded } }), 'fold');
    fold.append(icon('chevron-down'));
    fold.dataset.control = 'fold'; fold.setAttribute('aria-expanded', String(!folded));
    fold.setAttribute('aria-controls', `st-sable-group-body-${pack.id}`);
    heading.addEventListener('click', event => { if (!event.target.closest('button, .st-sable-mode-wrap')) fold.click(); });
    heading.append(handle, title, wrap, fold);
    return heading;
  }
  function buildGroup(pack) {
    const group = node('section', 'group'); group.dataset[pack.kind] = pack.id; group.dataset.container = pack.key;
    const body = node('div', 'group-body'); body.id = `st-sable-group-body-${pack.id}`;
    group.append(buildGroupHeader(pack), body);
    return group;
  }
  function refreshGroup(group, pack) {
    const { mode, folded } = groupState(pack);
    group.dataset.mode = mode ?? 'mixed';
    group.classList.toggle('st-sable-off', mode === 'off');
    group.setAttribute('aria-label', `${label(pack.kind === 'pack' ? 'packs.group' : 'folders.group')}: ${pack.title}`);
    group.firstElementChild.replaceWith(buildGroupHeader(pack));
    group.lastElementChild.hidden = folded;
  }
  // People layout (SPEC §21): one person card per NPC, present first, then bonds and dossiers that match no NPC.
  function people(state) {
    const list = key => (Array.isArray(state[key]) ? state[key] : []), lower = text => String(text ?? '').trim().toLowerCase();
    const dossiers = [...list('dossiers')], bonds = list('bonds'), result = [], seen = new Set();
    for (const npc of [...list('npcs')].sort((a, b) => Number(!!b.present) - Number(!!a.present))) {
      if (!npc?.id || seen.has(npc.id)) continue;
      seen.add(npc.id);
      const index = dossiers.findIndex(item => (item?.id && item.id === npc.id)
        || (lower(item?.name) && [lower(npc.name), lower(npc.id)].includes(lower(item.name))));
      result.push({ id: npc.id, name: npc.name || npc.id, npc, thought: list('thoughts').find(item => item?.id === npc.id),
        bonds: bonds.filter(bond => bond?.id === npc.id), dossier: index < 0 ? undefined : dossiers.splice(index, 1)[0] });
    }
    if (view.modes.bonds !== 'off') for (const bond of bonds) if (bond?.id && !seen.has(bond.id)) {
      seen.add(bond.id); result.push({ id: bond.id, name: bond.name || bond.id, bonds: bonds.filter(item => item?.id === bond.id) });
    }
    if (view.modes.dossiers !== 'off') for (const dossier of dossiers) if (dossier?.name) {
      result.push({ id: unique(seen, dossier.name), name: dossier.name, bonds: [], dossier });
    }
    return result;
  }
  let personBody = 0;
  function buildPersonCard(person) {
    const card = node('section', 'card'); card.classList.add('st-sable-person'); card.dataset.person = person.id;
    const body = node('div', 'card-body'); body.id = `st-sable-person-body-${++personBody}`;
    card.append(node('div', 'card-header'), body, node('div', 'card-footer'));
    return card;
  }
  /** Header and footer follow the view; the body keeps its bond part, so bars slide. Returns whether a bond value changed. */
  function updatePersonCard(card, person) {
    const { npc } = person, key = `person:${person.id}`, on = id => view.modes[id] !== 'off';
    const folded = view.settings.folded[key] ?? !npc?.present;
    applyCardColor(card, view.settings.visual?.cardColors?.npcs);
    card.classList.toggle('st-sable-present', !!npc?.present);
    const [, body, footer] = card.children;
    const heading = node('div', 'card-header'); heading.classList.add('st-sable-person-header');
    const title = node('h3', 'card-title');
    if (npc) {
      const presence = node('span', 'presence'); presence.setAttribute('role', 'img');
      presence.setAttribute('aria-label', label(npc.present ? 'here' : 'away')); title.append(presence);
    }
    const dot = node('span', 'change-dot'); dot.hidden = true;
    dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', label('changed'));
    title.append(node('span', 'card-label', person.name));
    if (npc && !npc.present) title.append(node('span', 'pill', label('away')));
    title.append(dot);
    heading.append(title);
    if (npc && on('npcs')) heading.append(node('span', 'mood', npc.mood || '—'));
    const fold = button('', 'fold', () => {
      if (folded) freshCards.delete(key);
      runtime.updateSettings({ folded: { ...view.settings.folded, [key]: !folded } });
    }, 'fold');
    fold.append(icon('chevron-down'));
    fold.dataset.control = 'fold'; fold.setAttribute('aria-expanded', String(!folded)); fold.setAttribute('aria-controls', body.id);
    heading.addEventListener('click', event => { if (!event.target.closest('button')) fold.click(); });
    heading.append(fold);
    card.firstElementChild.replaceWith(heading);
    body.hidden = footer.hidden = folded;
    const npcs = sections().find(section => section.id === 'npcs');
    footer.replaceChildren(muted(label('people.hint')), ...colorControls(key, 'npcs', npcs ? sectionTitle(npcs) : person.name));
    const parts = [], part = name => { const element = node('div', 'person-part'); element.dataset.part = name; return element; };
    if (npc && on('npcs')) {
      const element = part('npcs');
      fields(element, npc, ['agenda', 'outfit', 'position', 'action', 'wants_toward', ...(view.settings.spoilers ? [] : ['secret', 'truth'])]);
      if (view.settings.spoilers && (npc.secret || npc.truth)) spoiler(element, npc);
      if (element.childNodes.length) parts.push(element);
    }
    if (npc?.present && person.thought?.thought && on('thoughts')) {
      const element = part('thoughts'), thought = node('div', 'thought');
      thought.append(node('blockquote', 'quote', quote(person.thought.thought))); element.append(thought); parts.push(element);
    }
    let changed = false;
    if (person.bonds.length && on('bonds')) {
      const element = body.querySelector(':scope > [data-part="bonds"]') ?? part('bonds');
      changed = renderBonds(element, person.bonds, 'person', false);
      parts.push(element);
    }
    if (person.dossier && on('dossiers')) {
      const element = part('dossiers');
      fields(element, person.dossier, ['role', 'look', 'voice', 'hook']);
      if (element.childNodes.length) parts.push(element);
    }
    for (const child of [...body.children]) if (!parts.includes(child)) dropRow(child);
    let previous = null;
    for (const element of parts) { place(body, element, previous); previous = element; }
    if (!parts.length) body.append(node('span', 'empty', '—'));
    return changed;
  }

  /** Rebuild one card only (editor open/close); the other cards are untouched. */
  function rebuildCard(id) {
    closeModeMenu();
    const section = sections().find(item => item.id === id);
    const old = cards.querySelector(`.st-sable-card[data-section="${id}"]`);
    if (!section || !old) return;
    const role = old.contains(document.activeElement) ? document.activeElement.dataset.control : undefined;
    for (const item of old.querySelectorAll('details[data-key]')) openRows.set(item.dataset.key, item.open);
    const card = buildCard(section);
    old.replaceWith(card);
    if (role) card.querySelector(`[data-control="${role}"]`)?.focus();
  }

  const folderEditors = new Map();
  function openFolderMenu(id, chip, wrap) {
    const folders = view.settings.folders, current = folders.find(folder => folder.members.includes(id))?.id;
    const entries = folders.map(folder => ({ value: folder.id, text: folder.title,
      disabled: folder.members.length >= 20 && folder.id !== current }));
    if (current) entries.push({ value: 'none', text: label('folders.none') });
    entries.push({ value: 'new', text: label('folders.new'), disabled: folders.length >= 12 });
    openModeMenu(chip, wrap, { current, gone: () => !cards.querySelector(`[data-section="${id}"]`), apply: value => {
      if (value !== 'new') { runtime.updateSettings(moveToFolder(view.settings, id, value === 'none' ? null : value)); return; }
      const folder = { id: newCustomId(new Set(folders.map(item => item.id)), win.crypto, 'f_'),
        title: `${label('folders.default')} ${folders.length + 1}`, icon: '', members: [] };
      folderEditors.set(folder.id, createFolderEditor(folder));
      runtime.updateSettings(moveToFolder({ ...view.settings, folders: [...folders, folder] }, id, folder.id));
      folderEditors.get(folder.id)?.querySelector('input')?.focus();
    } }, entries);
  }
  function folderFooter(folder) {
    const footer = node('div', 'card-footer');
    const edit = button('', 'folders.edit', () => {
      if (folderEditors.has(folder.id)) folderEditors.delete(folder.id);
      else folderEditors.set(folder.id, createFolderEditor(folder));
      render(view);
      folderEditors.get(folder.id)?.querySelector('input')?.focus();
    }, 'edit');
    edit.dataset.control = 'folder-edit'; edit.setAttribute('aria-pressed', String(folderEditors.has(folder.id)));
    edit.append(icon('pen'), document.createTextNode(label('folders.edit'))); footer.append(edit); return footer;
  }
  function createFolderEditor(folder) {
    const form = node('form', 'editor'); form.dataset.folderEditor = folder.id;
    const title = node('input', 'input'), glyph = node('input', 'input');
    title.type = glyph.type = 'text'; title.name = 'title'; glyph.name = 'icon';
    title.maxLength = 40; title.required = true; title.value = folder.title; glyph.value = folder.icon ?? '';
    glyph.title = label('custom.iconHint');
    for (const [input, key] of [[title, 'custom.title'], [glyph, 'custom.icon']]) {
      const row = node('label', 'editor-field'); row.append(node('span', 'editor-label', label(key)), input); form.append(row);
    }
    form.append(node('p', 'editor-note', label('custom.iconHint')));
    const actions = node('div', 'editor-actions');
    const save = button(label('edit.save'), 'edit.save', () => {
      if (!title.value.trim()) { title.focus(); return; }
      folderEditors.delete(folder.id);
      runtime.updateSettings({ folders: view.settings.folders.map(item => item.id === folder.id
        ? { ...item, title: title.value, icon: glyph.value } : item) });
    }, 'editor-save');
    form.addEventListener('submit', event => { event.preventDefault(); save.click(); });
    const cancel = button(label('edit.cancel'), 'edit.cancel', () => { folderEditors.delete(folder.id); render(view); }, 'editor-cancel');
    // One tap (SPEC §24): the undo pill brings the folder, its place in `order` and its fold state back.
    const remove = button(label('folders.delete'), 'folders.delete', () => {
      const previous = structuredClone({ folders: view.settings.folders, order: view.settings.order }), key = `folder:${folder.id}`;
      const wasFolded = view.settings.folded[key], name = view.settings.folders.find(item => item.id === folder.id)?.title ?? folder.title;
      folderEditors.delete(folder.id);
      runtime.updateSettings({ folders: view.settings.folders.filter(item => item.id !== folder.id) });
      undo.show(label('undo.deleted').replace('{name}', name), () => runtime.updateSettings({ ...previous,
        ...(wasFolded === undefined ? {} : { folded: { ...view.settings.folded, [key]: wasFolded } }) }));
    }, 'editor-remove');
    remove.dataset.control = 'folder-delete';
    actions.append(save, cancel, remove); form.append(actions); return form;
  }

  // Manual editing: schema-driven fields, so built-in and custom sections share one editor.
  const editors = new Map();
  function fieldLabel(key) {
    for (const candidate of [`field.${key}`, key]) if (label(candidate) !== candidate) return label(candidate);
    return view.settings.bondScales?.custom?.find(scale => scale.key === key)?.title ?? key;
  }
  const blank = value => value === undefined
    || (value !== null && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
  const copy = value => (value === undefined ? undefined : structuredClone(value));
  function fieldEditor(schema, value, key) {
    switch (schema?.type) {
      case 'string': {
        const input = node(schema.max >= 240 ? 'textarea' : 'input', 'input');
        if (input.tagName === 'TEXTAREA') input.rows = 2; else input.type = 'text';
        input.maxLength = schema.max; input.value = typeof value === 'string' ? value : '';
        return { element: input, read: () => input.value.trim() || undefined };
      }
      case 'integer': case 'score': {
        const input = node('input', 'input'); input.type = 'number'; input.step = '1'; input.inputMode = 'numeric';
        const [min, max] = schema.type === 'score' ? [0, 100] : [schema.min, schema.max];
        if (min !== undefined) input.min = String(min);
        if (max !== undefined) input.max = String(max);
        input.value = Number.isFinite(value) ? String(value) : '';
        const empty = schema.type === 'score' ? null : undefined;
        const read = () => {
          const number = Number(input.value);
          if (input.value.trim() === '' || !Number.isFinite(number)) return empty;
          return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(number)));
        };
        input.addEventListener('change', () => { const clamped = read(); input.value = clamped ?? ''; });
        return { element: input, read };
      }
      case 'enum': {
        const select = node('select', 'input');
        for (const option of schema.values) {
          const item = node('option', '', label(`${key}.${option}`) === `${key}.${option}` ? option : label(`${key}.${option}`));
          item.value = option; select.append(item);
        }
        select.value = schema.values.includes(value) ? value : schema.fallback;
        return { element: select, read: () => select.value };
      }
      case 'boolean': {
        const input = node('input', 'check'); input.type = 'checkbox'; input.checked = value === true;
        return { element: input, read: () => input.checked, inline: true };
      }
      case 'changes': {
        const text = Object.entries(value ?? {}).map(([scale, change]) =>
          `${label(scale)} ${change.delta > 0 ? '+' : '−'}${Math.abs(change.delta)}${change.reason ? ` (${change.reason})` : ''}`).join(' · ');
        const element = node('div', 'editor-readonly', text || '—');
        element.title = label('edit.recomputed');
        return { element, read: () => copy(value) };
      }
      case 'object': {
        if (schema.allowUnknown) return { element: null, read: () => copy(value) };
        const box = node('div', 'editor-object'), parts = [];
        const entries = Object.entries(schema.fields ?? {});
        if (entries.every(([, child]) => ['score', 'integer'].includes(child.type))) box.classList.add('st-sable-editor-grid');
        for (const [name, child] of entries) {
          if (name === 'id' && schema.fields.name) {
            // Stable ids link NPCs, thoughts and bonds: read-only; new rows derive theirs from the name.
            if (value?.id) box.append(node('div', 'editor-id', `id: ${value.id}`));
            parts.push([name, { read: () => value?.id }]);
            continue;
          }
          const editor = fieldEditor(child, value?.[name], name);
          if (editor.element) box.append(fieldRow(name, editor));
          parts.push([name, editor]);
        }
        return { element: box, read: () => {
          const result = {};
          for (const [name, editor] of parts) { const item = editor.read(); if (item !== undefined) result[name] = item; }
          return result;
        } };
      }
      case 'array': {
        const box = node('div', 'editor-array'), list = node('div', 'editor-items'), items = [];
        const add = button('', 'edit.add', () => addItem(undefined, true), 'editor-add');
        add.append(icon('plus'), node('span', '', label('edit.add')));
        const sync = () => { add.disabled = items.length >= (schema.max ?? Infinity); };
        function addItem(item, focus) {
          const editor = fieldEditor(schema.item, item, key), row = node('div', 'editor-item');
          const remove = button('', 'edit.remove', () => { row.remove(); items.splice(items.indexOf(editor), 1); sync(); }, 'editor-remove');
          remove.append(icon('xmark'));
          row.append(editor.element ?? node('span'), remove);
          items.push(editor); list.append(row); sync();
          if (focus) row.querySelector('input, textarea, select')?.focus();
        }
        for (const item of Array.isArray(value) ? value : []) addItem(item);
        box.append(list, add);
        return { element: box, read: () => items.map(editor => editor.read()).filter(item => !blank(item)) };
      }
      default: return { element: null, read: () => copy(value) };
    }
  }
  function fieldRow(name, editor) {
    const single = ['INPUT', 'TEXTAREA', 'SELECT'].includes(editor.element.tagName);
    const row = node(single ? 'label' : 'div', editor.inline ? 'editor-check' : 'editor-field');
    const caption = node('span', 'editor-label', fieldLabel(name));
    if (editor.inline) row.append(editor.element, caption); else row.append(caption, editor.element);
    return row;
  }
  function createEditor(section) {
    const original = view.entry?.state?.[section.id];
    const root = fieldEditor(section.schema, copy(original), section.id);
    const element = node('div', 'editor'); element.dataset.editor = section.id;
    const warning = node('p', 'editor-note', label('edit.changed')); warning.hidden = true;
    const error = node('p', 'editor-note', label('edit.failed')); error.classList.add('st-sable-editor-error'); error.hidden = true;
    const actions = node('div', 'editor-actions');
    actions.append(button(label('edit.save'), 'edit.save', () => saveEditor(section.id), 'editor-save'),
      button(label('edit.cancel'), 'edit.cancel', () => { editors.delete(section.id); rebuildCard(section.id); }, 'editor-cancel'));
    element.append(warning, root.element ?? node('span'), error, actions);
    const empty = { string: '', array: [] }[section.schema.type] ?? {};
    return { element, warning, error, base: JSON.stringify(original ?? null), read: () => root.read() ?? empty };
  }
  function saveEditor(id) {
    const editor = editors.get(id);
    const section = sections().find(item => item.id === id);
    if (!editor || !section) return;
    // Same schema as model output: rows missing required fields drop, strings trim, numbers clamp.
    const value = sanitizeSection(section, editor.read());
    // Removed first: a successful save publishes, and that render must rebuild the card from the new state.
    editors.delete(id);
    if (value === undefined || runtime.editState(id, value) === false) { editors.set(id, editor); editor.error.hidden = false; }
  }
  function toggleEditor(section) {
    const { id } = section;
    if (editors.has(id)) { editors.delete(id); rebuildCard(id); return; }
    editors.set(id, createEditor(section));
    if (view.settings.folded[id]) runtime.updateSettings({ folded: { ...view.settings.folded, [id]: false } });
    else rebuildCard(id);
  }

  function render(next) {
    // A render closes the menu; a typed period is written after this render, not in the middle of it.
    const pending = modeMenu?.commit;
    if (modeMenu) modeMenu.commit = undefined;
    closeModeMenu();
    // Notifications are the only source of state renders after initial mounting; a render ends any drag.
    stopDrag();
    const focused = document.activeElement;
    const focusId = focused?.closest('[data-section]')?.dataset.section;
    const focusPack = focused?.closest('.st-sable-group')?.dataset.container;
    const focusPerson = focused?.closest('[data-person]')?.dataset.person;
    const focusRole = focused?.dataset.control;
    const previousStore = view.store;
    view = next;
    const entryKey = JSON.stringify([view.entry?.mesId, view.entry?.swipeId, view.entry?.turn,
      view.entry?.state?.meta?.updatedAt, view.entry?.state?.meta?.editedAt]);
    // Metadata belongs to a chat; identical entry timestamps in another chat must conceal spoilers too.
    if (entryKey !== lastEntryKey || view.store !== previousStore || !view.entry) revealed.clear();
    containerList = describeContainers();
    drawer.lang = view.settings.language;
    banner.hidden = !view.canSeedLegacy || !!view.legacyBannerHidden;
    banner.setAttribute('aria-label', label('legacy.banner'));
    bannerText.textContent = label('legacy.banner');
    for (const [element, key] of [[seed, 'legacy.import'], [bannerHide, 'legacy.hide']]) {
      element.textContent = label(key); element.title = label(key); element.setAttribute('aria-label', label(key));
    }
    for (const [element, key] of [[refresh, 'refresh'], [pin, 'pin'], [settings, 'settings'], [packs, 'packs.open'], [close, 'close']]) {
      element.title = label(key); element.setAttribute('aria-label', label(key));
    }
    pin.setAttribute('aria-pressed', String(view.settings.pinned));
    packs.replaceChildren(view.settings.visual?.icons === 'emoji' ? node('span', 'emoji', '🎒') : icon('box-open'));
    renderSheet();
    tab.hidden = !view.settings.showFloatingButton;
    // The tab needs the same width variable to sit on the open panel's edge.
    applyVisual(drawer, view.settings.visual);
    applyVisual(tab, view.settings.visual);
    syncExpanded();
    openRows = new Map([...cards.querySelectorAll('details[data-key]')].map(item => [item.dataset.key, item.open]));
    const scrollTop = cards.scrollTop;
    const list = sections(), packIds = enabled(), ordered = [], allCards = [], changedCards = new Set();
    // Cards persist across renders (SPEC §16): keyed rows keep their nodes, so bars slide instead of jumping. Pack groups
    // (SPEC §15) persist too, keyed by pack id; a hidden member stays out of its group, an empty group leaves the list.
    const existing = new Map([...cards.querySelectorAll('.st-sable-card[data-section]')].map(card => [card.dataset.section, card]));
    const persons = new Map([...cards.querySelectorAll('.st-sable-card[data-person]')].map(card => [card.dataset.person, card]));
    const personCards = [];
    const groups = new Map([...cards.children].filter(child => child.classList.contains('st-sable-group')).map(group => [group.dataset.container, group]));
    const members = new Map();
    for (const id of groupedOrder(view.settings.order, list, packIds, view.settings.folders)) {
      const section = list.find(item => item.id === id), editor = editors.get(id);
      if (editor && view.modes[id] === 'off') editors.delete(id);
      if (peopleOn() && PEOPLE.includes(id)) {
        // The People group (SPEC §21) sits at the first of the four; it hides like a group whose members are all off.
        const pack = containers().find(group => group.key === 'people');
        if (members.has(pack.key) || (view.settings.hideOff && !revealOff && groupState(pack).mode === 'off')) continue;
        const group = groups.get(pack.key) ?? buildGroup(pack), items = [];
        refreshGroup(group, pack);
        if (groupState(pack).mode !== 'off') for (const person of people(view.entry?.state ?? {})) {
          const card = persons.get(person.id) ?? buildPersonCard(person);
          persons.delete(person.id);
          if (updatePersonCard(card, person)) changedCards.add(`person:${person.id}`);
          items.push(card); personCards.push(card);
        }
        if (!items.length) items.push(node('span', 'empty', '—'));
        members.set(pack.key, { group, pack, items }); ordered.push(group);
        continue;
      }
      if (view.settings.hideOff && !revealOff && view.modes[id] === 'off') continue;
      let card;
      if (editors.has(id) && editor.card?.isConnected) {
        // An open editor keeps its node, draft and focus; only its header follows the new view.
        refreshCard(editor.card, section);
        editor.warning.hidden = JSON.stringify(view.entry?.state?.[id] ?? null) === editor.base;
        card = editor.card;
      } else if (existing.has(id) && !editors.has(id)) {
        card = existing.get(id);
        if (updateCard(card, section)) changedCards.add(id);
      } else card = buildCard(section);
      allCards.push(card);
      const pack = containerOf(id);
      if (!pack) { ordered.push(card); continue; }
      if (!members.has(pack.key)) {
        const group = groups.get(pack.key) ?? buildGroup(pack);
        refreshGroup(group, pack);
        members.set(pack.key, { group, pack, items: [] }); ordered.push(group);
      }
      members.get(pack.key).items.push(card);
    }
    for (const pack of containers().filter(group => group.kind === 'folder' && !group.members.length)) {
      const group = groups.get(pack.key) ?? buildGroup(pack); refreshGroup(group, pack);
      members.set(pack.key, { group, pack, items: [node('p', 'folder-empty', label('folders.empty'))] }); ordered.push(group);
    }
    for (const [id] of folderEditors) if (!view.settings.folders.some(folder => folder.id === id)) folderEditors.delete(id);
    for (const { pack, items } of members.values()) if (pack.kind === 'folder') {
      const editor = folderEditors.get(pack.id); if (editor) items.unshift(editor);
      items.push(folderFooter(pack));
    }

    const settle = (parent, items) => {
      for (const child of [...parent.children]) if (!items.includes(child)) dropRow(child);
      let cursor = parent.firstElementChild;
      for (const item of items) {
        if (item === cursor) cursor = cursor.nextElementSibling;
        else parent.insertBefore(item, cursor);
      }
    };
    settle(cards, ordered);
    for (const { group, items } of members.values()) settle(group.lastElementChild, items);
    cards.scrollTop = scrollTop;
    // Change flags (SPEC §16): the card flash lasts this render; the title dot stays until the card is unfolded or the
    // next run (a new ring entry, an edit, or any changed value) recomputes the set.
    if (changedCards.size || entryKey !== lastEntryKey) { freshCards = changedCards; lastEntryKey = entryKey; }
    for (const card of allCards) {
      const id = card.dataset.section;
      card.toggleAttribute('data-st-sable-changed', changedCards.has(id));
      card.toggleAttribute('data-st-sable-crit', !!rolled?.crit && rolled.id === id && Date.now() - rolled.at < DICE_MS);
      const dot = card.querySelector('.st-sable-card-title > .st-sable-change-dot');
      if (dot) dot.hidden = !freshCards.has(id);
    }
    for (const card of personCards) {
      const key = `person:${card.dataset.person}`;
      card.toggleAttribute('data-st-sable-changed', changedCards.has(key));
      card.querySelector('.st-sable-card-title > .st-sable-change-dot').hidden = !freshCards.has(key);
    }
    const offCount = list.filter(section => view.modes[section.id] === 'off').length;
    hiddenRow.hidden = !view.settings.hideOff || offCount === 0;
    const hiddenLabel = revealOff ? label('hideSections') : `${label('hiddenSections')}: ${offCount}`;
    hiddenToggle.textContent = hiddenLabel;
    hiddenToggle.title = hiddenLabel;
    hiddenToggle.setAttribute('aria-label', hiddenLabel);
    hiddenToggle.setAttribute('aria-expanded', String(revealOff));
    refresh.setAttribute('aria-busy', String(!!view.running));
    refresh.firstElementChild.classList.toggle('fa-spin', !!view.running && drawer.dataset.stSableEffects !== 'off');
    // Cards drawn from a reply that was edited afterwards are dimmed until a recompute (SPEC §27).
    for (const card of [...allCards, ...personCards]) card.classList.toggle('st-sable-stale', !!view.entry?.stale);
    // No usable profile: the refresh control cannot run and says why (SPEC §27).
    refresh.disabled = !!view.profileIssue;
    if (view.profileIssue) { refresh.title = label('noProfile'); refresh.setAttribute('aria-label', label('noProfile')); }
    renderHint();
    renderStatus();
    if (focusId && focusRole) cards.querySelector(`[data-section="${focusId}"] [data-control="${focusRole}"]`)?.focus();
    else if (focusPerson !== undefined && focusRole) [...cards.querySelectorAll('[data-person]')].find(card => card.dataset.person === focusPerson)
      ?.querySelector(`[data-control="${focusRole}"]`)?.focus();
    else if (focusPack && focusRole) groupNode(focusPack)?.querySelector(`[data-control="${focusRole}"]`)?.focus();
    pending?.();
  }

  function renderStatus() {
    const last = view.store.lastRun;
    const at = last?.at ?? (last?.ok ? view.entry?.state.meta?.updatedAt : undefined);
    const date = at ? new Date(at) : null;
    const time = date && Number.isFinite(date.getTime())
      ? date.toLocaleTimeString(view.settings.language, { hour: '2-digit', minute: '2-digit' }) : '—';
    status.replaceChildren();
    if (view.running) {
      const dot = node('span', 'status-dot');
      dot.classList.add('st-sable-busy');
      status.append(dot, node('span', 'status-text', label('running')));
    } else if (last) {
      const dot = node('span', 'status-dot');
      dot.classList.add(last.ok ? 'st-sable-ok' : 'st-sable-fail');
      status.append(dot, node('span', 'status-text',
        last.skipped ? `${time} · ${label('ok')} · ${label('skipped')}`
          : `${time} · ${label(last.ok ? 'ok' : 'error')} · ${last.ms ?? '—'} ${label('duration')} · ~${last.inTok ?? '—'} / ~${last.outTok ?? '—'} ${label('tokens')}`));
      if (last.error) status.append(node('span', 'status-error', last.error));
    } else status.append(node('span', 'status-text', label('noRun')));
    // Permanent setup path while no chat-completion profile is usable (SPEC §27), on top of the run warnings.
    if (view.profileIssue) {
      const setup = button(label('noProfile'), 'noProfile', () => openSettings('connection'), 'status-setup');
      setup.dataset.control = 'setup';
      status.append(setup);
    }
    // Edited latest reply (SPEC §27): the state is stale until the edit run recomputes it.
    if (view.entry?.stale) {
      const stale = node('span', 'status-stale', label('staleState'));
      const recompute = button(label('recompute'), 'recompute', () => { void runtime.run(view.entry.mesId, { type: 'edit' }); }, 'recompute');
      recompute.dataset.control = 'recompute';
      recompute.disabled = !!view.running || !!view.profileIssue;
      stale.append(recompute);
      status.append(stale);
    }
    if (rollNote) status.append(node('span', 'roll-note', rollNote));
    // Enabled packs as small chips, so the cost of the chat is visible at a glance.
    const enabled = (view.packs?.available ?? []).filter(pack => view.packs.enabled.includes(pack.id));
    if (enabled.length) {
      const chips = node('span', 'status-packs');
      chips.setAttribute('aria-label', label('packs.enabled'));
      for (const pack of enabled) {
        const chip = node('span', 'pack-chip');
        chip.append(packGlyph(pack), node('span', '', packTitle(pack.title).text));
        chips.append(chip);
      }
      status.append(chips);
    }
  }

  /** target: { section } for a card or { container } for a whole group. */
  function beginDrag(event, target) {
    if (event.currentTarget.disabled || event.button !== 0 || drag) return;
    event.preventDefault();
    drag = { ...target, handle: event.currentTarget, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, detached: false, drop: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  const dragged = () => (drag.container ? groupNode(drag.container) : cards.querySelector(`.st-sable-card[data-section="${drag.section}"]`));
  // Section ids in list order: top-level cards, groups expanded to their members; the People group (SPEC §21) holds
  // person cards, not section cards, so it stands for its four sections.
  const shownIds = () => [...cards.children].flatMap(child => (child.dataset.container === 'people'
    ? containers().find(group => group.key === 'people')?.members ?? []
    : child.classList.contains('st-sable-group')
      ? [...child.lastElementChild.children].map(card => card.dataset.section).filter(Boolean) : [child.dataset.section]));

  // Drag between containers (SPEC §24). A flat card or a folder member stays bounded by its parent (plain sorting) until
  // it detaches: a member when the pointer leaves its folder's box by more than DETACH_PX, a flat card when the pointer
  // is that deep inside a group (anywhere on a folded or empty one). Detached, the card stays where it is, lifted; one
  // slot shows where it would land, packs and the People group dim, and the drop is one planDrop write with an undo.
  const DETACH_PX = 24, SCROLL_BAND = 48, SCROLL_STEP = 12, CANCEL_LEFT = 40;
  let slot, scrollFrame;
  const box = element => element.getBoundingClientRect();
  const within = (rect, y, pad = 0) => y >= rect.top - pad && y <= rect.bottom + pad;
  const topGroups = () => [...cards.children].filter(child => child.classList.contains('st-sable-group'));
  const emptyHint = group => group.lastElementChild.querySelector(':scope > .st-sable-folder-empty');
  const homeGroup = () => { const home = containerOf(drag.section); return home?.kind === 'folder' ? groupNode(home.key) : null; };
  const detachable = () => !!drag.section && !['pack', 'people'].includes(containerOf(drag.section)?.kind);
  // The section a top-level block starts with, not counting the dragged card (it may be leaving that very folder).
  const firstId = element => element.dataset.section
    ?? grouped().find(id => id !== drag.section && containerOf(id)?.key === element.dataset.container) ?? null;
  function shouldDetach(y) {
    const home = homeGroup();
    if (home) return drag.detached ? !within(box(home), y) : !within(box(home), y, DETACH_PX);
    const group = topGroups().find(item => within(box(item), y));
    if (!group || drag.detached) return !!group;
    const rect = box(group);
    return group.lastElementChild.hidden || !!emptyHint(group) || (y > rect.top + DETACH_PX && y < rect.bottom - DETACH_PX);
  }
  /** Where a detached card would land: { folderId, anchor, parent, before } for a slot, { group, full } or { blocked }. */
  function dropTarget(y) {
    const card = dragged(), group = topGroups().find(item => within(box(item), y));
    if (!group) {
      // A top-level gap: «без группы» before the block under the slot; empty folders always render last.
      const items = [...cards.children].filter(child => child !== slot && child !== card && !(child.classList.contains('st-sable-group') && emptyHint(child)));
      const index = slotFor(items.map(box), y), next = items[index];
      return { folderId: null, anchor: items.slice(index).map(firstId).find(Boolean) ?? null, parent: cards,
        before: next ?? topGroups().find(item => emptyHint(item)) ?? null };
    }
    const pack = containers().find(item => item.key === group.dataset.container);
    if (pack?.kind !== 'folder') return { blocked: true };
    const folder = view.settings.folders.find(item => item.id === pack.id);
    if (folder.members.length >= 20 && !folder.members.includes(drag.section)) return { group, full: true };
    const body = group.lastElementChild, hint = emptyHint(group);
    if (hint) return { folderId: pack.id, anchor: null, parent: body, before: hint, hint };
    // A folded folder accepts on its header and does not unfold.
    if (body.hidden) return { folderId: pack.id, anchor: null, parent: group, before: body };
    const footer = body.querySelector(':scope > .st-sable-card-footer');
    const items = [...body.children].filter(child => child !== card && child.matches('.st-sable-card[data-section]'));
    const next = within(box(group.firstElementChild), y) ? undefined : items[slotFor(items.map(box), y)];
    return { folderId: pack.id, anchor: next?.dataset.section ?? null, parent: body, before: next ?? footer };
  }
  function clearMarks() {
    slot?.remove();
    for (const element of cards.querySelectorAll('.st-sable-full')) element.classList.remove('st-sable-full');
    for (const element of cards.querySelectorAll('.st-sable-full-badge')) element.remove();
    for (const element of cards.querySelectorAll('.st-sable-folder-empty[hidden]')) element.hidden = false;
  }
  function showTarget(target) {
    clearMarks();
    drag.drop = null;
    if (target.full) {
      const heading = target.group.firstElementChild;
      heading.classList.add('st-sable-full');
      heading.querySelector('.st-sable-card-title')?.append(node('span', 'full-badge', label('drag.full')));
    }
    if (!target.parent) return;
    slot ??= node('div', 'slot');
    slot.textContent = label('drag.here');
    if (target.hint) target.hint.hidden = true;
    target.parent.insertBefore(slot, target.before);
    drag.drop = { folderId: target.folderId, anchor: target.anchor };
  }
  function setDetached(on) {
    drag.detached = on;
    for (const element of cards.querySelectorAll('[data-pack], [data-container="people"], .st-sable-person')) element.classList.toggle('st-sable-dim', on);
    if (!on) { clearMarks(); drag.drop = null; }
  }
  // Auto-scroll: within SCROLL_BAND of the list's top or bottom edge, up to SCROLL_STEP px per frame by depth.
  function scrollDepth(y) {
    const rect = box(cards);
    const depth = y < rect.top + SCROLL_BAND ? y - rect.top - SCROLL_BAND : y > rect.bottom - SCROLL_BAND ? y - rect.bottom + SCROLL_BAND : 0;
    return Math.max(-1, Math.min(1, depth / SCROLL_BAND));
  }
  function autoScroll() {
    scrollFrame = undefined;
    const depth = drag?.moved ? scrollDepth(drag.lastY) : 0;
    if (!depth) return;
    cards.scrollTop += Math.round(SCROLL_STEP * depth) || Math.sign(depth);
    if (drag.detached) showTarget(dropTarget(drag.lastY));
    scrollFrame = win.requestAnimationFrame?.(autoScroll);
  }
  /** Ends a drag without touching the order: marks, lift, dimming and the scroll loop go. */
  function stopDrag() {
    if (scrollFrame !== undefined) win.cancelAnimationFrame?.(scrollFrame);
    scrollFrame = undefined;
    clearMarks(); slot = undefined;
    for (const element of cards.querySelectorAll('.st-sable-dim')) element.classList.remove('st-sable-dim');
    cards.querySelector('.st-sable-dragging')?.classList.remove('st-sable-dragging');
    drag = undefined;
  }
  /** Cancel: the card returns to its place (the saved order re-renders); nothing is written. */
  function cancelDrag() {
    if (!drag) return;
    const card = drag.moved ? dragged() : null;
    stopDrag();
    render(view);
    if (!card?.isConnected || drawer.dataset.stSableEffects === 'off') return;
    card.classList.add('st-sable-return');
    win.setTimeout(() => card.classList.remove('st-sable-return'), 150);
  }
  listen(document, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.moved) return;
    if (event.clientX < box(drawer).left - CANCEL_LEFT) { cancelDrag(); return; }
    drag.moved = true; drag.lastY = event.clientY;
    const card = dragged(), parent = card.parentElement;
    card.classList.add('st-sable-dragging');
    if (scrollFrame === undefined && scrollDepth(event.clientY)) scrollFrame = win.requestAnimationFrame?.(autoScroll);
    if (detachable()) {
      const detach = shouldDetach(event.clientY);
      if (detach !== drag.detached) setDetached(detach);
      if (detach) { showTarget(dropTarget(event.clientY)); return; }
    }
    // Geometry works with pointer capture and touch; no HTML drag/drop API. The parent bounds the move: the list for a
    // flat card or a group, the group body for a member.
    const others = [...parent.children].filter(item => item !== card && (item.dataset.section || (item.dataset.container && !item.querySelector('.st-sable-handle').disabled)));
    const before = others.find(item => { const rect = item.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
    parent.insertBefore(card, before ?? (parent.classList.contains('st-sable-group-body') ? parent.querySelector(':scope > .st-sable-card-footer') : parent.querySelector(':scope > .st-sable-group:has(.st-sable-folder-empty)')));
  });
  listen(document, 'pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const completed = drag;
    if (completed.detached) {
      const { section: id, drop } = completed, settings = view.settings;
      const plan = drop && planDrop(settings, id, { folderId: drop.folderId, index: dropIndex(settings, id, drop.folderId, drop.anchor) });
      if (!plan) { cancelDrag(); return; }
      stopDrag();
      const previous = structuredClone({ folders: settings.folders, order: settings.order });
      if (JSON.stringify(plan) === JSON.stringify(previous)) { render(view); return; }
      const section = sections().find(item => item.id === id);
      const target = settings.folders.find(folder => folder.id === drop.folderId)?.title ?? label('folders.none');
      runtime.updateSettings(plan);
      undo.show(`${section ? sectionTitle(section) : id} → ${target}`, () => runtime.updateSettings(previous));
      return;
    }
    stopDrag();
    if (completed.moved) {
      // Hidden cards keep their slots; the saved order is regrouped so pack blocks stay contiguous.
      const visible = shownIds(), ids = new Set(visible);
      const order = grouped().map(id => (ids.has(id) ? visible.shift() : id));
      runtime.updateSettings({ order: groupedOrder(order, sections(), enabled(), drawerFolders()) });
    }
  });
  listen(document, 'pointercancel', event => { if (drag && (event.pointerId === undefined || event.pointerId === drag.pointerId)) cancelDrag(); });
  // Moving the card in the DOM can drop the capture while the finger is still down; take it back if the pointer is
  // still active, otherwise the drag is lost and cancels. After pointerup the drag is already over.
  listen(document, 'lostpointercapture', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    try { if (drag.handle.isConnected && drag.handle.setPointerCapture) { drag.handle.setPointerCapture(event.pointerId); return; } } catch { /* the pointer is gone */ }
    cancelDrag();
  });
  render(view);
  const unsubscribe = runtime.subscribe(render);
  return { open, close: hide, element: drawer, undo, dispose() { unsubscribe(); stopTicks(); undo.hide(); stopDrag(); win.clearTimeout(rollTimer); cleanups.forEach(fn => fn()); drawer.remove(); tab.remove(); menu.remove(); } };
}
