import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { createObsClient, obsAuthentication } from '../src/obs/client.js';
import { createBreakSceneSettings } from '../src/obs/break-scene-settings.js';
import { createBrbSceneController } from '../src/obs/brb-scenes.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const password = 'test-password';

test('OBS client authenticates Hello, subscribes to scenes, and reads scene list', async t => {
  const server = await mockObsServer(); t.after(() => server.close());
  const client = createObsClient({ url: server.url, password }); t.after(() => client.close());
  const identified = server.nextIdentified;
  const state = waitFor(client, 'state', value => value.status === 'connected');
  client.start();
  const identify = await identified;
  assert.equal(identify.eventSubscriptions, 1 << 2);
  assert.equal(identify.authentication, obsAuthentication(password, server.salt, server.challenge));
  assert.equal((await state).status, 'connected');
  await waitFor(client, 'scenes');
  const result = await client.getSceneList();
  assert.deepEqual(result.scenes, ['Gameplay', 'BRB']);
  assert.equal(result.currentProgramSceneName, 'Gameplay');
  const transitions = [];
  client.on('program-scene', createBrbSceneController({
    pipeline: { startBrbBreak: () => transitions.push('start'), endBrbBreak: () => transitions.push('end') },
    getBreakScene: () => 'BRB'
  }));
  server.emitProgramScene('BRB');
  server.emitProgramScene('Gameplay');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(transitions, ['start', 'end']);
});

test('OBS rejects an incorrect password without exposing it in state', async t => {
  const server = await mockObsServer(); t.after(() => server.close());
  const incorrectPassword = 'incorrect-password';
  const client = createObsClient({ url: server.url, password: incorrectPassword }); t.after(() => client.close());
  const identify = server.nextIdentified;
  client.start();
  const sent = await identify;
  assert.notEqual(sent.authentication, obsAuthentication(password, server.salt, server.challenge));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(client.status().status, 'reconnecting');
  assert.doesNotMatch(JSON.stringify(client.status()), new RegExp(incorrectPassword));
});

test('OBS client reconnects after the socket closes', async t => {
  const server = await mockObsServer(); t.after(() => server.close());
  const client = createObsClient({ url: server.url, password, random: () => 0 }); t.after(() => client.close());
  client.start();
  await waitFor(client, 'state', value => value.status === 'connected');
  const secondConnection = server.nextConnection;
  server.sockets[0].close();
  await secondConnection;
  await waitFor(client, 'state', value => value.status === 'connected');
  await waitFor(client, 'scenes');
  assert.equal(server.connections, 2);
});

test('program scene transitions start and end the BRB review exactly once', async () => {
  const calls = [];
  const controller = createBrbSceneController({
    pipeline: { startBrbBreak: () => calls.push('start'), endBrbBreak: () => calls.push('end') },
    getBreakScene: () => 'BRB'
  });
  controller('Gameplay'); controller('BRB'); controller('BRB'); controller('Gameplay'); controller('Gameplay');
  assert.deepEqual(calls, ['start', 'end']);
});

test('OBS break scene selection persists and defaults from environment setting', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'previously-on-obs-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'obs-settings.json');
  const first = createBreakSceneSettings({ filePath, defaultScene: 'BRB' }); await first.ready;
  assert.equal(first.get(), 'BRB');
  await first.set('Starting Soon');
  const saved = createBreakSceneSettings({ filePath, defaultScene: 'Different' }); await saved.ready;
  assert.equal(saved.get(), 'Starting Soon');
  assert.match(await readFile(filePath, 'utf8'), /Starting Soon/);
});

function waitFor(emitter, name, predicate = () => true) {
  return new Promise(resolve => {
    const handler = value => { if (predicate(value)) { emitter.off(name, handler); resolve(value); } };
    emitter.on(name, handler);
  });
}

async function mockObsServer() {
  const challenge = 'challenge-base64';
  const salt = 'salt-base64';
  const wss = new WebSocketServer({ port: 0 });
  await new Promise(resolve => wss.once('listening', resolve));
  const helper = {
    url: `ws://127.0.0.1:${wss.address().port}`, challenge, salt, sockets: [], connections: 0,
    nextIdentified: null, nextConnection: null
  };
  helper.nextIdentified = new Promise(resolve => { helper.resolveIdentified = resolve; });
  helper.nextConnection = new Promise(resolve => { helper.resolveConnection = resolve; });
  helper.emitProgramScene = sceneName => helper.sockets.at(-1)?.send(JSON.stringify({ op: 5, d: { eventType: 'CurrentProgramSceneChanged', eventIntent: 4, eventData: { sceneName, sceneUuid: 'scene-id' } } }));
  wss.on('connection', socket => {
    helper.sockets.push(socket); helper.connections++;
    if (helper.connections > 1) helper.resolveConnection();
    socket.send(JSON.stringify({ op: 0, d: { obsStudioVersion: '32.0.0', obsWebSocketVersion: '5.5.0', rpcVersion: 1, authentication: { challenge, salt } } }));
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.op === 1) {
        helper.resolveIdentified?.(message.d); helper.resolveIdentified = null;
        if (message.d.authentication !== obsAuthentication(password, salt, challenge)) { socket.close(4009, 'Authentication failed'); return; }
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      } else if (message.op === 6 && message.d.requestType === 'GetSceneList') {
        socket.send(JSON.stringify({ op: 7, d: { requestType: 'GetSceneList', requestId: message.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { currentProgramSceneName: 'Gameplay', scenes: [{ sceneName: 'Gameplay' }, { sceneName: 'BRB' }] } } }));
      }
    });
  });
  helper.close = () => new Promise(resolve => { for (const socket of helper.sockets) socket.terminate(); wss.close(resolve); });
  return helper;
}
