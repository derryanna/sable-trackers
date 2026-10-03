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

const orderedSections = settings => getAllSections(settings).filter(s => !s.pack || settings.order.includes(s.id));
/** Drop targets of one block in grouped order, without `skip`: a folder's members one by one, or (folderId null) the
 *  top-level blocks, each a flat id or a whole pack/folder block. */
export function dropBlocks(settings, folderId, skip) {
  const order = groupedOrder(settings.order, orderedSections(settings), undefined, settings.folders).filter(id => id !== skip);
  if (folderId !== null) {
    const members = settings.folders.find(folder => folder.id === folderId)?.members ?? [];
    return order.filter(id => members.includes(id)).map(id => [id]);
  }
  const blockOf = id => {
    const section = getAllSections(settings).find(s => s.id === id);
    if (section?.pack) return `pack:${section.pack}`;
    const folder = settings.folders.find(item => item.members.includes(id));
    return folder ? `folder:${folder.id}` : id;
  };
  const blocks = [];
  let last;
  for (const id of order) {
    const key = blockOf(id);
    if (key === last) blocks.at(-1).push(id); else blocks.push([id]);
    last = key;
  }
  return blocks;
}

/** SPEC §24: one drop = moveToFolder, then a move inside the target block. `index` counts the target block's members
 *  (top-level blocks for folderId null) in grouped order without the dropped card; Infinity = the end. Returns
 *  `{ folders, order }`, or null for an illegal drop. */
export function planDrop(settings, sectionId, { folderId = null, index = Infinity } = {}) {
  if (!getAllSections(settings).some(s => s.id === sectionId && !s.pack)) return null;
  const target = folderId === null ? null : settings.folders.find(folder => folder.id === folderId);
  if (folderId !== null && !target) return null;
  const old = settings.folders.find(folder => folder.members.includes(sectionId));
  if (target && target !== old && target.members.length >= 20) return null;
  const moved = moveToFolder(settings, sectionId, folderId), next = { ...settings, ...moved };
  const blocks = dropBlocks(next, folderId, sectionId);
  // An empty folder gains the card where moveToFolder left it.
  if (!blocks.length) return moved;
  const order = groupedOrder(next.order, orderedSections(next), undefined, next.folders).filter(id => id !== sectionId);
  const at = Math.max(0, Number.isFinite(index) ? Math.floor(index) : blocks.length);
  order.splice(at < blocks.length ? order.indexOf(blocks[at][0]) : order.indexOf(blocks.at(-1).at(-1)) + 1, 0, sectionId);
  return { folders: moved.folders, order };
}

/** The drop index in `dropBlocks(...)` of the block holding `anchorId` after the card has moved (Infinity = the end). */
export function dropIndex(settings, sectionId, folderId, anchorId) {
  if (anchorId === undefined || anchorId === null) return Infinity;
  const target = folderId === null || settings.folders.some(folder => folder.id === folderId);
  if (!target) return Infinity;
  const next = { ...settings, ...moveToFolder(settings, sectionId, folderId) };
  const index = dropBlocks(next, folderId, sectionId).findIndex(block => block.includes(anchorId));
  return index < 0 ? Infinity : index;
}

/** Pure geometry: the slot index for pointer `y` among member rectangles `{ top, height }` (or `{ top, bottom }`),
 *  top to bottom: the first member whose middle lies below the pointer, or the end. */
export function slotFor(rects, y) {
  const index = rects.findIndex(rect => y < rect.top + ((rect.height ?? (rect.bottom - rect.top)) / 2));
  return index < 0 ? rects.length : index;
}
