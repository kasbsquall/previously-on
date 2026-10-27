import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer, formatSSE, isAllowedOrigin } from '../src/server.js';

test('SSE frames carry event data as JSON and escape HTML delimiters', () => {
  const script = '<script>alert(1)</script>';
  const frame = formatSSE('card:show', { headline: script });
  assert.match(frame, /^event: card:show\ndata: /);
  assert.equal(frame.includes(script), false);
  const json = frame.match(/^data: (.+)$/m)[1];
  assert.equal(JSON.parse(json).headline, script);
});

test('POST origin check allows only the bound local origin', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:4777', 4777), true);
  assert.equal(isAllowedOrigin('http://localhost:4777', 4777), false);
  assert.equal(isAllowedOrigin('https://example.com', 4777), false);
  assert.equal(isAllowedOrigin(undefined, 4777), false);
});

test('/api/simulate ad-break returns serializable JSON with no timer handle', async t => {
  const pipeline = new EventEmitter();
  pipeline.getState = () => ({ mode: 'demo', cards: [] });
  pipeline.simulateAdBreak = () => ({ payload: { duration_seconds: 60 }, scheduledAt: 123456 });
  const server = createServer({ pipeline, port: 0, mode: 'demo' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/simulate`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'ad-break' })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    result: { payload: { duration_seconds: 60 }, scheduledAt: 123456 }
  });
  const invalid = await fetch(`${origin}/api/simulate`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'unknown' })
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'Simulation type must be raid, catchup, or ad-break.' });
});

test('feature toggle endpoint persists the requested voice and sound state through the pipeline', async t => {
  const pipeline = new EventEmitter();
  pipeline.getState = () => ({ mode: 'demo', cards: [] });
  pipeline.setFeatureSettings = async value => value;
  const server = createServer({ pipeline, port: 0, mode: 'demo' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/feature-settings`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ narratorVoice: false, soundEffects: true })
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result, { narratorVoice: false, soundEffects: true });
  const controls = await readFile(new URL('../public/control.html', import.meta.url), 'utf8');
  assert.match(controls, /Narrator voice/);
  assert.match(controls, /Sound effects/);
  assert.match(controls, /Card text is sent to OpenAI/);
});

test('unexpected POST errors are logged and returned as a plain message', async t => {
  const pipeline = new EventEmitter();
  pipeline.getState = () => ({ mode: 'demo', cards: [] });
  pipeline.simulateAdBreak = () => { throw new Error('internal detail should stay in the terminal'); };
  const server = createServer({ pipeline, port: 0, mode: 'demo' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const response = await fetch(`${origin}/api/simulate`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'ad-break' })
    });
    assert.equal(response.status, 500);
    const data = await response.json();
    assert.equal(data.error, 'Something went wrong. Check the terminal for details.');
    assert.equal(JSON.stringify(data).includes('internal detail'), false);
    assert.match(String(logged[0]?.[1]), /internal detail should stay in the terminal/);
  } finally {
    console.error = originalError;
  }
});

test('overlay renderer uses textContent and does not insert card data as HTML', async () => {
  const source = await readFile(new URL('../public/overlay.js', import.meta.url), 'utf8');
  assert.match(source, /text\.textContent\s*=\s*bullet\.text/);
  assert.doesNotMatch(source, /innerHTML/);
});

test('overlay bullets remain visible when rendered without the play class', async () => {
  const css = await readFile(new URL('../public/overlay.css', import.meta.url), 'utf8');
  assert.match(css, /\.bullet\s*\{[^}]*opacity:\s*1\s*;/s);
  assert.match(css, /\.ticket\.play \.bullet\s*\{[^}]*animation:[^}]*both/s);
});

test('overlay headline uses the coupon width and the stamp remains inside the ticket', async () => {
  const css = await readFile(new URL('../public/overlay.css', import.meta.url), 'utf8');
  assert.match(css, /\.headline\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/s);
  assert.match(css, /\.stamp\s*\{[^}]*bottom:\s*8px/s);
});
