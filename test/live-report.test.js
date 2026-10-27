import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveCardLogger } from '../src/cards/live-log.js';
import { summarizeLiveCards } from '../src/live-report.js';

test('live card log omits bullet text and user names while preserving decision metrics', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'previously-on-live-log-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'live-cards.jsonl');
  const log = createLiveCardLogger(path);
  await log({
    updatedAt: Date.parse('2026-10-25T12:00:00Z'), trigger: 'raid', simulated: false,
    engine: 'model', latencyMs: 230, status: 'Shown', headline: 'Secret headline',
    bullets: [{ text: 'Artemander95 said: secret chat text', sources: ['S2'] }],
    droppedBullets: [{ reason: 'unknown_source', text: 'Secret text', user: 'Artemander95' }]
  }, 'real');
  const contents = await readFile(path, 'utf8');
  const [record] = contents.trim().split('\n').map(JSON.parse);
  assert.deepEqual(Object.keys(record), ['at', 'mode', 'trigger', 'simulated', 'engine', 'latencyMs', 'bullets', 'droppedBullets', 'status']);
  assert.deepEqual(record.bullets, [{ sources: ['S2'] }]);
  assert.deepEqual(record.droppedBullets, [{ reason: 'unknown_source' }]);
  assert.doesNotMatch(contents, /Artemander95|secret chat text|Secret headline/);
});

test('live report summarizes trigger, status and percentile counts', () => {
  const summary = summarizeLiveCards([
    { trigger: 'raid', status: 'Shown', latencyMs: 10 },
    { trigger: 'raid', status: 'Vetoed', latencyMs: 20 },
    { trigger: 'catchup', status: 'Shown', latencyMs: 30 },
    { trigger: 'break', status: 'Shown', latencyMs: 40 }
  ]);
  assert.deepEqual(summary.byTrigger, { raid: 2, catchup: 1, break: 1 });
  assert.deepEqual(summary.byStatus, { Shown: 3, Vetoed: 1 });
  assert.deepEqual(summary.latencyMs, { p50: 20, p95: 40 });
});
