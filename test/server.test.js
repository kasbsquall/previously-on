import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatSSE, isAllowedOrigin } from '../src/server.js';

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
