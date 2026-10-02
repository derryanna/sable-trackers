export function roll(chance, random = Math.random) {
  const value = Math.max(1, Math.min(100, Math.floor(random() * 100) + 1));
  return { roll: value, chance, hit: value <= chance };
}

// Canonical state text, not a UI label.
export function formatRoll(result, label) {
  return `ROLL: ${result.roll} vs ${label} ${result.chance} → ${result.hit ? 'hit' : 'miss'} (resolve the next action with it)`;
}
