import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_ITEMS = 2000;
const RECAP_MAX_ITEMS = 120;
const KINDS = new Set(['chat', 'voice', 'event', 'note']);

export function createSourceBuffer({ filePath = '.data/session.jsonl', maxItems = MAX_ITEMS } = {}) {
    maxItems = Math.min(MAX_ITEMS, Math.max(1, Math.trunc(Number(maxItems) || MAX_ITEMS)));
  const items = [];
  const ready = readFile(filePath, 'utf8').then(contents => {
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      if (KINDS.has(item.kind)) items.push(item);
    }
    if (items.length > maxItems) items.splice(0, items.length - maxItems);
  }).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });

  async function add(source) {
    await ready;
    if (!KINDS.has(source.kind)) throw new TypeError(`Unsupported source kind: ${source.kind}`);
    const item = {
      id: source.id ?? randomUUID(),
      t: source.t ?? new Date().toISOString(),
      kind: source.kind,
      text: String(source.text ?? ''),
      user: source.user ?? null,
      ...(source.twitchTime ? { twitchTime: source.twitchTime } : {})
    };
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(item)}\n`, 'utf8');
    items.push(item);
    if (items.length > maxItems) items.splice(0, items.length - maxItems);
    return item;
  }

  async function window({ from = -Infinity, to = Infinity, max = RECAP_MAX_ITEMS } = {}) {
    await ready;
    const start = asTime(from);
    const end = asTime(to);
    const limit = Math.min(RECAP_MAX_ITEMS, Math.max(0, Number(max) || 0));
    const selected = limit === 0 ? [] : items.filter(item => {
      if (item.kind === 'chat' && /^\s*!/u.test(item.text)) return false;
      const time = asTime(item.t);
      return time >= start && time <= end;
    }).sort((left, right) => asTime(left.t) - asTime(right.t)).slice(-limit);
    return selected.map((item, index) => ({ ...item, sourceId: item.id, id: `S${index + 1}`,
      ...(item.kind === 'chat' ? { text: item.text.slice(0, 200) } : {})
    }));
  }

  async function snapshot() {
    await ready;
    return items.map(item => ({ ...item }));
  }

  return { add, window, snapshot, ready };
}

function asTime(value) {
  if (value === -Infinity || value === Infinity) return value;
  if (typeof value === 'number') return value;
  return Date.parse(value);
}
