import { SECTIONS, orderedSectionIds } from './sections.js';
import { formatRoll } from './packs/dice.js';
import { t } from './i18n.js';

const join = values => values.filter(value => value !== '' && value != null).join(' · ');
const clip = (value, max) => value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
const modeOf = (id, modes) => typeof modes?.[id] === 'string' ? modes[id] : modes?.[id]?.mode;
const signed = delta => delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`;

function customText(section, value) {
  if (section.shape === 'text') return value;
  if (section.shape === 'list') return value.join(' | ');
  if (section.shape === 'tags') return value.join(' · ');
  if (section.shape === 'stats') return value.map(item => {
    const note = [item.delta ? signed(item.delta) : '', item.note].filter(Boolean).join(' ');
    return `${item.key} ${item.value}${item.max == null ? '' : `/${item.max}`}${item.unit ? ` ${item.unit}` : ''}${note ? ` (${note})` : ''}`;
  }).join(' · ');
  return value.map(item => item.key + ': ' + item.value).join(' · ');
}

const renderers = {
  world(value, tr, options) {
    const lines = [`${tr('world')}: ${join([value.time, value.location, value.weather, value.summary])}`];
    if (value.pc) lines.push(`${tr('you')} (${options.userName ?? '{{user}}'}): ${join([value.pc.outfit, value.pc.position, value.pc.visible_condition, value.pc.carrying])}`);
    return lines.join('\n');
  },
  offscreen: (value, tr) => `${tr('offscreen')}: ${value.map(x => `${x.name} — ${x.doing}`).join(' | ')}`,
  threads: (value, tr) => `${tr('threads')}: ${value.map(x => `${x.priority === 'high' ? '(!)' : x.priority === 'mid' ? '(·)' : '(−)'} ${x.text}`).join(' | ')}`,
  story(value, tr, options) {
    const turn = Number(options.turn ?? options.state?.meta?.turn);
    return `${tr('story')}: ${join([
      ...(value.seeds ?? []).map(x => `🌱 ${x.text}${Number.isFinite(turn) && Number.isFinite(x.planted_turn) ? ` (${Math.max(0, turn - x.planted_turn)} ${tr('turns')})` : ''}`),
      ...(value.timers ?? []).map(x => `⏳ ${x.text}${x.due ? ` ${x.due}` : ''}`),
      value.arc_phase ? `arc: ${value.arc_phase}` : '', value.scene_phase ? `scene: ${value.scene_phase}` : '',
    ])}`;
  },
  npcs: (value, tr) => `${tr('npcs')}: ${value.map(x => `${x.name} (${x.present ? tr('here') : tr('away')}) — ${join([x.mood, x.agenda, x.action])}`).join(' | ')}`,
  thoughts: (value, tr) => `${tr('thoughts')}: ${value.map(x => `${x.name}: “${x.thought}”`).join(' | ')}`,
  bonds: (value, tr, options) => `${tr('bonds')}: ${value.map(x => `${x.name}${x.toward ? ` → ${x.toward}` : ''}: ${Object.entries(x.stats ?? {}).filter(([key,v]) => v != null && (!options.scales || Object.hasOwn(options.scales, key))).map(([key,v]) => { const c=x.changes?.[key]; return `${key} ${v}${c ? ` (${signed(c.delta)}${c.reason ? ` ${c.reason}` : ''})` : ''}`; }).join(', ')}`).join(' | ')}`,
  dossiers: (value, tr) => `${tr('dossiers')}: ${value.map(x => `${x.name} — ${join([x.role,x.look,x.voice,x.hook])}`).join(' | ')}`,
  planner: (value, tr) => `${tr('planner')}: ${join([...(value.beats ?? []).map((x,i)=>`${i+1}. ${x.beat}${x.why ? ` (${x.why})` : ''}`), value.remember ? `${tr('remember')}: ${value.remember}` : ''])}`,
  banlist: (value, tr) => `${tr('avoid')}: ${value.map(x => `“${x.example || x.pattern}”${x.example ? ` (${x.pattern})` : ''}`).join(' · ')}`,
};

/** Create compact injection text from inject-mode sections only. */
export function buildDigest(state = {}, modes = {}, options = {}) {
  const sections = options.sections ?? SECTIONS;
  const sectionMap = Object.fromEntries(sections.map(section => [section.id, section]));
  const language = options.language ?? 'ru';
  const tr = key => t(key, language);
  const maxChars = Math.min(options.maxChars ?? 6000, 6000);
  const lines = [`[${tr('digestHeader')}]`];
  for (const id of orderedSectionIds(options.order, sections)) {
    if ((modeOf(id, modes) ?? sectionMap[id]?.defaultMode) !== 'inject' || state[id] == null) continue;
    const section = sectionMap[id], value = state[id];
    // A definition's shape may change while its old value remains in the ring.
    if (section.custom && (section.shape === 'text' ? typeof value !== 'string' : !Array.isArray(value))) continue;
    const line = section.custom
      ? section.title.toUpperCase() + ': ' + customText(section, value)
      : renderers[id]?.(value, tr, { ...options, state, scales: id === 'bonds' ? section.schema?.item?.fields?.stats?.fields : undefined });
    if (line && line !== `${tr(id)}: `) lines.push(line);
  }
  const pending = options.roll && (options.roll.consumedAt == null || options.rollArmed) ? formatRoll(options.roll, options.roll.label) : '';
  if (!pending) return clip(lines.join('\n'), maxChars);
  // Reserve space for the one-shot result so truncating scene notes never loses the roll.
  const body = clip(lines.join('\n'), Math.max(0, maxChars - pending.length - 1));
  return clip(body ? body + '\n' + pending : pending, maxChars);
}

export const digest = buildDigest;
