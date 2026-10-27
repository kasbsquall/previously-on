export async function replayFixture(buffer, {
  fixtureText,
  now = Date.now,
  sleep = wait,
  speed = 4,
  initialDelayMs = 5000
}) {
  const entries = fixtureText.split(/\r?\n/).filter(Boolean).map(JSON.parse)
    .filter(item => ['chat', 'voice', 'event', 'note'].includes(item.kind));
  if (!entries.length) return;
  const fixtureStart = Date.parse(entries[0].t);
  const replayStart = now() - initialDelayMs;
  let lastOffset = 0;
  for (const item of entries) {
    const replayOffset = (Date.parse(item.t) - fixtureStart) / speed;
    await sleep(Math.max(0, replayOffset - lastOffset));
    lastOffset = replayOffset;
    await buffer.add({ ...item, t: new Date(replayStart + replayOffset).toISOString() });
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
