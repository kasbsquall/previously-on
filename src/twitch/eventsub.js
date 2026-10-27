import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { twitchRequest } from './api.js';

export function normalizeEvent(type, event, timestamp, { botUserId } = {}) {
  if (!event || typeof event !== 'object') return null;
  if (type === 'channel.chat.message') {
    const text = event.message?.text;
    const botOutput = typeof text === 'string' && /^\s*(?:@\S+\s+)?Previously(?:\s+on| On check)?\s*:/i.test(text);
    if (event.chatter_user_id === botUserId && botOutput) return null;
    return { kind: 'chat', t: timestamp, user: event.chatter_user_name, text, raw: event };
  }
  if (type === 'channel.raid') {
    return { kind: 'raid', t: timestamp, user: event.from_broadcaster_user_name, text: `Raid from ${event.from_broadcaster_user_name} with ${event.viewers} viewers`, raw: event };
  }
  if (type === 'channel.ad_break.begin') {
    return { kind: 'ad_break', t: timestamp, user: event.requester_user_name, text: `Ad break started for ${event.duration_seconds} seconds`, raw: event };
  }
  return null;
}

export function routeEventSubMessage(message, options) {
  const type = message?.metadata?.message_type;
  if (type !== 'notification') return { type, event: null };
  const payload = message.payload;
  const subscriptionType = payload?.subscription?.type ?? message.metadata.subscription_type;
  return { type, event: normalizeEvent(subscriptionType, payload?.event, message.metadata.message_timestamp, options) };
}

export function createEventSubClient({ clientId, getAccessToken, broadcasterId, userId, fetchImpl = fetch, WebSocketImpl = WebSocket, log = console.log, backoff = [1000, 2000, 5000, 10000], setTimer = setTimeout, clearTimer = clearTimeout, keepaliveGraceMs = 5000 }) {
  const emitter = new EventEmitter();
  let stopped = false;
  let socket;
  let retryIndex = 0;
  let currentUrl = 'wss://eventsub.wss.twitch.tv/ws';
  let retryTimer;
  let transferFrom;
  let keepaliveTimer;
  let keepaliveSeconds;

  async function subscribe(sessionId) {
    const accessToken = await getAccessToken();
    for (const subscription of [
      { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: broadcasterId, user_id: userId } },
      { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: broadcasterId } },
      { type: 'channel.ad_break.begin', version: '1', condition: { broadcaster_user_id: broadcasterId } }
    ]) {
      await twitchRequest('eventsub/subscriptions', {
        clientId, accessToken, fetchImpl, method: 'POST',
        body: { ...subscription, transport: { method: 'websocket', session_id: sessionId } }
      });
    }
  }

  function scheduleReconnect(url, reason) {
    if (stopped || retryTimer) return;
    log(`EventSub reconnect: ${reason}.`);
    emitter.emit('reconnecting');
    currentUrl = url ?? 'wss://eventsub.wss.twitch.tv/ws';
    const wait = backoff[Math.min(retryIndex++, backoff.length - 1)];
    retryTimer = setTimer(() => { retryTimer = null; connect(); }, wait);
    retryTimer.unref?.();
  }

  function connect(url = currentUrl, transfer = false) {
    if (stopped) return;
    emitter.emit('connecting');
    const activeSocket = new WebSocketImpl(url);
    socket = activeSocket;
    let reconnectReason;
    const resetKeepalive = seconds => {
      if (seconds) keepaliveSeconds = seconds;
      clearTimer(keepaliveTimer);
      if (keepaliveSeconds) {
        keepaliveTimer = setTimer(() => {
          reconnectReason = 'keepalive timeout';
          activeSocket.terminate();
        }, keepaliveSeconds * 1000 + keepaliveGraceMs);
        keepaliveTimer.unref?.();
      }
    };
    activeSocket.on('message', async raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      resetKeepalive(message.payload?.session?.keepalive_timeout_seconds);
      const type = message.metadata?.message_type;
      if (type === 'session_welcome') {
        retryIndex = 0;
        const session = message.payload?.session;
        try {
          if (!transfer) await subscribe(session.id);
          if (transfer && transferFrom) {
            transferFrom.close();
            transferFrom = null;
          }
          emitter.emit('connected', session);
        } catch (error) {
          reconnectReason = 'error';
          emitter.emit('error', error);
          activeSocket.close();
        }
      } else if (type === 'session_keepalive') {
        emitter.emit('keepalive');
      } else if (type === 'session_reconnect') {
        const url = message.payload?.session?.reconnect_url;
        if (url) {
          log('EventSub reconnect: session_reconnect.');
          currentUrl = url;
          transferFrom = activeSocket;
          connect(url, true);
        }
      } else if (type === 'revocation') {
        emitter.emit('revocation', message.payload?.subscription);
        log(`EventSub subscription revoked: ${message.payload?.subscription?.type ?? 'unknown'} (${message.payload?.subscription?.status ?? 'unknown'})`);
      } else {
        const routed = routeEventSubMessage(message, { botUserId: userId });
        if (routed.event) emitter.emit('event', routed.event);
      }
    });
    activeSocket.on('error', error => {
      reconnectReason = 'error';
      emitter.emit('error', error);
    });
    activeSocket.on('close', code => {
      if (activeSocket === socket) {
        clearTimer(keepaliveTimer);
        if (!stopped) scheduleReconnect(undefined, reconnectReason ?? `close code ${code ?? 'unknown'}`);
      }
    });
  }

  const client = {
    on(...args) { emitter.on(...args); return client; },
    start() { connect(); return client; },
    close() { stopped = true; clearTimer(retryTimer); clearTimer(keepaliveTimer); socket?.close(); transferFrom?.close(); }
  };
  return client;
}
