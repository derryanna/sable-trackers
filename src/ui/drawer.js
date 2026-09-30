import { getSections, orderedSectionIds, BOND_SCALES } from '../sections.js';
import { t } from '../i18n.js';
import { normalizeVisual } from '../settings.js';

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

/** Visual settings (SPEC §12) as CSS custom properties; style.css falls back to the defaults. */
export function applyVisual(element, visual) {
  const value = normalizeVisual(visual);
  for (const [name, css] of [['opacity', String(value.opacity)], ['blur', `${value.blur}px`], ['font', `${value.fontSize}px`],
    ['width', `${value.widthVw}vw`], ['accent', value.accent], ['radius', `${value.radius}px`]]) {
    element.style.setProperty(`--st-sable-${name}`, css);
  }
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

// Scales where a high value means friction; their bars get the warm tint.
const FRICTION = new Set(['suspicion', 'fear', 'grudge', 'tension']);
const PRIORITIES = ['high', 'mid', 'low'];

/** DOM-only view. Model text is never parsed as HTML. */
export function createDrawer(runtime, { document = globalThis.document, onSettings } = {}) {
  const win = document.defaultView;
  let view = runtime.snapshot(), opener, drag;
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
  const status = node('footer', 'status');
  status.setAttribute('role', 'status');
  const seed = button(label('seedLegacy'), 'seedLegacy', () => { void runtime.seedLegacy(); }, 'legacy-button');
  drawer.append(header, seed, cards, status);
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
    drawer.hidden = true;
    syncExpanded();
    if (restoreFocus) opener?.focus?.();
  }
  listen(document, 'pointerdown', event => {
    if (!drawer.hidden && !view.settings.pinned && !drawer.contains(event.target)
      && !tab.contains(event.target) && !menu.contains(event.target)) hide(false);
  });
  listen(document, 'keydown', event => { if (event.key === 'Escape' && !drawer.hidden) hide(); });

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
  function listItem(glyph, text, meta) {
    const item = node('li', 'item');
    const mark = node('span', 'glyph', glyph); mark.setAttribute('aria-hidden', 'true');
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
        for (const [key, glyph] of [['time', 'clock'], ['location', 'location-dot'], ['weather', 'cloud-sun-rain']]) {
          if (!value[key]) continue;
          const item = node('span', 'meta-item'); item.title = label(key);
          item.append(icon(glyph), node('span', '', value[key]));
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
          list.append(listItem('🌱', seed.text, age === null ? '' : `${age} ${turns(age)}`));
        }
        for (const timer of value.timers ?? []) list.append(listItem('⏳', timer.text, timer.due));
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

  function render(next) {
    // Notifications are the only source of state renders after initial mounting.
    drag = undefined;
    const focused = document.activeElement;
    const focusId = focused?.closest('[data-section]')?.dataset.section;
    const focusRole = focused?.dataset.control;
    view = next;
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
    cards.replaceChildren();
    const sections = getSections(view.settings);
    for (const id of orderedSectionIds(view.settings.order, sections)) {
      const section = sections.find(item => item.id === id);
      const sectionTitle = section.custom ? section.title : label(section.title);
      const mode = view.modes[id], folded = mode === 'off' || !!view.settings.folded[id];
      const card = node('section', 'card'); card.dataset.section = id; card.dataset.mode = mode;
      card.classList.toggle('st-sable-off', mode === 'off');
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
      title.append(glyph, node('span', 'card-label', sectionTitle));
      const chip = button(label(mode), section.title, () => runtime.setMode(id, { inject: 'show', show: 'off', off: 'inject' }[mode]), 'mode');
      chip.title = sectionTitle;
      chip.setAttribute('aria-label', `${sectionTitle}: ${label(mode)}`); chip.dataset.control = 'mode'; chip.dataset.mode = mode;
      const fold = button('', 'fold', () => runtime.updateSettings({ folded: { ...view.settings.folded, [id]: !folded } }), 'fold');
      fold.append(icon('chevron-down'));
      fold.dataset.control = 'fold'; fold.disabled = mode === 'off'; fold.setAttribute('aria-expanded', String(!folded));
      const body = node('div', 'card-body'); body.id = `st-sable-body-${id}`; body.hidden = folded;
      fold.setAttribute('aria-controls', body.id);
      if (mode !== 'off') renderBody(section, body, view.entry?.state ?? {});
      if (!body.childNodes.length) body.append(node('span', 'empty', '—'));
      heading.append(handle, title, chip, fold); card.append(heading, body); cards.append(card);
    }
    cards.scrollTop = scrollTop;
    const last = view.store.lastRun;
    const at = last?.at ?? (last?.ok ? view.entry?.state.meta?.updatedAt : undefined);
    const date = at ? new Date(at) : null;
    const time = date && Number.isFinite(date.getTime())
      ? date.toLocaleTimeString(view.settings.language, { hour: '2-digit', minute: '2-digit' }) : '—';
    status.replaceChildren();
    if (last) {
      const dot = node('span', 'status-dot');
      dot.classList.add(last.ok ? 'st-sable-ok' : 'st-sable-fail');
      status.append(dot, node('span', 'status-text',
        `${time} · ${label(last.ok ? 'ok' : 'error')} · ${last.ms ?? '—'} ${label('duration')} · ~${last.inTok ?? '—'} / ~${last.outTok ?? '—'} ${label('tokens')}`));
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
    if (completed.moved) runtime.updateSettings({ order: [...cards.children].map(card => card.dataset.section) });
  });
  listen(document, 'pointercancel', () => {
    if (!drag) return;
    endDrag();
    for (const id of view.settings.order) cards.append(cards.querySelector(`[data-section="${id}"]`));
    drag = undefined;
  });
  render(view);
  const unsubscribe = runtime.subscribe(render);
  return { open, close: hide, element: drawer, dispose() { unsubscribe(); cleanups.forEach(fn => fn()); drawer.remove(); tab.remove(); menu.remove(); } };
}
