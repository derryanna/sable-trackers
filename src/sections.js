const s = (max = 500) => ({ type: 'string', max });
const npcBase = { id: s(80), name: s(120) };
const scales = ['affection', 'trust', 'desire', 'reputation', 'suspicion', 'respect', 'fear', 'grudge', 'tension'];

export const SECTION_ORDER = ['world', 'offscreen', 'threads', 'story', 'npcs', 'thoughts', 'bonds', 'dossiers', 'planner', 'banlist'];

const definitions = {
  world: { icon: '🌍', defaultMode: 'inject', period: 1, schema: { type: 'object', fields: { time:s(), location:s(), weather:s(), summary:s(800), pc:{ type:'object', fields:{ outfit:s(), position:s(), visible_condition:s(), carrying:s() } } } }, instructions: 'Record only known time, location, weather and visible user-character state. Unknown stays unknown; never invent user thoughts or actions.' },
  offscreen: { icon: '👥', defaultMode: 'show', period: 1, schema: { type:'array', max:8, item:{ type:'object', fields:{ name:s(120), doing:s(500) }, required:['name'] } }, instructions: 'Keep at most 8 absent known NPCs. State current activity only when established or strongly implied; otherwise use the last known activity.' },
  threads: { icon: '🧵', defaultMode: 'inject', period: 1, schema: { type:'array', max:6, item:{ type:'object', fields:{ text:s(500), priority:{ type:'enum', values:['high','mid','low'], fallback:'mid' } }, required:['text','priority'] } }, instructions: 'Keep at most 6 unresolved questions or conflicts. Do not invent new events.' },
  story: { icon: '🌱', defaultMode: 'inject', period: 1, schema: { type:'object', fields:{ seeds:{type:'array',max:6,item:{type:'object',fields:{text:s(500),planted_turn:{type:'integer',min:0,max:100000}},required:['text']}}, timers:{type:'array',max:4,item:{type:'object',fields:{text:s(500),due:s(120)},required:['text']}}, arc_phase:s(120), scene_phase:s(120) } }, instructions: 'Track planted but unpaid seeds, established in-world deadlines, and short arc/scene phase labels. Do not invent timers.' },
  npcs: { icon: '🎭', defaultMode: 'inject', period: 1, schema: { type:'array',max:50,item:{type:'object',fields:{...npcBase,present:{type:'boolean'},outfit:s(),position:s(),mood:s(160),agenda:s(),action:s(),wants_toward:s(120),secret:s()},required:['id']} }, instructions: 'Keep stable ids and all known NPCs; add new NPCs only after they appear in the story. User character is not an NPC. present is true only in the current scene; absent NPCs retain last known data without invented off-screen activity. outfit/position/action describe established visible facts; mood is emotion. Desire is not action. agenda is a concrete intention now; wants_toward is its target. secret contains only already-established hidden knowledge or intentions; never invent facts to fill it. Preserve disguises and knowledge boundaries.' },
  thoughts: { icon: '💭', defaultMode: 'show', period: 1, schema: { type:'array',max:50,item:{type:'object',fields:{...npcBase,thought:s(240)},required:['id','thought']} }, instructions: 'For present NPCs only, write one private first-person thought of at most 30 words. Preserve knowledge boundaries.' },
  bonds: { icon: '🤝', defaultMode: 'inject', period: 1, schema: { type:'array',max:50,item:{type:'object',fields:{...npcBase,toward:s(120),stats:{type:'object',fields:Object.fromEntries(scales.map(k=>[k,{type:'score'}]))},changes:{type:'changes'},legacy_stats:{type:'object',allowUnknown:true}},required:['id']} }, instructions: 'Independent scales toward the named target only: affection = emotional attachment, not necessarily romance; trust = confidence and willingness to rely; desire = attraction toward toward, not love or general arousal; reputation = how this NPC rates toward, not global fame; suspicion = suspicion toward toward; respect = respect for toward; fear = fear of toward; grudge = resentment toward toward, not general anger; tension = current tension with toward, which can drop independently of affection. Known scores are integers 0-100: 0 means known absence, null means unknown. Do not fill everything with 50. Keep the previous known value without new basis; derive new starting values cautiously from canon. Change by at most 10 per reply unless a clearly major event warrants more; no automatic affection growth. desire = null for minors, without sexual interpretations. changes contains changed scales only, with short concrete reasons; return {} if unchanged.' },
  dossiers: { icon: '📇', defaultMode: 'show', period: 0, schema: { type:'array',max:50,item:{type:'object',fields:{name:s(120),role:s(300),look:s(300),voice:s(300),hook:s(300)},required:['name']} }, instructions: 'Add a one-sentence dossier only for a newly named NPC in LAST MESSAGES whose name is not in EXISTING DOSSIER NAMES. Never rewrite existing dossiers; return [] when none.' },
  planner: { icon: '🧭', defaultMode: 'show', period: 5, schema: { type:'object',fields:{beats:{type:'array',max:3,item:{type:'object',fields:{beat:s(500),why:s(500)},required:['beat']}},remember:s(500)} }, instructions: 'Offer 2–3 possible next beats grounded in canon and one short reminder; do not continue the scene.' },
  banlist: { icon: '🚫', defaultMode: 'inject', period: 3, schema: { type:'array',max:8,item:{type:'object',fields:{pattern:s(300),example:s(300)},required:['pattern']} }, instructions: 'List repeated phrases or rhetorical patterns from recent replies. Keep it concise.' },
};

export const SECTIONS = Object.freeze(SECTION_ORDER.map(id => Object.freeze({ id, title: `section.${id}`, ...definitions[id] })));
export const SECTION_MAP = Object.freeze(Object.fromEntries(SECTIONS.map(section => [section.id, section])));
export const BOND_SCALES = Object.freeze(scales);
export function getSection(id) { return SECTION_MAP[id]; }

export function normalizeCustomSections(value) {
  const used = new Set();
  return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => {
    let id = item.id;
    while (typeof id !== 'string' || !/^c_[0-9a-f]{8}$/.test(id) || used.has(id)) {
      id = 'c_' + Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
    }
    used.add(id);
    const text = key => typeof item[key] === 'string' ? item[key].trim() : '';
    return { id, title: text('title'), icon: text('icon'), instructions: text('instructions'),
      shape: ['text', 'list', 'kv'].includes(item.shape) ? item.shape : 'text',
      max: Number.isFinite(Number(item.max)) ? Math.max(1, Math.min(20, Math.floor(Number(item.max)))) : 8,
      mode: ['inject', 'show', 'off'].includes(item.mode) ? item.mode : 'inject',
      period: Number.isInteger(item.period) && item.period >= 0 ? item.period : 1 };
  });
}

export function getSections(settings = {}) {
  return [...SECTIONS, ...normalizeCustomSections(settings.customSections).map(item => ({
    ...item, custom: true, defaultMode: item.mode,
    schema: item.shape === 'text' ? s(600) : { type: 'array', max: item.max,
      item: item.shape === 'list' ? s(200) : { type: 'object', fields: { key: s(60), value: s(200) }, required: ['key', 'value'] } },
  }))];
}

export function orderedSectionIds(order, sections = SECTIONS) {
  const ids = sections.map(section => section.id);
  return [...new Set([...(Array.isArray(order) ? order : []), ...ids])].filter(id => ids.includes(id));
}
