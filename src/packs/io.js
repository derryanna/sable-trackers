import { BUILTIN_PACKS, normalizePacks } from './index.js';
import { t } from '../i18n.js';

function newId(random, existing = []) {
  let number = Math.floor(random() * 0x100000000) >>> 0;
  const used = new Set(existing.map(pack => pack.id));
  while (used.has('p_' + number.toString(16).padStart(8, '0'))) number = (number + 1) >>> 0;
  return 'p_' + number.toString(16).padStart(8, '0');
}

export function copyPack(pack, { random = Math.random, lang = 'ru' } = {}) {
  const builtin = BUILTIN_PACKS.some(p => p.id === pack.id);
  const literal = value => builtin ? t(value, lang) : value;
  return normalizePacks([{ ...pack, id: newId(random, [pack]), title: literal(pack.title), description: literal(pack.description),
    sections: pack.sections.map(s => ({ ...s, title: literal(s.title) })) }])[0];
}

export function exportPack(pack, options = {}) {
  return { format: 'sable-pack', version: 1, pack: BUILTIN_PACKS.some(p => p.id === pack.id) ? copyPack(pack, options) : normalizePacks([pack])[0] };
}

export function importPack(json, existingPacks = [], { random = Math.random } = {}) {
  let data;
  try { data = typeof json === 'string' ? JSON.parse(json.replace(/^\uFEFF/, '')) : json; } catch { return { error: 'format' }; }
  if (!data || data.format !== 'sable-pack' || data.version !== 1) return { error: 'format' };
  if (BUILTIN_PACKS.some(p => p.id === data.pack?.id)) return { error: 'builtin-id' };
  const pack = normalizePacks([data.pack])[0];
  if (!pack) return { error: 'invalid' };
  if (existingPacks.some(p => p.id === pack.id)) pack.id = newId(random, existingPacks);
  return { pack };
}
