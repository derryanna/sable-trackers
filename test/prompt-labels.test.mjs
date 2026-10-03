import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/prompt.js';

test('the data message names who is who: the card is the AI character, the persona is the user', () => {
  const { messages } = buildPrompt({ settings: {}, card: 'Tall, grey eyes.', persona: 'Short, green eyes.', userName: 'Maren', characterName: 'Tomas', chat: [] });
  const data = messages[1].content;
  assert.match(data, /^CHARACTER CARD \(Tomas: the AI's character, an NPC, not the user\):\nTall, grey eyes\./);
  assert.match(data, /\n\nUSER PERSONA \(Maren: the user's own character, the one the world\.pc fields describe\):\nShort, green eyes\./);
  assert.ok(data.indexOf('CHARACTER CARD') < data.indexOf('USER PERSONA') && data.indexOf('USER PERSONA') < data.indexOf('LORE (activated last turn)'));
  assert.equal(messages[1].role, 'user');
});

test('missing names fall back to User / Character', () => {
  const { messages } = buildPrompt({ settings: {}, card: '', persona: '', chat: [] });
  assert.match(messages[1].content, /^CHARACTER CARD \(Character: /);
  assert.match(messages[1].content, /USER PERSONA \(User: /);
});
