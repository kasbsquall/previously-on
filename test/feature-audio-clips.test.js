import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeatureSettings } from '../src/cards/feature-settings.js';
import { createNarrator } from '../src/audio/narrator.js';
import { createClipReceipts } from '../src/twitch/clip-receipts.js';
import { TWITCH_SCOPES } from '../src/twitch/auth.js';
import { createServer } from '../src/server.js';

test('voice and sound effect settings default on and persist changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'previously-on-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = join(dir, 'settings.json');
  const settings = createFeatureSettings({ filePath });
  await settings.ready;
  assert.deepEqual(settings.get(), { narratorVoice: true, soundEffects: true });
  await settings.set({ narratorVoice: false, soundEffects: true });
  const restarted = createFeatureSettings({ filePath });
  await restarted.ready;
  assert.deepEqual(restarted.get(), { narratorVoice: false, soundEffects: true });
});

test('narrator creates cached WAV audio from mocked Realtime output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'previously-on-audio-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  let sockets = 0;
  class FakeSocket extends EventEmitter {
    constructor(url, options) {
      super(); sockets++; assert.match(url, /gpt-realtime-2\.1-mini/); assert.equal(options.headers.Authorization, 'Bearer test-key');
      queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.created' }))));
    }
    send(value) {
      const event = JSON.parse(value);
      if (event.type === 'session.update') queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' }))));
      else if (event.type === 'response.create') {
        queueMicrotask(() => {
          this.emit('message', Buffer.from(JSON.stringify({ type: 'response.output_audio.delta', delta: Buffer.from([0, 0, 1, 0]).toString('base64') })));
          this.emit('message', Buffer.from(JSON.stringify({ type: 'response.done', response: { status: 'completed' } })));
        });
      }
    }
    close() {}
  }
  const narrator = createNarrator({ apiKey: 'test-key', audioDirectory: dir, WebSocketImpl: FakeSocket });
  const generated = await narrator.generate({ cardId: id, channel: 'Fern', headline: 'The garden grew.', bullets: [{ text: 'The bridge is open.' }] });
  assert.equal(generated.audioUrl, `/audio/${id}`);
  assert.equal(generated.durationMs, 1);
  const cached = await readFile(narrator.audioPathFor(id));
  assert.equal(cached.toString('ascii', 0, 4), 'RIFF');
  await narrator.generate({ cardId: id, channel: 'Fern', headline: 'The garden grew.', bullets: [] });
  assert.equal(sockets, 1);
  assert.equal(narrator.audioPathFor('../secrets'), null);
  await assert.rejects(narrator.generate({ cardId: '../secrets', channel: 'Fern', headline: 'x', bullets: [] }), /Invalid card id/);
});

test('narrator fails softly for missing key, socket errors, incomplete and timed-out output', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'previously-on-audio-errors-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const card = { cardId: 'abcdefab-cdef-4abc-8def-abcdefabcdef', channel: 'Fern', headline: 'A story.', bullets: [] };
  await assert.rejects(createNarrator({ apiKey: '', audioDirectory: dir }).generate(card), /OPENAI_API_KEY/);
  class ErrorSocket extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('error', new Error('socket failed'))); }
    close() {}
  }
  await assert.rejects(createNarrator({ apiKey: 'key', audioDirectory: dir, WebSocketImpl: ErrorSocket }).generate(card), /failed/);
  class IncompleteSocket extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.created"}'))); }
    send(value) {
      const event = JSON.parse(value);
      if (event.type === 'session.update') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"session.updated"}')));
      if (event.type === 'response.create') queueMicrotask(() => this.emit('message', Buffer.from('{"type":"response.done","response":{"status":"incomplete"}}')));
    }
    close() {}
  }
  await assert.rejects(createNarrator({ apiKey: 'key', audioDirectory: dir, WebSocketImpl: IncompleteSocket }).generate(card), /incomplete/);
  class QuietSocket extends EventEmitter { close() {} }
  await assert.rejects(createNarrator({ apiKey: 'key', audioDirectory: join(dir, 'quiet'), WebSocketImpl: QuietSocket, timeoutMs: 5 }).generate(card), /timed out/);
});

