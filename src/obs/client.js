import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const SCENE_EVENTS = (1 << 2) | (1 << 4);
export const OBS_SCENE_POLL_INTERVAL_MS = 2000;

export function obsAuthentication(password, salt, challenge) {
  const secret = createHash('sha256').update(`${password}${salt}`).digest('base64');
  return createHash('sha256').update(`${secret}${challenge}`).digest('base64');
}

export function createObsClient({
  url = process.env.OBS_WEBSOCKET_URL || 'ws://127.0.0.1:4455',
  password = process.env.OBS_WEBSOCKET_PASSWORD || '',
  WebSocketImpl = WebSocket,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  random = Math.random,
  scenePollIntervalMs = OBS_SCENE_POLL_INTERVAL_MS
} = {}) {
  const emitter = new EventEmitter();
  emitter.on('error', () => {});
  let socket = null;
  let retryTimer = null;
  let retryCount = 0;
  let closedByUser = false;
  let connected = false;
  let version = null;
  let scenes = [];
  let currentProgramScene = null;
  let requestWaiters = new Map();
  let scenePollTimer = null;
  let sceneRefreshPromise = null;

  const status = () => ({
    status: !password ? 'not configured' : connected ? 'connected' : 'reconnecting',
    configured: Boolean(password && url), version, scenes: scenes.slice(), currentProgramScene
  });

  function send(op, d) {
    if (socket?.readyState === WebSocketImpl.OPEN) socket.send(JSON.stringify({ op, d }));
  }

  function request(requestType, requestData = {}) {
    if (!connected) return Promise.reject(new Error('OBS is not connected.'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => { requestWaiters.delete(requestId); reject(new Error(`OBS ${requestType} timed out.`)); }, 5000);
      requestWaiters.set(requestId, { resolve, reject, timer, requestType });
      send(6, { requestType, requestId, requestData });
    });
  }

  function publish() { emitter.emit('state', status()); }

  function updateProgramScene(sceneName) {
    if (typeof sceneName !== 'string' || !sceneName || sceneName === currentProgramScene) return;
    currentProgramScene = sceneName;
    emitter.emit('program-scene', currentProgramScene);
    publish();
  }

  function refreshProgramScene() {
    if (!connected) return Promise.resolve(null);
    if (sceneRefreshPromise) return sceneRefreshPromise;
    sceneRefreshPromise = request('GetCurrentProgramScene').then(result => {
      updateProgramScene(result.sceneName ?? result.currentProgramSceneName);
      return currentProgramScene;
    }).catch(error => {
      if (!closedByUser) emitter.emit('error', error);
      return null;
    }).finally(() => { sceneRefreshPromise = null; });
    return sceneRefreshPromise;
  }

  function scheduleScenePoll() {
    if (scenePollTimer || !connected || closedByUser) return;
    scenePollTimer = setTimer(() => {
      scenePollTimer = null;
      void refreshProgramScene().finally(scheduleScenePoll);
    }, scenePollIntervalMs);
  }

  function scheduleReconnect() {
    if (closedByUser || retryTimer) return;
    connected = false;
    publish();
    const base = Math.min(30_000, 500 * (2 ** retryCount++));
    retryTimer = setTimer(() => { retryTimer = null; connect(); }, Math.round(base * (0.75 + random() * 0.5)));
  }

  function connect() {
    if (closedByUser) return;
    try { socket = new WebSocketImpl(url); }
    catch { scheduleReconnect(); return; }
    socket.on('open', () => {});
    socket.on('message', data => {
      let message;
      try { message = JSON.parse(String(data)); } catch { return; }
      const d = message.d ?? {};
      if (message.op === 0) {
        version = d.obsStudioVersion ?? null;
        const authentication = d.authentication ? obsAuthentication(password, d.authentication.salt, d.authentication.challenge) : undefined;
        send(1, { rpcVersion: d.rpcVersion, eventSubscriptions: SCENE_EVENTS, ...(authentication ? { authentication } : {}) });
      } else if (message.op === 2) {
        connected = true; retryCount = 0; publish();
        void request('GetSceneList').then(result => {
          scenes = (result.scenes ?? []).map(scene => scene.sceneName).filter(name => typeof name === 'string');
          updateProgramScene(result.currentProgramSceneName);
          emitter.emit('scenes', scenes.slice()); publish();
        }).catch(error => emitter.emit('error', error));
        scheduleScenePoll();
      } else if (message.op === 5) {
        if (d.eventType === 'CurrentProgramSceneChanged' || d.eventType === 'SceneTransitionEnded') {
          void refreshProgramScene();
        } else if (d.eventType === 'SceneListChanged') {
          scenes = (d.eventData?.scenes ?? []).map(scene => scene.sceneName).filter(Boolean);
          emitter.emit('scenes', scenes.slice()); publish();
        }
      } else if (message.op === 7) {
        const waiter = requestWaiters.get(d.requestId);
        if (!waiter) return;
        requestWaiters.delete(d.requestId); clearTimer(waiter.timer);
        if (!d.requestStatus?.result) waiter.reject(new Error(`OBS ${waiter.requestType} failed (${d.requestStatus?.code ?? 'unknown'}).`));
        else waiter.resolve(d.responseData ?? {});
      }
    });
    socket.on('close', () => {
      connected = false;
      if (scenePollTimer) clearTimer(scenePollTimer);
      scenePollTimer = null;
      failWaiters(new Error('OBS connection closed.'));
      scheduleReconnect();
    });
    socket.on('error', () => {});
  }

  function failWaiters(error) {
    for (const waiter of requestWaiters.values()) { clearTimer(waiter.timer); waiter.reject(error); }
    requestWaiters.clear();
  }

  function start() { closedByUser = false; if (password) connect(); else publish(); }
  function close() {
    closedByUser = true; connected = false;
    if (retryTimer) clearTimer(retryTimer);
    if (scenePollTimer) clearTimer(scenePollTimer);
    retryTimer = null; scenePollTimer = null; failWaiters(new Error('OBS client closed.'));
    socket?.close();
  }

  const api = {
    on(...args) { emitter.on(...args); return api; },
    off(...args) { emitter.off(...args); return api; },
    start, close, request, status,
    getSceneList: async () => connected ? { scenes: scenes.slice(), currentProgramSceneName: currentProgramScene, obsStudioVersion: version } : null
  };
  return api;
}
