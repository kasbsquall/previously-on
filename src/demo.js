import { readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { startRuntime } from './runtime.js';
import { preloadFixture, replayFixture } from './demo-replay.js';

const channel = 'MeadowMoth';
const demoSessionPath = `.data/demo-session-${process.pid}.jsonl`;
const runtime = await startRuntime({
  mode: 'demo',
  channel,
  sessionPath: demoSessionPath,
  adBreakTimeScale: 0.25
});

const fixtureText = await readFile(new URL('../fixtures/demo-session.jsonl', import.meta.url), 'utf8');
const preload = await preloadFixture(runtime.sourceBuffer, { fixtureText });
void replayFixture(runtime.sourceBuffer, {
  fixtureText,
  afterFixtureTime: preload.afterFixtureTime,
  timelineStart: preload.replayStart,
  initialDelayMs: 0
}).catch(error => console.error(`Demo fixture error: ${error.message}`));
schedule(3000, () => runtime.pipeline.simulateRaid());
schedule(23_000, () => runtime.pipeline.simulateCatchup());
schedule(43_000, async () => {
  runtime.pipeline.goingOnBreak({ simulated: true });
  await new Promise(resolve => setTimeout(resolve, 5000));
  return runtime.pipeline.backFromBreak({ simulated: true });
});
schedule(63_000, () => runtime.pipeline.simulateAdBreak());

function schedule(delay, action) {
  const timer = setTimeout(() => { void Promise.resolve(action()).catch(error => console.error(`Demo trigger error: ${error.message}`)); }, delay);
  timer.unref?.();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => runtime.server.close(() => process.exit(0)));
}

process.on('exit', () => rmSync(demoSessionPath, { force: true }));
