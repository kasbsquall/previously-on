import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSourceBuffer } from '../src/sources/buffer.js';
import { createCardPipeline } from '../src/cards/pipeline.js';
import { buildRecap } from '../src/recap/index.js';
import { preloadFixture, replayFixture } from '../src/demo-replay.js';

test('the demo replay places fixture sources in time for its simulated ad-break card', async t => {
  const fixtureText = await readFile(new URL('../fixtures/demo-session.jsonl', import.meta.url), 'utf8');
  const start = Date.parse('2026-10-26T18:00:00Z');
  let current = start;
  const sourceBuffer = createMemoryBuffer();
  await replayFixture(sourceBuffer, {
    fixtureText,
    now: () => current,
    sleep: async ms => { current += ms; }
  });
  const pipeline = createCardPipeline({
    sourceBuffer,
    channel: 'MeadowMoth',
    mode: 'demo',
    now: () => current,
    adBreakTimeScale: 0,
    setTimer(callback, delay) {
      if (delay === 0) queueMicrotask(callback);
      return { unref() {} };
    },
    clearTimer() {},
    recap: options => buildRecap({ ...options, model: async () => { throw new Error('offline'); } })
  });

  await pipeline.simulateAdBreak();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pipeline.getState().onAir?.trigger, 'ad-break');
  assert.ok(pipeline.getState().onAir.bullets.length > 0);
  assert.ok(pipeline.getState().onAir.sourceDetails.some(source => ['voice', 'note', 'chat'].includes(source.kind)));
});

test('demo preloads three fixture minutes across the preceding three minutes and feeds the first raid model facts', async t => {
  const fixtureText = await readFile(new URL('../fixtures/demo-session.jsonl', import.meta.url), 'utf8');
  const start = Date.parse('2026-10-27T18:00:00Z');
  const sourceBuffer = createMemoryBuffer();
  const preload = await preloadFixture(sourceBuffer, { fixtureText, now: () => start });
  assert.ok(preload.loaded > 0);
  const loaded = await sourceBuffer.window({ from: start - 180_000, to: start });
  assert.ok(loaded.length >= 20);
  assert.equal(Date.parse(loaded[0].t), start - 180_000);
  assert.ok(Date.parse(loaded.at(-1).t) <= start);

  let modelItems;
  const pipeline = createCardPipeline({
    sourceBuffer,
    channel: 'MeadowMoth',
    mode: 'demo',
    now: () => start + 3000,
    narrator: { generate: async () => null },
    featureSettings: { get: () => ({ narratorVoice: false, soundEffects: true }), set: async value => value },
    recap: async ({ items }) => {
      modelItems = items;
      return {
        headline: 'The greenhouse is ready.',
        bullets: [
          { text: 'The garden beds were planted.', sources: [items.find(item => item.kind === 'voice').id] },
          { text: 'The bridge still needs two boards.', sources: [items.find(item => item.kind === 'chat').id] }
        ],
        provenance: { voiceSeconds: 30, chatCount: 2, eventCount: 0, noteCount: 0 },
        engine: 'model', latencyMs: 4
      };
    }
  });
  const card = await pipeline.simulateRaid();
  assert.equal(card.engine, 'model');
  assert.ok(card.bullets.length >= 2 && card.bullets.length <= 3);
  assert.ok(modelItems.some(item => item.kind === 'voice' || item.kind === 'note' || item.kind === 'chat'));
});

function createMemoryBuffer() {
  const items = [];
  return {
    async add(item) {
      const value = { id: item.id ?? `source-${items.length + 1}`, ...item };
      items.push(value);
      return value;
    },
    async window({ from = -Infinity, to = Infinity, max = 120 } = {}) {
      const start = typeof from === 'number' ? from : Date.parse(from);
      const end = typeof to === 'number' ? to : Date.parse(to);
      return items.filter(item => {
        if (item.kind === 'chat' && /^\s*!/u.test(item.text)) return false;
        const time = Date.parse(item.t);
        return time >= start && time <= end;
      }).sort((left, right) => Date.parse(left.t) - Date.parse(right.t)).slice(-max)
        .map((item, index) => ({ ...item, sourceId: item.id, id: `S${index + 1}` }));
    }
  };
}
