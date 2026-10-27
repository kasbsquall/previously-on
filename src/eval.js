import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildRecap } from './recap/index.js';

const fixturePath = new URL('../fixtures/demo-session.jsonl', import.meta.url);
const lines = (await readFile(fixturePath, 'utf8')).split(/\r?\n/).filter(Boolean);
const fixture = lines.map(line => JSON.parse(line));
const items = fixture.filter(item => ['chat', 'voice', 'event', 'note'].includes(item.kind));
const base = Date.parse(items[0].t);
const triggers = [
  { name: 'raid', at: 10, from: 0 },
  { name: 'catch-up', at: 7, from: 2 },
  { name: 'back-from-break', at: 12, from: 9 }
];
const cards = [];
for (const trigger of triggers) {
  const from = base + trigger.from * 60_000;
  const to = base + trigger.at * 60_000;
  const window = items.filter(item => Date.parse(item.t) >= from && Date.parse(item.t) <= to)
    .slice(-120)
    .map((item, index) => ({ ...item, id: `S${index + 1}`, text: item.kind === 'chat' ? item.text.slice(0, 200) : item.text }));
  const recap = await buildRecap({ trigger: trigger.name, items: window, channel: 'MeadowMoth' });
  cards.push({ trigger: trigger.name, ...recap });
}

const latencies = cards.map(card => card.latencyMs).sort((left, right) => left - right);
const injectedText = fixture.filter(item => item.kind === 'chat' && /ignore previous instructions/i.test(item.text)).map(item => item.text);
const outputText = cards.flatMap(card => [card.headline, ...card.bullets.map(bullet => bullet.text)]).join('\n');
const result = {
  generatedAt: new Date().toISOString(),
  modelApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  ...(process.env.OPENAI_API_KEY ? {} : { modelPathNote: 'OPENAI_API_KEY is not set; evaluation used the deterministic fallback path only.' }),
  cards,
  bulletsKept: cards.reduce((sum, card) => sum + card.bullets.length, 0),
  bulletsDropped: cards.reduce((sum, card) => sum + card.droppedBullets.length, 0),
  fallbackRate: cards.filter(card => card.engine === 'fallback').length / cards.length,
  latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
  injectedTextRepeatedInOutput: injectedText.some(text => outputText.toLocaleLowerCase().includes(text.toLocaleLowerCase()))
};

const date = new Date().toISOString().slice(0, 10);
const resultDirectory = new URL('../results/', import.meta.url);
await mkdir(resultDirectory, { recursive: true });
const outputPath = new URL(`../results/eval-${date}.json`, import.meta.url);
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`Evaluation written to ${fileURLToPath(outputPath)}`);

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  return values[Math.ceil(values.length * fraction) - 1];
}
