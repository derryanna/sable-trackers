import { applyEffects, displayNode, signedNumber } from './drawer.js';
import { bondScales, getSections } from '../sections.js';
import { t } from '../i18n.js';

/** A disposable DOM sibling, never part of the saved message text. */
export function createPanel(runtime, drawer, { document = globalThis.document,
  getContext = () => globalThis.SillyTavern.getContext() } = {}) {
  const bindings = [];
  const place = (parent, element, previous) => {
    const expected = previous ? previous.nextSibling : parent.firstChild;
    if (element !== expected) parent.insertBefore(element, expected);
  };
  function render() {
    const view = runtime.snapshot(), state = view.entry?.state, ctx = getContext();
    const mesId = ctx.chat.findLastIndex(message => message && !message.is_user && !message.is_system);
    const text = view.settings.showPanel && state ? document.querySelector(`#chat .mes[mesid="${mesId}"][is_user="false"] .mes_text`) : null;
    // One panel, under the latest character reply only. Live cards (SPEC §16): the panel node and its pack stat rows
    // persist across renders, so the bars slide to their new values like in the drawer; the text lines are rebuilt.
    const current = text?.nextElementSibling?.classList.contains('st-sable-panel') ? text.nextElementSibling : null;
    for (const stale of document.querySelectorAll('#chat .st-sable-panel')) if (stale !== current) stale.remove();
    if (!text) return;
    const node = (tag, className, value) => displayNode(document, view, tag, className, value);
    const language = view.settings.language;
    let panel = current;
    if (!panel) {
      panel = node('div', 'panel');
      panel.tabIndex = 0;
      panel.setAttribute('role', 'button');
      panel.addEventListener('click', () => drawer.open(panel));
      panel.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key)) { event.preventDefault(); drawer.open(panel); }
      });
      text.after(panel);
    }
    panel.setAttribute('aria-label', t('open', language));
    applyEffects(panel, view.settings.visual);
    const lines = [];
    if (view.modes.world !== 'off') lines.push(node('div', 'panel-world',
      [state.world?.time, state.world?.location, state.world?.weather].filter(Boolean).join(' · ')));
    if (view.modes.npcs !== 'off') lines.push(node('div', 'panel-npcs',
      (state.npcs ?? []).filter(npc => npc.present).map(npc => [npc.name || npc.id, npc.mood].filter(Boolean).join(' — ')).join(' · ')));
    // One compact line per enabled pack (SPEC §7, §16): every stats row of its sections, bars included.
    const sections = getSections(view.settings, view.packs?.enabled ?? []);
    const packLines = new Map([...panel.querySelectorAll(':scope > .st-sable-panel-pack')].map(line => [line.dataset.key, line]));
    for (const pack of view.packs?.available ?? []) {
      if (!view.packs.enabled.includes(pack.id)) continue;
      const items = sections.filter(section => section.pack === pack.id && section.shape === 'stats' && view.modes[section.id] !== 'off')
        .flatMap(section => (Array.isArray(state[section.id]) ? state[section.id] : []).map(item => ({ section, item })));
      if (!items.length) continue;
      let line = packLines.get(pack.id); packLines.delete(pack.id);
      if (!line) { line = node('div', 'panel-pack'); line.dataset.key = pack.id; }
      line.setAttribute('aria-label', pack.title);
      const stats = new Map([...line.children].map(stat => [stat.dataset.key, stat])), seen = new Set();
      let previous = null;
      for (const { section, item } of items) {
        let key = `${section.id}:${item.key}`;
        for (let n = 2; seen.has(key); n++) key = `${section.id}:${item.key}#${n}`;
        seen.add(key);
        const element = statNode(stats.get(key), key, item, node);
        stats.delete(key);
        place(line, element, previous); previous = element;
      }
      for (const leftover of stats.values()) leftover.remove();
      lines.push(line);
    }
    for (const leftover of packLines.values()) leftover.remove();
    // An older snapshot may still describe the scene, but its deltas are not this turn's.
    if (view.modes.bonds !== 'off' && view.entry.mesId === mesId && !view.entry.stale) {
      const scales = bondScales(view.settings);
      for (const bond of state.bonds ?? []) for (const { key, builtin, title, signed } of scales) {
        const delta = bond.changes?.[key]?.delta, value = bond.stats?.[key];
        if (!Number.isFinite(delta) || !delta) continue;
        // A signed scale (SPEC §22) also shows where it now stands, with its sign: «+5 Trust → −40».
        const now = signed && Number.isFinite(value) ? ` → ${signedNumber(value)}` : '';
        lines.push(node('span', 'panel-badge', `${bond.name || bond.id}: ${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${builtin ? t(title, language) : title}${now}`));
      }
    }
    // Rebuilt lines leave first, so the persistent pack lines are never detached and re-inserted.
    for (const child of [...panel.children]) if (!lines.includes(child)) child.remove();
    let previous = null;
    for (const line of lines) { place(panel, line, previous); previous = line; }
  }
  /** Creates or updates one `name [bar] value/max unit` item; a counter (max null) has no bar. */
  function statNode(existing, key, item, node) {
    const kind = item.max == null ? 'counter' : 'bar';
    let stat = existing && existing.dataset.kind === kind ? existing : null;
    if (!stat) {
      existing?.remove();
      stat = node('span', 'panel-stat'); stat.dataset.key = key; stat.dataset.kind = kind;
      stat.append(node('span', 'panel-stat-name'));
      if (kind === 'bar') {
        const bar = node('span', 'panel-bar'); bar.setAttribute('role', 'meter'); bar.setAttribute('aria-valuemin', '0');
        bar.append(node('span', 'bar-fill')); stat.append(bar);
      }
      stat.append(node('span', 'panel-stat-value'));
    }
    const [name, bar, value] = kind === 'bar' ? stat.children : [stat.children[0], null, stat.children[1]];
    name.textContent = item.key;
    const number = Number(item.value), previous = Number(stat.dataset.value);
    stat.toggleAttribute('data-st-sable-changed', existing === stat && previous !== number);
    stat.dataset.value = String(number);
    if (bar) {
      bar.setAttribute('aria-label', item.key); bar.setAttribute('aria-valuemax', String(item.max)); bar.setAttribute('aria-valuenow', String(number));
      const ratio = Math.min(1, Math.max(0, number / item.max));
      bar.firstElementChild.style.transform = `scaleX(${ratio})`;
      bar.firstElementChild.style.setProperty('--st-sable-ratio', String(ratio));
    }
    value.textContent = `${number}${item.max == null ? '' : `/${item.max}`}${item.unit ? ` ${item.unit}` : ''}`;
    return stat;
  }
  const ctx = getContext();
  for (const key of ['CHARACTER_MESSAGE_RENDERED', 'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']) {
    const event = ctx.eventTypes[key];
    if (!event) continue;
    ctx.eventSource.on(event, render);
    bindings.push(() => ctx.eventSource.removeListener(event, render));
  }
  const unsubscribe = runtime.subscribe(render);
  render();
  return { render, dispose() {
    unsubscribe(); bindings.forEach(remove => remove());
    document.querySelectorAll('#chat .st-sable-panel').forEach(node => node.remove());
  } };
}
