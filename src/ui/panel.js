import { displayNode } from './drawer.js';
import { BOND_SCALES } from '../sections.js';
import { t } from '../i18n.js';

/** A disposable DOM sibling, never part of the saved message text. */
export function createPanel(runtime, drawer, { document = globalThis.document,
  getContext = () => globalThis.SillyTavern.getContext() } = {}) {
  const bindings = [];
  function render() {
    document.querySelectorAll('#chat .st-sable-panel').forEach(node => node.remove());
    const view = runtime.snapshot(), state = view.entry?.state;
    if (!view.settings.showPanel || !state) return;
    const ctx = getContext();
    const mesId = ctx.chat.findLastIndex(message => message && !message.is_user && !message.is_system);
    const text = document.querySelector(`#chat .mes[mesid="${mesId}"][is_user="false"] .mes_text`);
    if (!text) return;
    const node = (tag, className, value) => displayNode(document, view, tag, className, value);
    const panel = node('div', 'panel');
    panel.tabIndex = 0;
    panel.setAttribute('role', 'button');
    panel.setAttribute('aria-label', t('open', view.settings.language));
    panel.addEventListener('click', () => drawer.open(panel));
    panel.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); drawer.open(panel); }
    });
    if (view.modes.world !== 'off') panel.append(node('div', 'panel-world',
      [state.world?.time, state.world?.location, state.world?.weather].filter(Boolean).join(' · ')));
    if (view.modes.npcs !== 'off') panel.append(node('div', 'panel-npcs',
      (state.npcs ?? []).filter(npc => npc.present).map(npc => [npc.name || npc.id, npc.mood].filter(Boolean).join(' — ')).join(' · ')));
    // An older snapshot may still describe the scene, but its deltas are not this turn's.
    if (view.modes.bonds !== 'off' && view.entry.mesId === mesId && !view.entry.stale) {
      for (const bond of state.bonds ?? []) for (const scale of BOND_SCALES) {
        const delta = bond.changes?.[scale]?.delta;
        if (!Number.isFinite(delta) || !delta) continue;
        panel.append(node('span', 'panel-badge', `${bond.name || bond.id}: ${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${t(scale, view.settings.language)}`));
      }
    }
    text.after(panel);
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
