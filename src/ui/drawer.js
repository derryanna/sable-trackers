import { getSections, orderedSectionIds, BOND_SCALES } from '../sections.js';
import { t } from '../i18n.js';
import { normalizeVisual, VISUAL_DEFAULTS } from '../settings.js';
import { sanitizeSection } from '../parse.js';

export function displayNode(document, view, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = `st-sable-${className}`;
  if (text !== undefined) element.textContent = String(text).replace(/\{\{(user|char)\}\}/g,
    (macro, key) => (key === 'user' ? view.name1 : view.name2) ?? macro);
  return element;
}

// Monochrome Font Awesome glyphs for card titles, like the reference; registry emoji are the fallback.
export const SECTION_ICONS = Object.freeze({
  world: 'globe', offscreen: 'user-clock', threads: 'code-branch', story: 'seedling', npcs: 'masks-theater',
  thoughts: 'comment-dots', bonds: 'handshake', dossiers: 'address-card', planner: 'compass', banlist: 'ban',
});

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
  for (const card of element.querySelectorAll('.st-sable-card')) applyCardColor(card, value.cardColors[card.dataset.section]);
  // Light bases need darker status colours; see style.css.
  flag('stSableTone', colors.tone || null);
  flag('stSableMotion', value.motion ? null : 'off');
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
// Scales where a high value means friction; their bars get the warm tint.
const FRICTION = new Set(['suspicion', 'fear', 'grudge', 'tension']);
const PRIORITIES = ['high', 'mid', 'low'];

