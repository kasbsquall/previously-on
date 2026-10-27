import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardPipeline } from '../src/cards/pipeline.js';
import { captureRecordedCard } from '../src/record-demo-capture.js';

test('record-demo capture listens to the real pipeline event API and records mocked model and narrator output', async () => {
  const now = Date.parse('2026-10-27T18:00:00Z');
  const items = [
    { id: 'voice-source', t: new Date(now - 60_000).toISOString(), kind: 'voice', text: 'The greenhouse is repaired.', user: 'MeadowMoth' },
    { id: 'note-source', t: new Date(now - 30_000).toISOString(), kind: 'note', text: 'The north path is open.', user: 'MeadowMoth' }
  ];
  const sourceBuffer = {
    async add(item) {
      const added = { id: `source-${items.length + 1}`, user: null, ...item };
      items.push(added);
      return added;
    },
    async window({ from = -Infinity, to = Infinity, max = 120 } = {}) {
      const start = typeof from === 'number' ? from : Date.parse(from);
      const end = typeof to === 'number' ? to : Date.parse(to);
      return items.filter(item => Date.parse(item.t) >= start && Date.parse(item.t) <= end).slice(-max)
        .map((item, index) => ({ ...item, sourceId: item.id, id: `S${index + 1}` }));
    }
  };
  const pipeline = createCardPipeline({
    sourceBuffer,
    channel: 'MeadowMoth',
    broadcasterId: 'broadcaster-1',
    mode: 'demo',
    now: () => now,
    setTimer(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
    clearTimer: clearTimeout,
    featureSettings: { get: () => ({ narratorVoice: true, soundEffects: true }), set: async value => value },
    approvalSettings: { get: () => ({ mode: 'hold', seconds: null }), set: async value => value },
    narrator: { generate: async () => ({ audioUrl: '/audio/mock-card', durationMs: 2400 }) },
    recap: async ({ items: recapItems }) => ({
      headline: 'The greenhouse is repaired.',
      bullets: [
        { text: 'The greenhouse is repaired.', sources: [recapItems.find(item => item.kind === 'voice').id] },
        { text: 'The north path is open.', sources: [recapItems.find(item => item.kind === 'note').id] }
      ],
      provenance: { voiceSeconds: 60, chatCount: 0, eventCount: 1, noteCount: 1 },
      engine: 'model',
      latencyMs: 12
    }),
    logChat: () => {},
    log: () => {}
  });

  assert.equal(typeof pipeline.once, 'undefined');
  assert.equal(typeof pipeline.on, 'function');
  assert.equal(typeof pipeline.off, 'function');
  const recorded = await captureRecordedCard(pipeline, { trigger: 'raid', action: () => pipeline.simulateRaid() });
  assert.equal(recorded.trigger, 'raid');
  assert.equal(recorded.engine, 'model');
  assert.equal(recorded.bullets.length, 2);
  assert.equal(recorded.narrator.file, `audio/${recorded.id}.wav`);
  assert.ok(recorded.sourceItems.some(item => item.kind === 'voice'));
  assert.ok(recorded.sourceDetails.some(item => item.text === 'The north path is open.'));
});
