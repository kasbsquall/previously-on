export async function replayFixture(buffer, {
  fixtureText,
  now = Date.now,
  sleep = wait,
  speed = 4,
  initialDelayMs = 5000,
  afterFixtureTime,
  timelineStart
}) {
  let entries = parseFixture(fixtureText);
  const filteredStart = afterFixtureTime === undefined ? null : time(afterFixtureTime);
  if (filteredStart !== null) entries = entries.filter(item => time(item.t) > filteredStart);
  if (!entries.length) return;
  const fixtureStart = filteredStart ?? Math.min(...entries.map(item => time(item.t)));
  const replayStart = timelineStart ?? now() - initialDelayMs;
  let lastOffset = 0;
  for (const item of entries) {
    const replayOffset = (time(item.t) - fixtureStart) / speed;
    await sleep(Math.max(0, replayOffset - lastOffset));
    lastOffset = replayOffset;
    await buffer.add({ ...item, t: new Date(replayStart + replayOffset).toISOString() });
  }
}

export async function preloadFixture(buffer, { fixtureText, now = Date.now, lookbackMs = 180_000, fixtureMinutes = 3 } = {}) {
  const entries = parseFixture(fixtureText);
  if (!entries.length) return { loaded: 0, afterFixtureTime: null, replayStart: now() };
  const fixtureStart = Math.min(...entries.map(item => time(item.t)));
  const sourceWindowMs = fixtureMinutes * 60_000;
  const afterFixtureTime = fixtureStart + sourceWindowMs;
  const initialItems = entries.filter(item => time(item.t) <= afterFixtureTime);
  const replayStart = now();
  for (const item of initialItems) {
    const offset = Math.max(0, Math.min(sourceWindowMs, time(item.t) - fixtureStart));
    const replayTime = replayStart - lookbackMs + (offset / sourceWindowMs) * lookbackMs;
    await buffer.add({ ...item, t: new Date(replayTime).toISOString() });
  }
  return { loaded: initialItems.length, afterFixtureTime, replayStart };
}

function parseFixture(fixtureText) {
  return fixtureText.split(/\r?\n/).filter(Boolean).map(JSON.parse)
    .filter(item => ['chat', 'voice', 'event', 'note'].includes(item.kind))
    .sort((left, right) => time(left.t) - time(right.t));
}

function time(value) { return typeof value === 'number' ? value : Date.parse(value); }

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
