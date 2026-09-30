const BLOCK_NAMES = 'plan|think|checklist|Blocks|details';

/** Remove private/helper markup from a chat message before it reaches the side model. */
export function cleanMessage(value) {
  let text = String(value ?? '');
  text = text.replace(new RegExp(`<(${BLOCK_NAMES})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), ' ');
  // An unclosed helper block owns the remainder of the message.
  text = text.replace(new RegExp(`<(?:${BLOCK_NAMES})\\b[^>]*>[\\s\\S]*$`, 'gi'), ' ');
  text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, ' ');
  text = text.replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export const clean = cleanMessage;
