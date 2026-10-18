import { seedFromLegacy } from './legacy.js';
import { getSections, bondScales } from './sections.js';
import { roll } from './packs/dice.js';
import { getPacks } from './packs/index.js';
import { buildPrompt } from './prompt.js';
import { parseStateOutput, sanitizeSection, outputProblem } from './parse.js';
import { mergeState } from './merge.js';
import { buildDigest, buildSecretsPrompt } from './digest.js';
import { cutSecrets, parseSecretsBlock, applySecrets } from './secrets.js';
import { t } from './i18n.js';
import { ROLES, loadSettings, saveSettings, effectiveModes, reasoningPayload } from './settings.js';
import { STORE_KEY, loadStore, saveStore, enabledPacks, findEntry, currentEntry, restoreCounters, lagOf, putEntry, pruneEntries, recordHistory, recordStatHistory, pruneHistory } from './store.js';

export const LOG_LIMIT = 5;
// A state more replies behind the chat than this is not injected at all (SPEC §32).
export const MAX_INJECT_LAG = 1;
// The display-only regex that hides the story model's notebook block while a reply streams (SPEC §36).
export const SECRETS_REGEX_NAME = 'Sable Trackers: story secrets';
// Generation types that rewrite the last character reply (SPEC §32): they get the state from before it.
const REWRITE_TYPES = new Set(['swipe', 'regenerate', 'continue']);
const RECEIVED_TYPES = new Set(['normal', 'swipe', 'regenerate', 'continue', 'edit']);
const characterMessage = message => message && !message.is_user && !message.is_system;
// Stats sections with history (SPEC §26): built-in pack sections and custom blocks of shape `stats`.
const isStats = section => !!section?.custom && section.shape === 'stats';
// The selected side-model profile (SPEC §27): null when usable, else the i18n key of the problem.
export function profileIssue(ctx, settings) {
  const profile = ctx.extensionSettings.connectionManager?.profiles?.find(p => p.id === settings.profileId);
  return !settings.profileId || !profile ? 'profileRequired' : profile.mode !== 'cc' ? 'profileUnsupported' : null;
}
const isGroup = ctx => ctx.groupId !== undefined && ctx.groupId !== null && ctx.groupId !== '';
// A request error that looks like the endpoint refusing the reasoning parameters (SPEC §31).
export const isParameterRejection = error => error?.name !== 'AbortError' && (Number(error?.status) === 400
  || /unsupported parameter|invalid request for this model|reasoning/i.test(String(error?.message ?? error ?? '')));

