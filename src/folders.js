import { icon } from './packs/index.js';
import { getAllSections, groupedOrder } from './sections.js';

export function normalizeFolders(value, sections) {
  const ids = new Set(sections.filter(s => !s.pack).map(s => s.id)), used = new Set(), claimed = new Set(), result = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || typeof item.id !== 'string' || !/^f_[0-9a-f]{8}$/.test(item.id) || used.has(item.id)) continue;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 40).trim() : '';
    if (!title) continue;
    const members = [];
    for (const id of Array.isArray(item.members) ? item.members : []) {
      if (!ids.has(id) || claimed.has(id)) continue;
      members.push(id); claimed.add(id);
      if (members.length === 20) break;
    }
    used.add(item.id); result.push({ id: item.id, title, icon: icon(item.icon), members });
    if (result.length === 12) break;
  }
  return result;
}

/** Membership is a set; the flat order alone determines each block's member order. */
export function moveToFolder(settings, sectionId, targetId) {
  const folders = settings.folders.map(folder => ({ ...folder, members: [...folder.members] }));
  const sections = getAllSections(settings), old = folders.find(folder => folder.members.includes(sectionId));
  const target = folders.find(folder => folder.id === targetId);
  const unchanged = () => ({ folders, order: [...settings.order] });
  if (!sections.some(s => s.id === sectionId && !s.pack) || (targetId !== null && !target)
    || target === old || (target && target.members.length >= 20)) return unchanged();
  const orderedSections = sections.filter(s => !s.pack || settings.order.includes(s.id));
  const order = groupedOrder(settings.order, orderedSections, undefined, folders);
  const anchor = (target ?? old)?.members.filter(id => id !== sectionId) ?? [];
  const remaining = order.filter(id => id !== sectionId);
  const last = remaining.findLastIndex(id => anchor.includes(id));
  const position = last >= 0 ? last + 1 : order.indexOf(sectionId);
  remaining.splice(position, 0, sectionId);
  if (old) old.members = old.members.filter(id => id !== sectionId);
  if (target) target.members.push(sectionId);
  return { folders, order: remaining };
}
