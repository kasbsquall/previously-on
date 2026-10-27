import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCardPipeline } from './cards/pipeline.js';
import { createNarrator } from './audio/narrator.js';
import { buildRecap } from './recap/index.js';
import { captureRecordedCard } from './record-demo-capture.js';
import { validateRecording } from '../web-demo/recording-schema.js';

if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY before running npm run record-demo.');

const recordingDirectory = 'web-demo/recording';
const audioDirectory = join(recordingDirectory, 'audio');
const fixtureText = await readFile(new URL('../fixtures/demo-session.jsonl', import.meta.url), 'utf8');
const fixtureItems = fixtureText.split(/\r?\n/).filter(Boolean).map(JSON.parse)
  .filter(item => ['chat', 'voice', 'event', 'note'].includes(item.kind))
  .sort((left, right) => Date.parse(left.t) - Date.parse(right.t));
const fixtureStart = Date.parse(fixtureItems[0].t);
const currentTime = Date.now();
const shiftedItems = fixtureItems.map(item => ({
  ...item,
  t: new Date(currentTime - 15 * 60_000 + Date.parse(item.t) - fixtureStart).toISOString()
}));

await rm(recordingDirectory, { recursive: true, force: true });
await mkdir(audioDirectory, { recursive: true });

const sourceBuffer = createMemoryBuffer(shiftedItems);
let streamClock = currentTime;
const narrator = createNarrator({ audioDirectory });
const pipeline = createCardPipeline({
  sourceBuffer,
  channel: 'MeadowMoth',
  broadcasterId: 'demo-broadcaster',
  mode: 'demo',
  now: () => streamClock,
  adBreakTimeScale: 0,
  featureSettings: { get: () => ({ narratorVoice: true, soundEffects: true }), set: async value => value },
  approvalSettings: { get: () => ({ mode: 'hold', seconds: null }), set: async value => value },
  narrator,
  recap: buildRecap,
  logChat: () => {},
  log: line => console.log(line)
});

const cards = [];
cards.push(await captureRecordedCard(pipeline, { trigger: 'ad-break', action: () => pipeline.simulateAdBreak() }));
streamClock += 61_000;
cards.push(await captureRecordedCard(pipeline, { trigger: 'raid', action: () => pipeline.simulateRaid() }));
streamClock += 61_000;
cards.push(await captureRecordedCard(pipeline, { trigger: 'catchup', action: () => pipeline.simulateCatchup() }));

const recording = validateRecording({
  version: 1,
  recordedAt: new Date().toISOString(),
  model: process.env.OPENAI_MODEL ?? 'gpt-5.4-mini',
  source: 'Recorded using npm run demo with simulated Twitch triggers.',
  cards
});
await writeFile(join(recordingDirectory, 'cards.json'), `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
console.log(`Saved three model cards and narrator WAV files in ${recordingDirectory}.`);

function createMemoryBuffer(initialItems) {
  const items = [...initialItems];
  return {
    async add(item) {
      const value = { id: item.id ?? `recorded-${items.length + 1}`, user: null, ...item };
      items.push(value);
      return value;
    },
    async window({ from = -Infinity, to = Infinity, max = 120 } = {}) {
      const start = typeof from === 'number' ? from : Date.parse(from);
      const end = typeof to === 'number' ? to : Date.parse(to);
      return items.filter(item => {
        if (item.kind === 'chat' && /^\s*!/u.test(item.text)) return false;
        const timestamp = Date.parse(item.t);
        return timestamp >= start && timestamp <= end;
      }).sort((left, right) => Date.parse(left.t) - Date.parse(right.t)).slice(-max)
        .map((item, index) => ({ ...item, sourceId: item.id, id: `S${index + 1}`, ...(item.kind === 'chat' ? { text: item.text.slice(0, 200) } : {}) }));
    }
  };
}
