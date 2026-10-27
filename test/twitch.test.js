import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createTwitchAuth, pollDeviceCode, TwitchAuthError } from '../src/twitch/auth.js';
import { createEventSubClient, normalizeEvent, routeEventSubMessage } from '../src/twitch/eventsub.js';
import { sendChat } from '../src/twitch/api.js';

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').then(JSON.parse);

test('EventSub keepalives at the advertised interval do not reconnect during a quiet two-minute session', async () => {
  const clock = fakeClock();
  const sockets = [];
  const logs = [];
  class FakeSocket extends EventEmitter {
    constructor(url) { super(); this.url = url; sockets.push(this); }
    terminate() { this.emit('close', 1006); }
    close() { this.emit('close', 1000); }
    message(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
  }
  const client = createEventSubClient({
    clientId: 'client', getAccessToken: async () => 'access', broadcasterId: 'broadcaster', userId: 'bot',
    WebSocketImpl: FakeSocket,
    fetchImpl: async () => ({ ok: true, status: 202, json: async () => ({ data: [] }) }),
    log: line => logs.push(line),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    backoff: [100],
    keepaliveGraceMs: 5000
  });
  client.start();
  const socket = sockets[0];
  socket.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-1', keepalive_timeout_seconds: 10 } } });
  await new Promise(resolve => setImmediate(resolve));
  for (let index = 0; index < 12; index++) {
    await clock.advance(10_000);
    socket.message({ metadata: { message_type: 'session_keepalive' }, payload: {} });
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sockets.length, 1);
  assert.deepEqual(logs, []);
  client.close();
});

function fakeClock() {
  let nextId = 0;
  let now = 0;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      let due;
      while ((due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0])) {
        now = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        await new Promise(resolve => setImmediate(resolve));
      }
      now = end;
    }
  };
}

test('device code polling continues while authorization is pending then returns tokens', async () => {
  const responses = [
    { ok: false, status: 400, json: async () => ({ message: 'authorization_pending' }) },
    { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 14400 }) }
  ];
  let waits = 0;
  const result = await pollDeviceCode({ deviceCode: 'device', interval: 1, expiresIn: 20, clientId: 'client', fetchImpl: async () => responses.shift(), sleep: async () => { waits++; }, now: () => 1000 });
  assert.equal(waits, 2);
  assert.equal(result.access_token, 'access');
});

test('device code polling reports an expired code', async () => {
  await assert.rejects(
    pollDeviceCode({ deviceCode: 'device', interval: 1, expiresIn: 20, clientId: 'client', fetchImpl: async () => ({ ok: false, json: async () => ({ message: 'expired_token' }) }), sleep: async () => {}, now: () => 1000 }),
    TwitchAuthError
  );
});

test('acquire maps the Twitch device response fields and stores the tokens', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'previously-on-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const auth = createTwitchAuth({
    clientId: 'client',
    tokenPath: join(directory, 'tokens.json'),
    log: () => {},
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/device')) {
        return { ok: true, json: async () => ({ device_code: 'device-from-twitch', user_code: 'ABCD1234', verification_uri: 'https://www.twitch.tv/activate', interval: 0, expires_in: 1800 }) };
      }
      return { ok: true, json: async () => ({ access_token: 'access-value', refresh_token: 'refresh-value', expires_in: 14400, scope: [], token_type: 'bearer' }) };
    }
  });
  const tokens = await auth.acquire();
  assert.equal(tokens.access_token, 'access-value');
  assert.match(requests[1].options.body.toString(), /device_code=device-from-twitch/);
  assert.equal((await auth.loadTokens()).refresh_token, 'refresh-value');
});

test('EventSub routes documented chat notification payload', async () => {
  const sample = await fixture('eventsub-chat.json');
  const routed = routeEventSubMessage(sample);
  assert.equal(routed.event.kind, 'chat');
  assert.equal(routed.event.user, 'viewer32');
  assert.equal(routed.event.text, 'Hi chat');
  assert.equal(routed.event.raw, sample.payload.event);
});

test('EventSub ignores bot output from the broadcaster account', async () => {
  const sample = await fixture('eventsub-chat.json');
  sample.payload.event.chatter_user_id = '1971641';
  sample.payload.event.message.text = 'Previously on: the greenhouse is ready.';
  assert.equal(routeEventSubMessage(sample, { botUserId: '1971641' }).event, null);
  sample.payload.event.message.text = 'Previously On check: connected.';
  assert.equal(routeEventSubMessage(sample, { botUserId: '1971641' }).event, null);
  sample.payload.event.message.text = '@artemander95 Previously on: the greenhouse is ready.';
  assert.equal(routeEventSubMessage(sample, { botUserId: '1971641' }).event, null);
  sample.payload.event.message.text = '@artemander95 Previously On check: connected.';
  assert.equal(routeEventSubMessage(sample, { botUserId: '1971641' }).event, null);
});

test('EventSub routes documented raid notification payload', async () => {
  const sample = await fixture('eventsub-raid.json');
  const routed = routeEventSubMessage(sample);
  assert.equal(routed.event.kind, 'raid');
  assert.equal(routed.event.user, 'Cool_User');
  assert.equal(routed.event.text, 'Raid from Cool_User with 9001 viewers');
});

test('chat sender accepts 500 characters and rejects 501', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ data: [{ message_id: 'id', is_sent: true, drop_reason: null }] }) };
  };
  await sendChat('x'.repeat(500), { clientId: 'client', accessToken: 'access', broadcasterId: '1', senderId: '1', fetchImpl });
  assert.equal(request.message.length, 500);
  await assert.rejects(sendChat('x'.repeat(501), { clientId: 'client', accessToken: 'access', broadcasterId: '1', senderId: '1', fetchImpl }), RangeError);
});

test('chat sender surfaces Twitch drop reason', async () => {
  await assert.rejects(sendChat('hello', {
    clientId: 'client', accessToken: 'access', broadcasterId: '1', senderId: '1',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: [{ is_sent: false, drop_reason: { code: 'automod_held', message: 'Held for review' } }] }) })
  }), /automod_held: Held for review/);
});