/** Runtime shared by event wiring and future UI. No browser globals at import time. */
export function createRuntime(getContext = () => globalThis.SillyTavern.getContext(), { random = () => globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 } = {}) {
  let active, lore = [], lastFingerprint, warnedProfile = false;
  let log = [], lastLogAt = 0, armed = null;
  // Profiles whose endpoint rejected the reasoning payload; for this page session only (SPEC §31).
  const noReasoning = new Set();
  // The `GENERATION_STARTED` override (SPEC §32): true while a swipe / regenerate / continue is being generated.
  let rewriting = false;
  // The last notebook prompt set (text, depth, role), so publish() skips the call when nothing changed (SPEC §36).
  let secretsSent;
  const listeners = new Set();
  const bindings = [];
  const cancel = () => { if (active) { active.record?.('dropped'); active.controller.abort(); active = undefined; publish(); } };
  const lastCharacterId = ctx => ctx.chat.findLastIndex(characterMessage);
  // The injected entry and its lag (SPEC §32). While a reply is rewritten, the state from before that reply, its lag
  // measured against the message before the rewritten one.
  function chooseInjected(store, ctx) {
    const rewritten = rewriting ? lastCharacterId(ctx) : -1;
    const injectedEntry = currentEntry(store, ctx.chat, rewritten >= 0 ? rewritten : Infinity, { skipStale: true });
    return { injectedEntry, lag: lagOf(injectedEntry, ctx.chat, rewritten >= 0 ? rewritten : ctx.chat.length) };
  }
  // Message and chat events end the override; publishes only when it was on and the caller would not publish anyway.
  const endRewrite = (republish = false) => { const was = rewriting; rewriting = false; if (was && republish) publish(); };

  function snapshot() {
    const ctx = getContext();
    const settings = loadSettings(ctx), store = loadStore(ctx);
    return { settings, store, log, rollArmed: armed !== null && armed === store.roll?.consumedBy,
      entry: currentEntry(store, ctx.chat), ...chooseInjected(store, ctx), modes: effectiveModes(settings, store),
      packs: { enabled: enabledPacks(store, settings), available: getPacks(settings).map(p => ({ id: p.id,
        title: p.builtin ? t(p.title, settings.language) : p.title, icon: p.icon,
        description: p.builtin ? t(p.description, settings.language) : p.description, builtin: !!p.builtin, scope: p.scope, scopeDefault: p.scopeDefault })) },
      running: active ? { mesId: active.mesId, swipeId: active.swipeId, startedAt: active.startedAt } : null,
      canSeedLegacy: !store.ring.length && !!seedFromLegacy(ctx.chat),
      // Connection Manager profiles for the hint's select (the settings control uses the same source and filter).
      profileIssue: profileIssue(ctx, settings),
      profiles: (ctx.extensionSettings.connectionManager?.profiles ?? []).map(p => ({ id: p.id, name: p.name ?? p.id, cc: p.mode === 'cc' })),
      // The drawer's import banner (SPEC §28) is dismissed per chat.
      legacyBannerHidden: store.legacyBannerHidden === true,
      name1: ctx.name1, name2: ctx.name2 };
  }

  function injection(view, ctx) {
    const sections = getSections(view.settings, enabledPacks(view.store, view.settings));
    const hasState = sections.some(s => view.injectedEntry?.state[s.id] !== undefined && view.modes[s.id] === 'inject');
    const rollArmed = armed !== null && armed === view.store.roll?.consumedBy;
    // Too far behind the chat: nothing at all, the model reads the messages instead (SPEC §32).
    if (view.lag > MAX_INJECT_LAG) return '';
    return view.settings.enabled && !isGroup(ctx) && (hasState || (view.store.roll && (view.store.roll.consumedAt == null || rollArmed)))
      ? buildDigest(view.injectedEntry?.state, view.modes, { sections, language: view.settings.language,
        order: view.settings.order, userName: ctx.name1, roll: view.store.roll, rollArmed,
        lag: view.lag, asOf: view.injectedEntry?.mesId }) : '';
  }

  // The story model's notebook (SPEC §36): its own prompt, only while the section injects and the state is fresh enough.
  function secretsText(view, ctx) {
    if (!view.settings.enabled || isGroup(ctx) || view.modes.secrets !== 'inject' || view.lag > MAX_INJECT_LAG) return '';
    return buildSecretsPrompt(view.injectedEntry?.state.secrets, { language: view.settings.language, rules: view.settings.prompts?.sections?.secrets });
  }

  function publish() {
    const ctx = getContext(), view = snapshot(), text = injection(view, ctx);
    const role = Math.max(0, ROLES.indexOf(view.settings.role));
    // The notebook goes first, so the digest stays the last prompt set (tests and tools read the last call), and only
    // when its text or place changed: most publishes do not touch it.
    const notebook = JSON.stringify([secretsText(view, ctx), view.settings.depth, role]);
    if (notebook !== secretsSent) { secretsSent = notebook; ctx.setExtensionPrompt('sable_trackers_secrets', JSON.parse(notebook)[0], 1, view.settings.depth, false, role); }
    ctx.setExtensionPrompt('sable_trackers', text, 1, view.settings.depth, false, role);
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
    const base = currentEntry(data, ctx.chat, mesId, { skipStale: true });
    // Failed or superseded requests between snapshots still count as replies.
    const elapsed = base ? ctx.chat.slice(base.mesId + 1, mesId + 1).filter(characterMessage).length : 1;
    const turn = (base?.turn ?? 0) + elapsed;
    const packIds = enabledPacks(data, settings);
    const sections = getSections(settings, packIds);
    const counters = Object.fromEntries(sections.map(s => [s.id, (base?.turnsSince?.[s.id] ?? 0) + elapsed]));
    const modes = effectiveModes(settings, data);
    const dueSections = sections.filter(s => modes[s.id] !== 'off'
      && (force || s.id === 'dossiers' || counters[s.id] >= Math.max(1, s.custom && !s.pack ? s.period : settings.sections[s.id].period))).map(s => s.id);
    const built = buildPrompt({ settings: { ...settings, language: settings.language === 'en' ? 'English' : 'Russian' },
      sections, packs: getPacks(settings).filter(p => packIds.includes(p.id)), modes, dueSections, previousState: base?.state ?? {},
      card: ctx.substituteParams('{{description}}\n{{personality}}\n{{scenario}}'),
      persona: ctx.substituteParams('{{persona}}'), lore,
      chat: ctx.chat.slice(0, mesId + 1).filter(m => !m.is_system), userName: ctx.name1, characterName: ctx.name2 });
    return { settings, data, base, elapsed, turn, sections, counters, modes, dueSections, built };
  }

  function preview() {
    const ctx = getContext(), mesId = lastCharacterId(ctx);
    if (!loadSettings(ctx).enabled || isGroup(ctx) || mesId < 0) return null;
    const { built, settings, data, modes } = prepare(mesId, true);
    return { mesId, ...built, injection: injection({ settings, store: data, modes, ...chooseInjected(data, ctx) }, ctx), chars: built.messages.reduce((sum, m) => sum + m.content.length, 0) };
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
      const issue = profileIssue(ctx, settings);
      if (issue) { warn(issue, settings); return; }
      warnedProfile = false;
      lastFingerprint = fingerprint;
      const { base, turn, sections, counters, dueSections, built } = prepare(mesId, force);
      // Refresh replaces this ring entry; preserve disabled pack values already stored in it.
      const previousState = { ...base?.state };
      const cached = findEntry(data, mesId, swipeId);
      // The notebook for this reply came with the message (SPEC §36); the side model never writes it.
      if (cached?.state.secrets !== undefined) previousState.secrets = cached.state.secrets;
      for (const pack of getPacks(settings).filter(p => !sections.some(s => s.pack === p.id))) {
        for (const section of pack.sections) {
          const id = `${pack.id}_${section.key}`;
          if (cached?.state[id] !== undefined) previousState[id] = cached.state[id];
        }
      }
      entry = { at: lastLogAt = Math.max(Date.now(), lastLogAt + 1), chatId: ctx.getCurrentChatId(), mesId, swipeId,
        ms: 0, status: 'skipped', requestedSections: built.requestedSections, validSections: [], warnings: [],
        error: null, request: null, response: null, inChars: 0, outChars: 0 };
      if (!dueSections.length) {
        // Advance the cadence even when only slow sections are enabled.
        const state = mergeState(previousState, {}, { sections, requestedSections: [],
          meta: { turn, updatedAt: Date.now(), forMesId: mesId, forSwipeId: swipeId } });
        putEntry(data, { mesId, swipeId, turn, state, turnsSince: counters }, settings.keep);
        carrySecretsMeta(cached, findEntry(data, mesId, swipeId));
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
      const send = payload => ctx.ConnectionManagerRequestService.sendRequest(settings.profileId, built.messages, settings.maxTokens,
        { stream: false, extractData: true, includePreset: false, signal: request.controller.signal }, payload);
      const payload = noReasoning.has(settings.profileId) ? {} : reasoningPayload(settings);
      let result;
      try {
        result = await send(payload);
      } catch (error) {
        // One retry without the reasoning payload; a second failure falls through to the error handling below.
        if (!Object.keys(payload).length || !ownsRequest() || !isParameterRejection(error)) throw error;
        noReasoning.add(settings.profileId);
        entry.retried = 'no-reasoning';
        entry.warnings = [t('reasoningRejected', settings.language)];
        try { console.warn('Sable Trackers: reasoning parameters rejected, retrying without them', error); } catch {}
        result = await send({});
      }
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
      entry.warnings = [...entry.warnings, ...parsed.warnings]; entry.validSections = parsed.validSections;
      for (const warning of parsed.warnings) console.warn(`Sable Trackers: ${warning}`);
      const problem = outputProblem(result, parsed);
      if (problem) {
        // Specific reasons reach both the log entry and the status footer (SPEC §31).
        const error = new Error(problem === 'cut' ? t('cutOutput', settings.language).replace('{n}', settings.maxTokens)
          : problem === 'broken' ? t('brokenOutput', settings.language) : t('emptyOutput', settings.language));
        error.shown = true;
        record('invalid', error);
        throw error;
      }
      if (!parsed.ok || !parsed.validSections.length) { record('invalid'); throw new Error(t('invalidOutput', settings.language)); }
      const state = mergeState(previousState, parsed, { sections, requestedSections: built.requestedSections,
        meta: { turn, updatedAt: Date.now(), forMesId: mesId, forSwipeId: swipeId } });
      for (const id of parsed.validSections) counters[id] = 0;
      putEntry(current, { mesId, swipeId, turn, state, turnsSince: counters }, settings.keep);
      carrySecretsMeta(cached, findEntry(current, mesId, swipeId));
      recordHistory(current, state.bonds, mesId, bondScales(settings).map(scale => scale.key));
      for (const section of sections) if (isStats(section)) recordStatHistory(current, section.id, state[section.id], mesId);
      const content = typeof result === 'string' ? result : result.content;
      current.lastRun = { mesId, ok: true, at: Date.now(), ms: Date.now() - started,
        inTok: Math.ceil(built.messages.reduce((sum, m) => sum + m.content.length, 0) / 4), outTok: Math.ceil(content.length / 4) };
      record('ok');
      // The first successful run ends the first-run hints (SPEC §27).
      if (!settings.hints.done) saveSettings(getContext(), { hints: { done: true } });
      settle();
      await saveStore(getContext());
    } catch (error) {
      if (request && (!ownsRequest() || error?.name === 'AbortError')) { record('dropped'); settle(); return; }
      record(request && !stillCurrent() ? 'dropped' : 'failed', error);
      loadStore(getContext()).lastRun = { mesId, ok: false, at: Date.now(), ms: Date.now() - started,
        error: request && !stillCurrent() ? t('runDropped', settings.language) : error?.shown ? error.message : t('runFailed', settings.language) };
      try { console.warn('Sable Trackers: request failed', error); } catch {}
      settle();
      await saveStore(getContext());
    } finally {
      if (request && active === request) { active = undefined; publish(); }
    }
  }

  function swipe(mesId) {
    const ctx = getContext();
    if (mesId !== lastCharacterId(ctx)) return endRewrite(true);
    endRewrite();
    cancel(); lastFingerprint = undefined;
    const data = loadStore(ctx);
    armed = data.roll?.consumedBy === mesId ? mesId : null;
    const entry = findEntry(data, mesId, ctx.chat[mesId]?.swipe_id ?? 0);
    restoreCounters(data, entry ?? currentEntry(data, ctx.chat, mesId));
    // Cached swipes need no side-model request when MESSAGE_RECEIVED follows.
    if (entry && !entry.stale) lastFingerprint = JSON.stringify([ctx.getCurrentChatId(), mesId, entry.swipeId, ctx.chat[mesId].mes]);
    publish();
    return saveStore(ctx);
  }

  function deleted(newChatLength) {
    armed = null; endRewrite();
    cancel(); lastFingerprint = undefined;
    const ctx = getContext(), data = loadStore(ctx);
    const length = Math.min(ctx.chat.length, newChatLength);
    pruneEntries(data, length);
    pruneHistory(data, length);
    if (data.roll && length <= data.roll.forMesId) delete data.roll;
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
    // No automatic request: the drawer's stale status offers «⟳ Recompute» (SPEC §27).
    return saveStore(ctx);
  }

  function chatChanged() {
    armed = null; endRewrite();
    cancel(); lore = []; lastFingerprint = undefined; warnedProfile = false;
    publish();
  }

  function updateSettings(patch) {
    if (['enabled', 'profileId', 'language', 'customSections', 'packs'].some(key => Object.hasOwn(patch, key))) {
      cancel(); lastFingerprint = undefined; warnedProfile = false;
    }
    saveSettings(getContext(), patch);
    publish();
  }

  // The streaming guard (SPEC §36): one display-only regex script in SillyTavern's regex list, added once when the
  // secrets section is first switched on; the only write outside the extension's own settings. Never re-added after
  // the user deletes it unless asked (`force`, the settings button).
  function installSecretsRegex({ force = false } = {}) {
    const ctx = getContext(), settings = loadSettings(ctx);
    if (!force && settings.secretsRegexInstalled) return 'skipped';
    const list = Array.isArray(ctx.extensionSettings.regex) ? ctx.extensionSettings.regex : (ctx.extensionSettings.regex = []);
    let status = 'exists';
    if (!list.some(script => script?.scriptName === SECRETS_REGEX_NAME)) {
      const id = globalThis.crypto?.randomUUID?.() ?? `r_${Math.floor(random() * 2 ** 32).toString(16)}`;
      list.push({ id, scriptName: SECRETS_REGEX_NAME, findRegex: '/<sable_secrets>[\\s\\S]*?(?:<\\/sable_secrets>|$)/i', replaceString: '',
        trimStrings: [], placement: [2], disabled: false, markdownOnly: true, promptOnly: false, runOnEdit: true,
        substituteRegex: 0, minDepth: null, maxDepth: null });
      status = 'added';
    }
    saveSettings(ctx, { secretsRegexInstalled: true });
    return status;
  }
  function setMode(id, mode, chatOnly = loadSettings(getContext()).perChatOverrides) {
    // null removes a chat override so the global mode becomes effective again.
    const ctx = getContext(), settings = loadSettings(ctx), data = loadStore(ctx);
    if (!getSections(settings, enabledPacks(data, settings)).some(s => s.id === id) || (!(mode === null && chatOnly) && !['inject', 'show', 'off'].includes(mode))) return;
    if (chatOnly) {
      if (mode === null) delete loadStore(ctx).modeOverride[id];
      else loadStore(ctx).modeOverride[id] = mode;
      void saveStore(ctx);
    } else saveSettings(ctx, { sections: { [id]: { mode } } });
    if (id === 'secrets' && mode === 'inject') installSecretsRegex();
    publish();
  }

  /** Writes one mode to every section of an enabled pack at once (the drawer's group chip, SPEC §15), with the same
   *  per-chat override semantics as setMode: one store or settings write, one publish. */
  function setPackMode(packId, mode, chatOnly = loadSettings(getContext()).perChatOverrides) {
    const ctx = getContext(), settings = loadSettings(ctx), data = loadStore(ctx);
    const pack = getPacks(settings).find(item => item.id === packId);
    if (!pack || !enabledPacks(data, settings).includes(packId) || (!(mode === null && chatOnly) && !['inject', 'show', 'off'].includes(mode))) return false;
    const ids = pack.sections.map(s => `${packId}_${s.key}`);
    if (chatOnly) {
      for (const id of ids) { if (mode === null) delete data.modeOverride[id]; else data.modeOverride[id] = mode; }
      void saveStore(ctx);
    } else saveSettings(ctx, { sections: Object.fromEntries(ids.map(id => [id, { mode }])) });
    publish();
    return true;
  }

  function setFolderMode(folderId, mode, chatOnly = loadSettings(getContext()).perChatOverrides) {
    const folder = loadSettings(getContext()).folders.find(item => item.id === folderId);
    return !!folder && setSectionsMode(folder.members, mode, chatOnly);
  }

  /** Several sections in one write (the People group, SPEC §21), with the per-chat override semantics of setPackMode. */
  function setSectionsMode(ids, mode, chatOnly = loadSettings(getContext()).perChatOverrides) {
    const ctx = getContext(), data = loadStore(ctx);
    if (!Array.isArray(ids) || (!(mode === null && chatOnly) && !['inject', 'show', 'off'].includes(mode))) return false;
    if (chatOnly) {
      for (const id of ids) { if (mode === null) delete data.modeOverride[id]; else data.modeOverride[id] = mode; }
      void saveStore(ctx);
    } else saveSettings(ctx, { sections: Object.fromEntries(ids.map(id => [id, { mode }])) });
    publish();
    return true;
  }

  function setPack(id, on) {
    const ctx = getContext(), settings = loadSettings(ctx), data = loadStore(ctx);
    if (!getPacks(settings).some(pack => pack.id === id)) return false;
    const ids = Array.isArray(data.packs) ? data.packs : settings.packDefaults;
    data.packs = [...new Set(on ? [...ids, id] : ids.filter(value => value !== id))];
    void saveStore(ctx);
    publish();
    return true;
  }

  function rollDice(sectionId, key, chance) {
    const ctx = getContext(), settings = loadSettings(ctx), data = loadStore(ctx);
    const section = getSections(settings, enabledPacks(data, settings)).find(s => s.id === sectionId);
    const forMesId = lastCharacterId(ctx);
    if (!section || !['stats', 'kv'].includes(section.shape) || !Number.isFinite(chance)
      || typeof key !== 'string' || !key.trim() || forMesId < 0) return false;
    const result = { sectionId, key, label: key.replace(/\s*%$/, '').trim() || key,
      ...roll(Math.min(100, Math.max(0, chance)), random), forMesId, at: Date.now() };
    armed = null;
    data.roll = result;
    void saveStore(ctx);
    publish();
    return result;
  }

  function received(id, type) {
    const ctx = getContext(), data = loadStore(ctx);
    const disarmed = armed !== null && armed === id;
    if (disarmed) armed = null;
    endRewrite(true);
    if (Number.isInteger(id) && characterMessage(ctx.chat[id]) && data.roll
      && id > data.roll.forMesId && data.roll.consumedAt == null) {
      data.roll.consumedAt = Date.now();
      data.roll.consumedBy = id;
      void saveStore(ctx);
      publish();
    } else if (disarmed) publish();
    noteSecrets(ctx, data, id);
    void run(id, { type });
  }


  /** The story model's notebook block (SPEC §36): cut from the reply the moment it arrives and kept in this reply's entry,
   *  before the side model runs and whether or not a profile is set. SillyTavern saves the chat right after
   *  MESSAGE_RECEIVED, so the cut text is what the file keeps; `swipes[]` is cut too, or a swipe back would restore it. */
  function noteSecrets(ctx, data, mesId) {
    const message = ctx.chat[mesId];
    if (!Number.isInteger(mesId) || !characterMessage(message) || isGroup(ctx) || typeof message.mes !== 'string') return false;
    const { text, block } = cutSecrets(message.mes);
    if (!block) return false;
    message.mes = text;
    if (Array.isArray(message.swipes)) message.swipes[message.swipe_id ?? 0] = text;
    const settings = loadSettings(ctx), swipeId = message.swipe_id ?? 0;
    const base = currentEntry(data, ctx.chat, mesId, { skipStale: true });
    let entry = findEntry(data, mesId, swipeId);
    const { secrets, notes, applied } = applySecrets(entry?.state.secrets ?? base?.state.secrets, parseSecretsBlock(block).ops,
      { mesId, prose: text, applied: entry?.secretsLines ?? [] });
    if (!entry) {
      // A provisional entry: the state before this reply plus its notebook; the side-model run replaces it and keeps the notebook.
      const turn = ctx.chat.slice(0, mesId + 1).filter(characterMessage).length;
      putEntry(data, { mesId, swipeId, turn, turnsSince: structuredClone(data.turnsSince),
        state: { ...(base?.state ?? {}), meta: { turn, updatedAt: Date.now(), forMesId: mesId, forSwipeId: swipeId } } }, settings.keep);
      entry = findEntry(data, mesId, swipeId);
    }
    entry.state.secrets = secrets; entry.secretsLines = applied; entry.secretsNotes = notes;
    delete entry.stale;
    publish();
    void saveStore(ctx);
    return true;
  }
  // `secretsLines` / `secretsNotes` live on the entry, which putEntry rebuilds: carry them over.
  const carrySecretsMeta = (from, to) => {
    if (!from || !to || from === to) return;
    if (from.secretsLines) to.secretsLines = from.secretsLines;
    if (from.secretsNotes) to.secretsNotes = from.secretsNotes;
  };

  /** Manual edit of several sections at once (SPEC §25): `values = { [sectionId]: value }`, all or nothing. Every value
   *  goes through the section schema; an unknown section or an invalid value returns false and writes nothing.
   *  `history` (optional) = `{ [bondId]: lines | null }`: null drops that bond's history (person delete), an object puts
   *  it back (undo). One cancel, one history record, one publish, one save. */
  function editSections(values, { history } = {}) {
    const ctx = getContext(), settings = loadSettings(ctx), data = loadStore(ctx);
    if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) return false;
    const registry = getSections(settings, enabledPacks(data, settings)), cleaned = {};
    for (const [id, value] of Object.entries(values)) {
      const section = registry.find(item => item.id === id), result = sanitizeSection(section, value);
      if (!section || result === undefined) return false;
      cleaned[id] = result;
    }
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
    Object.assign(entry.state, cleaned);
    entry.state.meta = { ...entry.state.meta, editedAt: Date.now() };
    delete entry.stale;
    if (history && typeof history === 'object') {
      for (const [id, lines] of Object.entries(history)) {
        if (lines && typeof lines === 'object') (data.history ??= {})[id] = structuredClone(lines);
        else if (data.history) delete data.history[id];
      }
    }
    if (cleaned.bonds) recordHistory(data, cleaned.bonds, entry.mesId, bondScales(settings).map(scale => scale.key));
    for (const id of Object.keys(cleaned)) {
      if (isStats(registry.find(item => item.id === id))) recordStatHistory(data, id, cleaned[id], entry.mesId);
    }
    publish();
    void saveStore(ctx);
    return true;
  }

  /** Manual edit of one section (SPEC §13): a wrapper over editSections. */
  const editState = (id, value) => editSections({ [id]: value });

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

  /** «Скрыть» on the legacy import banner (SPEC §28): one per-chat flag, nothing else changes. */
  function hideLegacyBanner() {
    const ctx = getContext(), data = loadStore(ctx);
    if (data.legacyBannerHidden === true) return false;
    data.legacyBannerHidden = true;
    publish();
    void saveStore(ctx);
    return true;
  }

  function start() {
    if (bindings.length) return;
    const ctx = getContext();
    const handlers = {
      MESSAGE_RECEIVED: received, MESSAGE_SWIPED: swipe,
      MESSAGE_SENT: () => { armed = null; publish(); },
      MESSAGE_DELETED: deleted, MESSAGE_EDITED: edited, CHAT_CHANGED: chatChanged,
      // Before SillyTavern combines the prompts (dry runs too): pick the entry for this generation (SPEC §32).
      GENERATION_STARTED: type => { rewriting = REWRITE_TYPES.has(type); publish(); },
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
    snapshot, publish, updateSettings, setMode, setPackMode, setFolderMode, setSectionsMode, setPack, seedLegacy, hideLegacyBanner, editState, editSections, rollDice, installSecretsRegex,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { cancel(); bindings.splice(0).forEach(remove => remove()); listeners.clear(); },
  };
}