test('narrator audio route serves only valid card ids', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'previously-on-route-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  const path = join(dir, `${id}.wav`);
  await writeFile(path, Buffer.from('RIFFaudio'));
  const pipeline = new EventEmitter(); pipeline.getState = () => ({ cards: [] });
  const server = createServer({ pipeline, narrator: { audioPathFor: value => value === id ? path : null }, port: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const ok = await fetch(`${origin}/audio/${id}`);
  assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type'), /audio\/wav/);
  assert.equal((await fetch(`${origin}/audio/not-an-id`)).status, 400);
  assert.equal((await fetch(`${origin}/audio/%2e%2e%2fsecret`)).status, 400);
});

test('clip receipt creates a marker, waits for Get Clips, and returns the confirmed URL', async () => {
  const calls = [];
  const receipt = createClipReceipts({ clientId: 'client', broadcasterId: 'broadcaster', scopes: ['clips:edit', 'channel:manage:broadcast'], getAccessToken: async () => 'token', sleep: async () => {}, log: () => {}, request: async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith('clips?broadcaster_id')) return { data: [{ id: 'clip-1' }] };
    if (path === 'clips?id=clip-1') return { data: [{ url: 'https://clips.twitch.tv/clip-1' }] };
    return { data: [] };
  } });
  const result = await receipt.capture({ trigger: 'raid' });
  assert.equal(result.clipUrl, 'https://clips.twitch.tv/clip-1');
  assert.equal(result.markerCreated, true);
  assert.ok(calls.some(call => call.path === 'streams/markers' && call.options.body.description === 'Previously On: raid'));
  assert.ok(calls.some(call => call.path.startsWith('clips?broadcaster_id')));
  assert.ok(calls.some(call => call.path === 'clips?id=clip-1'));
});

test('clip receipt failures and missing scopes fail soft', async () => {
  const logs = [];
  const failing = createClipReceipts({ clientId: 'client', broadcasterId: 'broadcaster', scopes: ['clips:edit', 'channel:manage:broadcast'], getAccessToken: async () => 'token', log: line => logs.push(line), request: async path => { if (path === 'streams/markers') throw new Error('marker offline'); if (path.startsWith('clips?broadcaster_id')) throw new Error('clips disabled'); } });
  assert.deepEqual(await failing.capture({ trigger: 'ad-break' }), { clipUrl: null, markerCreated: false });
  assert.equal(logs.length, 2);
  const missing = createClipReceipts({ scopes: [], log: line => logs.push(line), request: async () => assert.fail('must not call Twitch without scopes') });
  assert.equal((await missing.capture({ trigger: 'raid' })).clipUrl, null);
  assert.match(logs.at(-2), /marker skipped/);
  assert.match(logs.at(-1), /clip skipped/);
});

test('clip receipt posts without a link when Get Clips never confirms readiness', async () => {
  const logs = [];
  const receipt = createClipReceipts({ clientId: 'client', broadcasterId: 'broadcaster', scopes: ['clips:edit'], getAccessToken: async () => 'token', maxWaitMs: 0, log: line => logs.push(line), request: async path => {
    if (path.startsWith('clips?broadcaster_id')) return { data: [{ id: 'clip-late' }] };
    if (path === 'clips?id=clip-late') return { data: [] };
    return {};
  } });
  assert.deepEqual(await receipt.capture({ trigger: 'raid' }), { clipUrl: null, markerCreated: false });
  assert.match(logs[0], /marker skipped/);
  assert.match(logs[1], /clip failed/);
});

test('simulated triggers skip all Twitch receipt calls', async () => {
  const logs = [];
  const receipt = createClipReceipts({ scopes: ['clips:edit', 'channel:manage:broadcast'], log: line => logs.push(line), request: async () => assert.fail('simulated receipt must not call Twitch') });
  assert.deepEqual(await receipt.capture({ trigger: 'raid', simulated: true }), { clipUrl: null, markerCreated: false, skipped: true });
  assert.match(logs[0], /skipped because the trigger was simulated/);
});

test('Twitch authorization asks for the clip and marker scopes', () => {
  assert.ok(TWITCH_SCOPES.includes('clips:edit'));
  assert.ok(TWITCH_SCOPES.includes('channel:manage:broadcast'));
});
