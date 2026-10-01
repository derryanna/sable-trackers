import { seedFromLegacy } from './legacy.js';
import { getSections } from './sections.js';
import { buildPrompt } from './prompt.js';
import { parseStateOutput, sanitizeSection } from './parse.js';
import { mergeState } from './merge.js';
import { buildDigest } from './digest.js';
import { t } from './i18n.js';
import { loadSettings, saveSettings, effectiveModes } from './settings.js';
import { STORE_KEY, loadStore, saveStore, findEntry, currentEntry, restoreCounters, putEntry, pruneEntries } from './store.js';

export const LOG_LIMIT = 5;
const RECEIVED_TYPES = new Set(['normal', 'swipe', 'regenerate', 'continue']);
const characterMessage = message => message && !message.is_user && !message.is_system;
const isGroup = ctx => ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '';

/** Runtime shared by event wiring and future UI. No browser globals at import time. */
export function createRuntime(getContext = () => globalThis.SillyTavern.getContext()) {
  let active, lore = [], lastFingerprint, warnedProfile = false;
  let log = [], lastLogAt = 0;
  const listeners = new Set();
  const bindings = [];
  const cancel = () => { if (active) { active.record?.('dropped'); active.controller.abort(); active = undefined; publish(); } };
  const lastCharacterId = ctx => ctx.chat.findLastIndex(characterMessage);

  function snapshot() {
    const ctx = getContext();
    const settings = loadSettings(ctx), store = loadStore(ctx);
    return { settings, store, log, entry: currentEntry(store, ctx.chat), modes: effectiveModes(settings, store),
      running: active ? { mesId: active.mesId, swipeId: active.swipeId, startedAt: active.startedAt } : null,
      canSeedLegacy: !store.ring.length && !!seedFromLegacy(ctx.chat),
      name1: ctx.name1, name2: ctx.name2 };
  }

  function publish() {
    const ctx = getContext();
    const view = snapshot();
    const sections = getSections(view.settings);
    const hasState = sections.some(s => view.entry?.state[s.id] !== undefined && view.modes[s.id] === 'inject');
    const text = view.settings.enabled && !isGroup(ctx) && hasState
      ? buildDigest(view.entry.state, view.modes, { sections, language: view.settings.language,
        order: view.settings.order, userName: ctx.name1 }) : '';
    ctx.setExtensionPrompt('sable_trackers', text, 1, view.settings.depth, false, 0);
    for (const listener of listeners) listener(view);
    return view;
  }

  function warn(key, settings) {
    if (warnedProfile) return;
    warnedProfile = true;
    try {
      const message = t(key, settings.language);
      if (globalThis.toastr?.warning) globalThis.toastr.warning(message);
      else console.warn(message);
    } catch {}
  }

  function run(mesId, options = {}) {
    try {
      const ctx = getContext(), message = ctx.chat[mesId];
      const fingerprint = JSON.stringify([ctx.getCurrentChatId(), mesId, message?.swipe_id ?? 0, message?.mes]);
      if (active?.fingerprint === fingerprint) return active.promise;
      // Make the shared promise available even to subscribers notified at request start.
      let finish;
      const promise = new Promise(resolve => { finish = resolve; });
      void execute(mesId, options, promise).then(finish, () => finish());
      return promise;
    } catch { return Promise.resolve(); }
  }

  // Read a detached store so preview never initializes or mutates chat metadata.
  function prepare(mesId, force) {
    const ctx = getContext(), settings = loadSettings(ctx);
    const data = loadStore({ chatMetadata: { [STORE_KEY]: structuredClone(ctx.chatMetadata[STORE_KEY]) } });
    const base = currentEntry(data, ctx.chat, mesId);
    // Failed or superseded requests between snapshots still count as replies.
    const elapsed = base ? ctx.chat.slice(base.mesId + 1, mesId + 1).filter(characterMessage).length : 1;
    const turn = (base?.turn ?? 0) + elapsed;
    const sections = getSections(settings);
    const counters = Object.fromEntries(sections.map(s => [s.id, (base?.turnsSince?.[s.id] ?? 0) + elapsed]));
    const modes = effectiveModes(settings, data);
    const dueSections = sections.filter(s => modes[s.id] !== 'off'
      && (force || s.id === 'dossiers' || counters[s.id] >= Math.max(1, s.custom ? s.period : settings.sections[s.id].period))).map(s => s.id);
    const built = buildPrompt({ settings: { ...settings, language: settings.language === 'en' ? 'English' : 'Russian' },
      sections, modes, dueSections, previousState: base?.state ?? {},
      card: ctx.substituteParams('{{description}}\n{{personality}}\n{{scenario}}'),
      persona: ctx.substituteParams('{{persona}}'), lore,
      chat: ctx.chat.slice(0, mesId + 1).filter(m => !m.is_system), userName: ctx.name1, characterName: ctx.name2 });
    return { settings, base, elapsed, turn, sections, counters, modes, dueSections, built };
  }

  function preview() {
    const ctx = getContext(), mesId = lastCharacterId(ctx);
    if (!loadSettings(ctx).enabled || isGroup(ctx) || mesId < 0) return null;
    const { built } = prepare(mesId, true);
    return { mesId, ...built, chars: built.messages.reduce((sum, m) => sum + m.content.length, 0) };
  }

  async function execute(mesId, { force = false, type = 'normal' } = {}, promise) {
    const ctx = getContext();
    const settings = loadSettings(ctx), data = loadStore(ctx);
    if (!settings.enabled || isGroup(ctx) || !RECEIVED_TYPES.has(type)
      || !Number.isInteger(mesId) || !characterMessage(ctx.chat[mesId])) return;
    let request, entry, recorded = false;
    const started = Date.now(), message = ctx.chat[mesId], swipeId = message.swipe_id ?? 0;
    const record = (status, error) => {
      if (!entry || recorded) return;
      recorded = true; entry.status = status; entry.ms = Date.now() - started;
      if (error !== undefined) entry.error = String(error?.message ?? error);
      log = [entry, ...log].sort((a, b) => b.at - a.at).slice(0, LOG_LIMIT);
    };
    const ownsRequest = () => request && active === request && !request.controller.signal.aborted
      && getContext().getCurrentChatId() === request.chatId;
    // Release the busy state and repaint before the (slow, whole-chat) metadata save.
    const settle = () => { if (request && active === request) active = undefined; publish(); };
    const stillCurrent = () => ownsRequest() && getContext().chat[mesId] === message
      && (message.swipe_id ?? 0) === swipeId
      && JSON.stringify([request.chatId, mesId, swipeId, message.mes]) === request.fingerprint;
    try {
      const fingerprint = JSON.stringify([ctx.getCurrentChatId(), mesId, swipeId, message.mes]);
      if (!force && fingerprint === lastFingerprint) return;
      cancel();
      const profile = ctx.extensionSettings.connectionManager?.profiles?.find(p => p.id === settings.profileId);
      if (!profile) { warn('profileRequired', settings); return; }
      if (profile.mode !== 'cc') { warn('profileUnsupported', settings); return; }
      warnedProfile = false;
      lastFingerprint = fingerprint;
      const { base, turn, sections, counters, dueSections, built } = prepare(mesId, force);
      entry = { at: lastLogAt = Math.max(Date.now(), lastLogAt + 1), chatId: ctx.getCurrentChatId(), mesId, swipeId,
        ms: 0, status: 'skipped', requestedSections: built.requestedSections, validSections: [], warnings: [],
        error: null, request: null, response: null, inChars: 0, outChars: 0 };
      if (!dueSections.length) {
        // Advance the cadence even when only slow sections are enabled.
        const state = mergeState(base?.state ?? {}, {}, { sections, requestedSections: [],
          meta: { turn, updatedAt: Date.now(), forMesId: mesId, forSwipeId: swipeId } });
        putEntry(data, { mesId, swipeId, turn, state, turnsSince: counters }, settings.keep);
        data.lastRun = { mesId, ok: true, at: Date.now(), skipped: true };
        record('skipped');
        publish();
        await saveStore(getContext());
        return;
      }
      request = { controller: new AbortController(), chatId: ctx.getCurrentChatId(),
        mesId, swipeId, startedAt: started, fingerprint, promise };
      entry.request = built.messages;
      entry.inChars = built.messages.reduce((sum, m) => sum + m.content.length, 0);
      request.record = record;
      active = request;
      publish();
      const result = await ctx.ConnectionManagerRequestService.sendRequest(settings.profileId, built.messages, settings.maxTokens,
        { stream: false, extractData: true, includePreset: false, signal: request.controller.signal });
      entry.response = typeof result === 'string' ? result : result?.content ?? '';
      entry.outChars = entry.response.length;
      if (!ownsRequest()) { record('dropped'); publish(); return; }
      const current = loadStore(getContext());
      if (!stillCurrent()) {
        record('dropped');
        current.lastRun = { mesId, ok: false, at: Date.now(), ms: Date.now() - started, error: t('runDropped', settings.language) };
        settle();
        await saveStore(getContext());
        return;
      }
      const parsed = parseStateOutput(result, built.requestedSections, sections);
      entry.warnings = parsed.warnings; entry.validSections = parsed.validSections;
      for (const warning of parsed.warnings) console.warn(`Sable Trackers: ${warning}`);
      if (!parsed.ok || !parsed.validSections.length) { record('invalid'); throw new Error(t('invalidOutput', settings.language)); }
      const state = mergeState(base?.state ?? {}, parsed, { sections, requestedSections: built.requestedSections,
        meta: { turn, updatedAt: Date.now(), forMesId: mesId, forSwipeId: swipeId } });
      for (const id of parsed.validSections) counters[id] = 0;
      putEntry(current, { mesId, swipeId, turn, state, turnsSince: counters }, settings.keep);
      const content = typeof result === 'string' ? result : result.content;
      current.lastRun = { mesId, ok: true, at: Date.now(), ms: Date.now() - started,
        inTok: Math.ceil(built.messages.reduce((sum, m) => sum + m.content.length, 0) / 4), outTok: Math.ceil(content.length / 4) };
      record('ok');
      settle();
      await saveStore(getContext());
    } catch (error) {
      if (request && (!ownsRequest() || error?.name === 'AbortError')) { record('dropped'); settle(); return; }
      record(request && !stillCurrent() ? 'dropped' : 'failed', error);
      loadStore(getContext()).lastRun = { mesId, ok: false, at: Date.now(), ms: Date.now() - started,
        error: t(request && !stillCurrent() ? 'runDropped' : 'runFailed', settings.language) };
      try { console.warn('Sable Trackers: request failed', error); } catch {}
      settle();
      await saveStore(getContext());
    } finally {
      if (request && active === request) { active = undefined; publish(); }
    }
  }

  function swipe(mesId) {
    const ctx = getContext();
    if (mesId !== lastCharacterId(ctx)) return;
    cancel(); lastFingerprint = undefined;
    const data = loadStore(ctx);
    const entry = findEntry(data, mesId, ctx.chat[mesId]?.swipe_id ?? 0);
    restoreCounters(data, entry ?? currentEntry(data, ctx.chat, mesId));
    // Cached swipes need no side-model request when MESSAGE_RECEIVED follows.
    if (entry && !entry.stale) lastFingerprint = JSON.stringify([ctx.getCurrentChatId(), mesId, entry.swipeId, ctx.chat[mesId].mes]);
    publish();
    return saveStore(ctx);
  }

  function deleted(newChatLength) {
    cancel(); lastFingerprint = undefined;
    const ctx = getContext(), data = loadStore(ctx);
    pruneEntries(data, Math.min(ctx.chat.length, newChatLength));
    restoreCounters(data, currentEntry(data, ctx.chat));
    publish();
    return saveStore(ctx);
  }

  function edited(mesId) {
    const ctx = getContext();
    if (mesId !== lastCharacterId(ctx)) return;
    cancel(); lastFingerprint = undefined;
    const data = loadStore(ctx), entry = findEntry(data, mesId, ctx.chat[mesId].swipe_id ?? 0);
    if (entry) entry.stale = true;
    publish();
    return saveStore(ctx);
  }

  function chatChanged() {
    cancel(); lore = []; lastFingerprint = undefined; warnedProfile = false;
    publish();
  }

  function updateSettings(patch) {
    if (['enabled', 'profileId', 'language', 'customSections'].some(key => Object.hasOwn(patch, key))) {
      cancel(); lastFingerprint = undefined; warnedProfile = false;
    }
    saveSettings(getContext(), patch);
    publish();
  }

  function setMode(id, mode, chatOnly = loadSettings(getContext()).perChatOverrides) {
    // null removes a chat override so the global mode becomes effective again.
    if (!getSections(loadSettings(getContext())).some(s => s.id === id) || (!(mode === null && chatOnly) && !['inject', 'show', 'off'].includes(mode))) return;
    const ctx = getContext();
    if (chatOnly) {
      if (mode === null) delete loadStore(ctx).modeOverride[id];
      else loadStore(ctx).modeOverride[id] = mode;
      void saveStore(ctx);
    } else saveSettings(ctx, { sections: { [id]: { mode } } });
    publish();
  }

  /** Manual edit: replace one section in the current state. Returns false when nothing could be saved. */
  function editState(id, value) {
    const ctx = getContext(), settings = loadSettings(ctx), data = loadStore(ctx);
    const section = getSections(settings).find(item => item.id === id);
    const cleaned = sanitizeSection(section, value);
    if (!section || cleaned === undefined) return false;
    let entry = currentEntry(data, ctx.chat);
    if (!entry) {
      const mesId = lastCharacterId(ctx);
      if (mesId < 0) return false;
      const swipeId = ctx.chat[mesId].swipe_id ?? 0;
      const turn = ctx.chat.slice(0, mesId + 1).filter(characterMessage).length;
      putEntry(data, { mesId, swipeId, turn, turnsSince: structuredClone(data.turnsSince),
        state: { meta: { turn, updatedAt: Date.now(), forMesId: mesId, forSwipeId: swipeId } } }, settings.keep);
      entry = currentEntry(data, ctx.chat);
    }
    // The user's edit wins over a side-model reply that was computed from the old state.
    cancel(); lastFingerprint = undefined;
    entry.state[id] = cleaned;
    entry.state.meta = { ...entry.state.meta, editedAt: Date.now() };
    delete entry.stale;
    publish();
    void saveStore(ctx);
    return true;
  }

  async function seedLegacy() {
    const ctx = getContext(), data = loadStore(ctx);
    if (data.ring.length) return false;
    const seed = seedFromLegacy(ctx.chat);
    if (!seed) return false;
    cancel(); lastFingerprint = undefined;
    const { state, mesId } = seed;
    const swipeId = ctx.chat[mesId].swipe_id ?? 0;
    const turn = ctx.chat.slice(0, mesId + 1).filter(characterMessage).length;
    state.meta = { turn, updatedAt: Date.now(), forMesId: mesId, forSwipeId: swipeId };
    putEntry(data, { mesId, swipeId, turn, state, turnsSince: {} }, loadSettings(ctx).keep);
    publish();
    await saveStore(ctx);
    return true;
  }

  function start() {
    if (bindings.length) return;
    const ctx = getContext();
    const handlers = {
      MESSAGE_RECEIVED: (id, type) => { void run(id, { type }); }, MESSAGE_SWIPED: swipe,
      MESSAGE_DELETED: deleted, MESSAGE_EDITED: edited, CHAT_CHANGED: chatChanged,
      WORLD_INFO_ACTIVATED: entries => { lore = Array.isArray(entries) ? structuredClone(entries) : []; },
    };
    for (const [key, handler] of Object.entries(handlers)) {
      const event = ctx.eventTypes[key];
      ctx.eventSource.on(event, handler);
      bindings.push(() => ctx.eventSource.removeListener(event, handler));
    }
    publish();
  }

  return { start, run, refresh: () => run(lastCharacterId(getContext()), { force: true }),
    idle: () => active?.promise ?? Promise.resolve(),
    preview, clearLog() { log = []; publish(); },
    snapshot, publish, updateSettings, setMode, seedLegacy, editState,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { cancel(); bindings.splice(0).forEach(remove => remove()); listeners.clear(); },
  };
}