/** DOM-only view. Model text is never parsed as HTML. */
export function createDrawer(runtime, { document = globalThis.document, onSettings } = {}) {
  const win = document.defaultView;
  let view = runtime.snapshot(), opener, drag;
  let modeMenu, revealOff = false;
  const cleanups = [];
  const label = key => t(key, view.settings.language);
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
  const settings = button('', 'settings', () => {
    hide(false);
    if (onSettings) return onSettings();
    const tab = document.querySelector('#extensions-settings-button');
    if (!tab?.querySelector('.openIcon')) (tab?.querySelector('.drawer-toggle') ?? tab)?.click();
    const section = document.querySelector('#st-sable-settings');
    const content = section?.querySelector('.inline-drawer-content');
    if (content && win.getComputedStyle(content).display === 'none') section.querySelector('.inline-drawer-toggle')?.click();
    section?.scrollIntoView?.({ block: 'center' });
  });
  const close = button('', 'close', () => hide());
  for (const [element, name] of [[refresh, 'rotate'], [pin, 'thumbtack'], [settings, 'gear'], [close, 'xmark']]) element.append(icon(name));
  header.append(refresh, pin, settings, close);
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
  const seed = button(label('seedLegacy'), 'seedLegacy', () => { void runtime.seedLegacy(); }, 'legacy-button');
  drawer.append(header, seed, cards, hiddenRow, status);
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
    drawer.hidden = true;
    syncExpanded();
    if (restoreFocus) opener?.focus?.();
  }
  listen(document, 'pointerdown', event => {
    if (modeMenu && !modeMenu.wrap.contains(event.target)) closeModeMenu(false);
    if (!drawer.hidden && !view.settings.pinned && !drawer.contains(event.target)
      && !tab.contains(event.target) && !menu.contains(event.target)) hide(false);
  });
  listen(document, 'click', event => {
    if (modeMenu && !modeMenu.wrap.contains(event.target)) closeModeMenu(false);
  });
  listen(document, 'keydown', event => {
    if (event.key !== 'Escape') return;
    if (modeMenu) { event.preventDefault(); closeModeMenu(); }
    else if (!drawer.hidden) hide();
  });

  function closeModeMenu(restoreFocus = true) {
    if (!modeMenu) return;
    const { chip, popup, wrap } = modeMenu;
    modeMenu = undefined;
    popup.remove();
    wrap.closest('.st-sable-card')?.classList.remove('st-sable-menu-open');
    chip.setAttribute('aria-expanded', 'false');
    if (restoreFocus) chip.focus();
  }
  function openModeMenu(chip, wrap, id) {
    if (modeMenu?.chip === chip) { closeModeMenu(); return; }
    closeModeMenu(false);
    const popup = node('div', 'mode-menu');
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', chip.getAttribute('aria-label'));
    const choices = ['inject', 'show', 'off'].map(mode => {
      const item = button('', mode, () => {
        closeModeMenu();
        runtime.setMode(id, mode);
        // Switching off can remove the chip; keep keyboard focus on the reveal control.
        if (!cards.querySelector(`[data-section="${id}"]`)) hiddenToggle.focus();
      }, 'mode-option');
      item.dataset.mode = mode;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(view.modes[id] === mode));
      item.tabIndex = -1;
      const check = icon('check'); check.style.visibility = view.modes[id] === mode ? 'visible' : 'hidden';
      item.append(check, document.createTextNode(label(mode)));
      popup.append(item);
      return item;
    });
    popup.addEventListener('keydown', event => {
      const index = choices.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? 2
          : (index + (event.key === 'ArrowDown' ? 1 : 2)) % 3;
        choices[target].focus();
      } else if (['Enter', ' '].includes(event.key)) {
        event.preventDefault(); choices[index]?.click();
      } else if (event.key === 'Tab') closeModeMenu();
    });
    modeMenu = { chip, wrap, popup };
    wrap.append(popup);
    wrap.closest('.st-sable-card')?.classList.add('st-sable-menu-open');
    chip.setAttribute('aria-expanded', 'true');
    choices.find(item => item.dataset.mode === view.modes[id]).focus();
  }

  // Fold state of NPC/dossier/delta rows survives re-renders (mode taps, new states).
  let openRows = new Map();
  const muted = text => node('span', 'muted', text);
  const quote = text => (view.settings.language === 'ru' ? `«${text}»` : `“${text}”`);
  function line(parent, text, className = 'line') { if (text) parent.append(node('div', className, text)); }
  function fields(parent, value, keys) {
    const list = node('dl', 'kv');
    for (const key of keys) if (value?.[key]) list.append(node('dt', '', label(key)), node('dd', '', value[key]));
    if (list.childNodes.length) parent.append(list);
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
  function renderBody(section, body, state) {
    const { id } = section;
    const value = state[id];
    if (!value) return;
    if (section.custom) {
      if (section.shape === 'text') body.append(node('p', 'line', value));
      else if (section.shape === 'list' && Array.isArray(value) && value.length) {
        const list = node('ul', 'list');
        for (const text of value) list.append(listItem('•', text));
        body.append(list);
      } else if (section.shape === 'kv' && Array.isArray(value) && value.length) {
        const list = node('dl', 'kv');
        for (const item of value) list.append(node('dt', '', item.key), node('dd', '', item.value));
        body.append(list);
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
          fields(item, npc, ['outfit', 'position', 'agenda', 'action', 'wants_toward', 'secret']);
        }
        break;
      case 'thoughts':
        for (const thought of value) if (state.npcs?.some(npc => npc.id === thought.id && npc.present)) {
          const item = node('div', 'thought');
          item.append(node('div', 'speaker', thought.name || thought.id), node('blockquote', 'quote', quote(thought.thought)));
          body.append(item);
        }
        break;
      case 'bonds':
        for (const bond of value) {
          const group = node('div', 'bond');
          const head = node('div', 'bond-name');
          head.append(node('span', 'name', bond.name || bond.id), muted(` → ${bond.toward || '—'}`));
          group.append(head);
          for (const scale of BOND_SCALES) {
            const score = bond.stats?.[scale];
            if (!Number.isFinite(score)) continue;
            const change = bond.changes?.[scale];
            const row = node(change?.delta ? 'summary' : 'div', 'scale-row');
            const name = node('span', 'scale-name', label(scale)); name.title = label(scale);
            const bar = node('span', 'bar');
            bar.classList.add(FRICTION.has(scale) ? 'st-sable-friction' : 'st-sable-affinity');
            bar.setAttribute('role', 'meter');
            bar.setAttribute('aria-label', label(scale));
            bar.setAttribute('aria-valuemin', '0');
            bar.setAttribute('aria-valuemax', '100');
            bar.setAttribute('aria-valuenow', String(score));
            const fill = node('span', 'bar-fill');
            fill.style.width = `${Math.min(100, Math.max(0, score))}%`;
            bar.append(fill);
            row.append(name, bar, node('span', 'score', score));
            if (!change?.delta) { group.append(row); continue; }
            const badge = node('span', 'badge', `${change.delta > 0 ? '+' : '−'}${Math.abs(change.delta)}`);
            badge.classList.add(change.delta > 0 ? 'st-sable-up' : 'st-sable-down');
            row.append(badge);
            const item = node('details', 'scale');
            item.classList.add('st-sable-delta');
            item.dataset.key = `bonds:${bond.id}:${scale}`;
            item.open = openRows.get(item.dataset.key) ?? false;
            item.append(row, node('div', 'reason', change.reason || '—'));
            group.append(item);
          }
          body.append(group);
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
    handle.addEventListener('pointerdown', event => beginDrag(event, id));
    handle.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const order = [...view.settings.order], index = order.indexOf(id), target = index + (event.key === 'ArrowUp' ? -1 : 1);
      if (target >= 0 && target < order.length) { [order[index], order[target]] = [order[target], order[index]]; runtime.updateSettings({ order }); }
    });
    const title = node('h3', 'card-title');
    const glyph = sectionGlyph(document, section, view.settings.visual?.icons);
    glyph.classList.add('st-sable-card-icon');
    glyph.setAttribute('aria-hidden', 'true');
    title.append(glyph, node('span', 'card-label', name));
    const wrap = node('div', 'mode-wrap');
    const chip = button(label(mode), section.title, () => openModeMenu(chip, wrap, id), 'mode');
    chip.setAttribute('aria-haspopup', 'menu');
    chip.setAttribute('aria-expanded', 'false');
    chip.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        if (!modeMenu || modeMenu.chip !== chip) openModeMenu(chip, wrap, id);
      }
    });
    wrap.append(chip);
    chip.title = name;
    chip.setAttribute('aria-label', `${name}: ${label(mode)}`); chip.dataset.control = 'mode'; chip.dataset.mode = mode;
    const fold = button('', 'fold', () => runtime.updateSettings({ folded: { ...view.settings.folded, [id]: !folded } }), 'fold');
    fold.append(icon('chevron-down'));
    fold.dataset.control = 'fold'; fold.disabled = mode === 'off'; fold.setAttribute('aria-expanded', String(!folded));
    fold.setAttribute('aria-controls', `st-sable-body-${id}`);
    heading.addEventListener('click', event => {
      if (mode !== 'off' && !event.target.closest('button, .st-sable-mode-wrap')) fold.click();
    });
    heading.append(handle, title, wrap, fold);
    return heading;
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
  function refreshCard(card, section) {
    const { mode, folded } = cardState(section.id);
    card.dataset.mode = mode;
    applyCardColor(card, view.settings.visual?.cardColors?.[section.id]);
    card.classList.toggle('st-sable-off', mode === 'off');
    card.firstElementChild.replaceWith(buildHeader(section));
    card.querySelector('.st-sable-card-body').hidden = folded;
    card.querySelector('.st-sable-card-footer')?.replaceWith(buildFooter(section));
  }
  /** Rebuild one card only (editor open/close); the other cards are untouched. */
  function rebuildCard(id) {
    closeModeMenu();
    const section = getSections(view.settings).find(item => item.id === id);
    const old = [...cards.children].find(card => card.dataset.section === id);
    if (!section || !old) return;
    const role = old.contains(document.activeElement) ? document.activeElement.dataset.control : undefined;
    for (const item of old.querySelectorAll('details[data-key]')) openRows.set(item.dataset.key, item.open);
    const card = buildCard(section);
    old.replaceWith(card);
    if (role) card.querySelector(`[data-control="${role}"]`)?.focus();
  }

  // Manual editing: schema-driven fields, so built-in and custom sections share one editor.
  const editors = new Map();
  function fieldLabel(key) {
    for (const candidate of [`field.${key}`, key]) if (label(candidate) !== candidate) return label(candidate);
    return key;
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
    const section = getSections(view.settings).find(item => item.id === id);
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
    closeModeMenu();
    // Notifications are the only source of state renders after initial mounting.
    drag = undefined;
    const focused = document.activeElement;
    const focusId = focused?.closest('[data-section]')?.dataset.section;
    const focusRole = focused?.dataset.control;
    view = next;
    drawer.lang = view.settings.language;
    seed.hidden = !view.canSeedLegacy;
    seed.textContent = label('seedLegacy');
    seed.title = label('seedLegacy');
    seed.setAttribute('aria-label', label('seedLegacy'));
    for (const [element, key] of [[refresh, 'refresh'], [pin, 'pin'], [settings, 'settings'], [close, 'close']]) {
      element.title = label(key); element.setAttribute('aria-label', label(key));
    }
    pin.setAttribute('aria-pressed', String(view.settings.pinned));
    tab.hidden = !view.settings.showFloatingButton;
    // The tab needs the same width variable to sit on the open panel's edge.
    applyVisual(drawer, view.settings.visual);
    applyVisual(tab, view.settings.visual);
    syncExpanded();
    openRows = new Map([...cards.querySelectorAll('details[data-key]')].map(item => [item.dataset.key, item.open]));
    const scrollTop = cards.scrollTop;
    const sections = getSections(view.settings), ordered = [];
    for (const id of orderedSectionIds(view.settings.order, sections)) {
      const section = sections.find(item => item.id === id), editor = editors.get(id);
      if (editor && view.modes[id] === 'off') editors.delete(id);
      if (view.settings.hideOff && !revealOff && view.modes[id] === 'off') continue;
      if (editors.has(id) && editor.card?.isConnected) {
        // An open editor keeps its node, draft and focus; only its header follows the new view.
        refreshCard(editor.card, section);
        editor.warning.hidden = JSON.stringify(view.entry?.state?.[id] ?? null) === editor.base;
        ordered.push(editor.card);
      } else ordered.push(buildCard(section));
    }
    for (const child of [...cards.children]) if (!ordered.includes(child)) child.remove();
    let cursor = cards.firstElementChild;
    for (const card of ordered) {
      if (card === cursor) cursor = cursor.nextElementSibling;
      else cards.insertBefore(card, cursor);
    }
    cards.scrollTop = scrollTop;
    const offCount = sections.filter(section => view.modes[section.id] === 'off').length;
    hiddenRow.hidden = !view.settings.hideOff || offCount === 0;
    const hiddenLabel = revealOff ? label('hideSections') : `${label('hiddenSections')}: ${offCount}`;
    hiddenToggle.textContent = hiddenLabel;
    hiddenToggle.title = hiddenLabel;
    hiddenToggle.setAttribute('aria-label', hiddenLabel);
    hiddenToggle.setAttribute('aria-expanded', String(revealOff));
    refresh.setAttribute('aria-busy', String(!!view.running));
    refresh.firstElementChild.classList.toggle('fa-spin', !!view.running && view.settings.visual?.motion !== false);
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
    if (view.entry?.stale) status.append(node('span', 'stale', `↻ ${label('outdated')}`));
    if (focusId && focusRole) cards.querySelector(`[data-section="${focusId}"] [data-control="${focusRole}"]`)?.focus();
  }

  function beginDrag(event, id) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    drag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  const endDrag = () => cards.querySelector('.st-sable-dragging')?.classList.remove('st-sable-dragging');
  listen(document, 'pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.moved) return;
    drag.moved = true;
    const card = cards.querySelector(`[data-section="${drag.id}"]`);
    card.classList.add('st-sable-dragging');
    // Geometry works with pointer capture and touch; no HTML drag/drop API.
    const others = [...cards.children].filter(item => item !== card);
    const before = others.find(item => { const rect = item.getBoundingClientRect(); return event.clientY < rect.top + rect.height / 2; });
    cards.insertBefore(card, before ?? null);
    const rect = cards.getBoundingClientRect();
    if (event.clientY < rect.top + 40) cards.scrollTop -= 20;
    else if (event.clientY > rect.bottom - 40) cards.scrollTop += 20;
  });
  listen(document, 'pointerup', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const completed = drag; drag = undefined;
    endDrag();
    if (completed.moved) {
      const visible = [...cards.children].map(card => card.dataset.section), ids = new Set(visible);
      const order = orderedSectionIds(view.settings.order, getSections(view.settings))
        .map(id => ids.has(id) ? visible.shift() : id);
      runtime.updateSettings({ order });
    }
  });
  listen(document, 'pointercancel', () => {
    if (!drag) return;
    endDrag();
    for (const id of view.settings.order) {
      const card = cards.querySelector(`[data-section="${id}"]`);
      if (card) cards.append(card);
    }
    drag = undefined;
  });
  render(view);
  const unsubscribe = runtime.subscribe(render);
  return { open, close: hide, element: drawer, dispose() { unsubscribe(); cleanups.forEach(fn => fn()); drawer.remove(); tab.remove(); menu.remove(); } };
}
