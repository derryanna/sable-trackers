import { extractJson, parseStateOutput } from './parse.js';

/** Read only the active swipe; never migrate another swipe's cached extras. */
export function seedFromLegacy(chat) {
  if (!Array.isArray(chat)) return null;
  for (let mesId = chat.length - 1; mesId >= 0; mesId--) {
    const message = chat[mesId];
    if (!message || message.is_user || message.is_system) continue;
    const extra = message.swipe_info?.[message.swipe_id ?? 0]?.extra ?? message.extra;
    const normalized = extra?.sable_scene_v2?.normalized;
    const blocks = extra?.extblocks;
    for (const text of [normalized, typeof blocks === 'string' && /<sable_state\b/i.test(blocks) ? blocks : null]) {
      try {
        if (typeof text !== 'string') continue;
        const raw = JSON.parse(extractJson(text));
        if (raw?.version !== 2 || !Array.isArray(raw.npcs)) continue;
        const npcs = raw.npcs.filter(npc => npc && typeof npc === 'object');
        const parsed = parseStateOutput(JSON.stringify({ world: raw.world,
          threads: Array.isArray(raw.world?.threads) ? raw.world.threads.map(text => ({ text, priority: 'mid' })) : [],
          npcs, thoughts: npcs, bonds: npcs,
        }));
        if (parsed.ok) return { state: parsed.state, mesId };
      } catch { /* Corrupt legacy data must not interrupt the UI or older candidates. */ }
    }
  }
  return null;
}
