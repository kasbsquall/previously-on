const WORD = /[a-z0-9']+/gi;
const INSTRUCTION_LIKE_CHAT = /^\s*(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above)\s+instructions\b/i;

export function buildFallback({ items, channel, windowMinutes = 10 }) {
  const bullets = [];
  const mostRecent = kind => [...items].reverse().find(item => item.kind === kind);
  for (const item of [mostRecent('event'), mostRecent('voice'), pickMostRepetitiveChat(items)]) {
    if (!item || bullets.some(bullet => bullet.sources.includes(item.id))) continue;
    bullets.push({ text: capitalize(truncate(item.text, 90)), sources: [item.id] });
  }
  return { headline: `The last ${windowMinutes} min on stream`, bullets };
}

function pickMostRepetitiveChat(items) {
  let winner;
  let score = -1;
  for (const item of items.filter(source => source.kind === 'chat' && !INSTRUCTION_LIKE_CHAT.test(source.text))) {
    const counts = new Map();
    for (const word of item.text.match(WORD) ?? []) {
      const normalized = word.toLowerCase();
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    const repeated = Math.max(0, ...counts.values());
    if (repeated > score) {
      winner = item;
      score = repeated;
    }
  }
  return winner;
}

function truncate(text, length) {
  return String(text ?? '').slice(0, length);
}

function capitalize(text) {
  return text.replace(/[a-z]/i, character => character.toLocaleUpperCase('en-US'));
}
