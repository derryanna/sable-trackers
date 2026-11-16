import { ALT_PROMPT_KEY, ALT_MAX_TOKENS, altTurnMark, buildHelperMessages, buildInjection, cleanDigest, cleanReply,
  markAltTurn, pruneAltTurns } from '../altturn.js';
import { isParameterRejection } from '../run.js';
import { reasoningPayload } from '../settings.js';
import { loadStore, saveStore } from '../store.js';
import { t } from '../i18n.js';

/** «Другой ход» / "Another turn" (SPEC §38): asks the side model for a digest of the last reply's current swipe and
 *  gives it to the story model for one new swipe. The drawer holds the button; nothing is written into the message. */
export function createAltTurn(runtime, { document = globalThis.document,
  getContext = () => globalThis.SillyTavern.getContext() } = {}) {
  const bindings = [];
  // The run in flight ({ controller }) and the last attempt of this tab, shown by «Что передали модели».
  let active = null, lastAttempt = null, labelTimer;
  // 'idle', 'digest' (the side model works, a press cancels) or 'writing' (the story model writes the swipe).
  let phase = 'idle';
  const listeners = new Set();
  const setPhase = next => {
    if (phase === next) return;
    phase = next;
    for (const listener of [...listeners]) { try { listener(phase); } catch {} }
  };
  const label = key => t(key, runtime.snapshot().settings.language);
  const toast = (kind, key, detail = '') => {
    try { globalThis.toastr?.[kind]?.(`${label(key)}${detail}`, label('altTurn.title')); } catch {}
  };
  const isOn = view => view.settings.enabled && view.settings.altTurn;
  // Position 1 = in chat, depth 0, role 0 = system: the last thing the story model reads.
  const clearInjection = () => getContext().setExtensionPrompt(ALT_PROMPT_KEY, '', 1, 0, false, 0);

  async function run() {
    if (active) { active.controller.abort(); return; }
    const ctx = getContext(), view = runtime.snapshot(), settings = view.settings;
    if (!isOn(view) || (ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '')) return;
    const mesId = ctx.chat.length - 1, message = ctx.chat[mesId];
    if (!message || message.is_user || message.is_system) { toast('warning', 'altTurn.notReply'); return; }
    if (typeof ctx.swipe?.to !== 'function' || (ctx.swipe.isAllowed && !ctx.swipe.isAllowed())) { toast('warning', 'altTurn.busy'); return; }
    if (view.profileIssue) { toast('warning', view.profileIssue); return; }
    if (!cleanReply(message.mes)) { toast('warning', 'altTurn.noText'); return; }

    const chatId = ctx.getCurrentChatId(), from = Number(message.swipe_id ?? 0);
    const swipeCount = Array.isArray(message.swipes) ? message.swipes.length : 1;
    const current = active = { controller: new AbortController() };
    setPhase('digest');
    try {
      const messages = buildHelperMessages(message.mes);
      const send = payload => ctx.ConnectionManagerRequestService.sendRequest(settings.profileId, messages, ALT_MAX_TOKENS,
        { stream: false, extractData: true, includePreset: false, signal: current.controller.signal }, payload);
      const payload = reasoningPayload(settings);
      let result;
      try { result = await send(payload); } catch (error) {
        // The endpoint refused the reasoning parameters (SPEC §31): once more without them.
        if (!Object.keys(payload).length || current.controller.signal.aborted || !isParameterRejection(error)) throw error;
        result = await send({});
      }
      if (current.controller.signal.aborted) return;
      const digest = cleanDigest(typeof result === 'string' ? result : result?.content);
      if (!digest) { toast('error', 'altTurn.empty'); return; }
      // The chat may have moved on while the side model was working.
      const now = getContext();
      if (now.getCurrentChatId() !== chatId || now.chat.length - 1 !== mesId || now.chat[mesId] !== message) return;

      const injection = buildInjection(digest);
      lastAttempt = { digestChars: digest.length, injection, from: from + 1 };
      ctx.setExtensionPrompt(ALT_PROMPT_KEY, injection, 1, 0, false, 0);
      setPhase('writing');
      // A swipe past the last one makes SillyTavern generate a new one.
      try { await ctx.swipe.to(null, 'right', { message, forceSwipeId: swipeCount }); } finally { clearInjection(); }
      const after = getContext();
      if (after.getCurrentChatId() === chatId && after.chat[mesId] === message && Array.isArray(message.swipes)
        && message.swipes.length > swipeCount && message.swipe_id === swipeCount
        && markAltTurn(loadStore(after), mesId, swipeCount, from + 1)) await saveStore(after);
    } catch (error) {
      if (!current.controller.signal.aborted) {
        try { console.warn('Sable Trackers: another turn failed', error); } catch {}
        toast('error', 'altTurn.failed', error?.message ? `: ${error.message}` : '');
      }
    } finally {
      if (active === current) { active = null; setPhase('idle'); }
      render();
    }
  }

  function render() {
    const ctx = getContext(), view = runtime.snapshot(), on = isOn(view);
    const data = ctx.chatMetadata?.sableTrackers;
    for (const mes of document.querySelectorAll('#chat .mes')) {
      const mesId = Number(mes.getAttribute('mesid')), message = ctx.chat[mesId];
      const from = on && message ? altTurnMark(data, mesId, Number(message.swipe_id ?? 0)) : null;
      let mark = mes.querySelector('.st-sable-alt-label');
      if (from === null) { mark?.remove(); continue; }
      if (!mark) {
        mark = document.createElement('div');
        mark.className = 'st-sable-alt-label';
        const name = mes.querySelector('.mes_block .ch_name');
        if (name) name.after(mark); else mes.prepend(mark);
      }
      mark.textContent = label('altTurn.label').replace('{n}', from);
    }
  }
  function schedule() {
    render();
    // Swipe animations swap the message data a moment after the event.
    const view = document.defaultView;
    view?.clearTimeout(labelTimer);
    labelTimer = view?.setTimeout(render, 500);
  }

  /** «Что передали модели»: the exact insert of the last attempt in this tab. */
  function showLast() {
    const box = document.createElement('div');
    box.className = 'st-sable-alt-popup';
    const title = document.createElement('h3'), note = document.createElement('p');
    title.textContent = label('altTurn.sent');
    box.append(title, note);
    if (!lastAttempt) note.textContent = label('altTurn.sentNone');
    else {
      note.textContent = label('altTurn.sentNote').replace('{chars}', lastAttempt.digestChars).replace('{n}', lastAttempt.from);
      const pre = document.createElement('pre');
      pre.textContent = lastAttempt.injection;
      box.append(pre);
    }
    const ctx = getContext();
    ctx.callGenericPopup?.(box, ctx.POPUP_TYPE?.TEXT, '', { wide: true, allowVerticalScrolling: true });
    return box;
  }

  const ctx = getContext();
  const on = (key, handler) => {
    const event = ctx.eventTypes[key];
    if (!event) return;
    ctx.eventSource.on(event, handler);
    bindings.push(() => ctx.eventSource.removeListener(event, handler));
  };
  for (const key of ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED', 'MESSAGE_UPDATED']) on(key, schedule);
  // A stopped side-model call or a chat switch must never leave the insert behind.
  on('CHAT_CHANGED', () => { active?.controller.abort(); clearInjection(); schedule(); });
  on('MESSAGE_DELETED', length => {
    const now = getContext();
    if (pruneAltTurns(now.chatMetadata?.sableTrackers, Math.min(now.chat.length, Number.isInteger(length) ? length : now.chat.length))) void saveStore(now);
    schedule();
  });
  // Deleting a swipe renumbers the ones after it: that message's marks no longer point at the right swipes.
  on('MESSAGE_SWIPE_DELETED', info => {
    const now = getContext(), mesId = Number.isInteger(info?.messageId) ? info.messageId : now.chat.length - 1;
    if (pruneAltTurns(now.chatMetadata?.sableTrackers, Infinity, mesId)) void saveStore(now);
    schedule();
  });
  const unsubscribe = runtime.subscribe(() => render());
  clearInjection();
  render();
  return { run, render, showLast, idle: () => !active, phase: () => phase,
    /** Calls `listener(phase)` on every phase change; returns the unsubscribe function. */
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      active?.controller.abort(); unsubscribe(); bindings.forEach(remove => remove());
      listeners.clear();
      document.defaultView?.clearTimeout(labelTimer);
      document.querySelectorAll('.st-sable-alt-label').forEach(node => node.remove());
    } };
}
