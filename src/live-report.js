import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function readLiveCards(filePath = new URL('../results/live-cards.jsonl', import.meta.url)) {
  try {
    const contents = await readFile(filePath, 'utf8');
    return contents.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function summarizeLiveCards(cards) {
  const counts = field => Object.fromEntries([...cards.reduce((map, card) => map.set(card[field], (map.get(card[field]) ?? 0) + 1), new Map())]);
  const latencies = cards.map(card => Number(card.latencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    total: cards.length,
    byTrigger: counts('trigger'),
    byStatus: counts('status'),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) }
  };
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cards = await readLiveCards();
  if (!cards.length) {
    console.log('No live card records found in results/live-cards.jsonl.');
  } else {
    const report = summarizeLiveCards(cards);
    console.log('Counts by trigger:');
    for (const [trigger, count] of Object.entries(report.byTrigger)) console.log(`${trigger}: ${count}`);
    console.log('Counts by status:');
    for (const [status, count] of Object.entries(report.byStatus)) console.log(`${status}: ${count}`);
    console.log(`Latency p50: ${report.latencyMs.p50} ms`);
    console.log(`Latency p95: ${report.latencyMs.p95} ms`);
  }
}
