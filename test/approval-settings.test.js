import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApprovalSettings } from '../src/cards/approval-settings.js';

test('approval choice persists and is restored on startup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'previously-on-approval-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'approval.json');
  const first = createApprovalSettings({ filePath });
  await first.ready;
  assert.deepEqual(first.get(), { mode: 'timed', seconds: 5 });
  await first.set({ mode: 'hold' });
  const restarted = createApprovalSettings({ filePath });
  await restarted.ready;
  assert.deepEqual(restarted.get(), { mode: 'hold', seconds: null });
});

test('approval settings accept only the listed timed delays or hold mode', async () => {
  const settings = createApprovalSettings();
  await assert.rejects(settings.set({ mode: 'timed', seconds: 7 }), /5, 10, or 20 seconds/);
  assert.deepEqual(await settings.set({ mode: 'timed', seconds: 20 }), { mode: 'timed', seconds: 20 });
});
