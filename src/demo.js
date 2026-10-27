import { readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { startRuntime } from './runtime.js';

const channel = 'MeadowMoth';
const demoSessionPath = `.data/demo-session-${process.pid}.jsonl`;
const runtime = await startRuntime({
  mode: 'demo',
  channel,
  sessionPath: demoSessionPath,
  adBreakTimeScale: 0.25
});

void replayFixture(runtime.sourceBuffer);
schedule(3000, () => runtime.pipeline.simulateRaid());
schedule(23_000, () => runtime.pipeline.simulateCatchup());
schedule(43_000, async () => {
  runtime.pipeline.goingOnBreak({ simulated: true });
  await new Promise(resolve => setTimeout(resolve, 5000));
  return runtime.pipeline.backFromBreak({ simulated: true });
});
schedule(63_000, () => runtime.pipeline.simulateAdBreak());

async function replayFixture(buffer) {
  const fixture = await readFile(new URL('../fixtures/demo-session.jsonl', import.meta.url), 'utf8');
  const entries = fixture.split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(item => ['chat', 'voice', 'event', 'note'].includes(item.kind));
  if (!entries.length) return;
  const fixtureStart = Date.parse(entries[0].t);
  const replayStart = Date.now() - (Date.parse(entries.at(-1).t) - fixtureStart) / 4;
  let lastOffset = 0;
  for (const item of entries) {
    const originalOffset = Date.parse(item.t) - fixtureStart;
    const replayOffset = originalOffset / 4;
    await wait(Math.max(0, replayOffset - lastOffset));
    lastOffset = replayOffset;
    await buffer.add({ ...item, t: new Date(replayStart + replayOffset).toISOString() });
  }
}

function schedule(delay, action) {
  const timer = setTimeout(() => { void Promise.resolve(action()).catch(error => console.error(`Demo trigger error: ${error.message}`)); }, delay);
  timer.unref?.();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => runtime.server.close(() => process.exit(0)));
}

process.on('exit', () => rmSync(demoSessionPath, { force: true }));
