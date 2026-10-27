import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApprovalSettings } from './approval-settings.js';
import { buildRecap } from '../recap/index.js';

const ON_AIR_MS = 15_000;
const CATCHUP_VIEWER_COOLDOWN = 120_000;
const CATCHUP_GLOBAL_COOLDOWN = 30_000;
const MAX_CHAT_CHARACTERS = 500;

export function createCardPipeline({
  sourceBuffer,
  channel,
  broadcasterId,
  sendChat = async () => {},
  recap = buildRecap,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  mode = 'real',
  adBreakTimeScale = 1,
  onDecided,
  approvalSettings = createApprovalSettings(),
  featureSettings = { get: () => ({ narratorVoice: true, soundEffects: true }), set: async value => value },
  narrator,
  clipReceipts,
  logChat = line => console.log(`Chat preview: ${line}`),
  log = line => console.log(line)
}) {
  const emitter = new EventEmitter();
  const cooldowns = new Map();
  const cards = [];
  const voiceSegments = [];
  let pending = null;
  let onAirCard = null;
  let onAirTimer = null;
  let lastOnAirAt = null;
  let lastGlobalCatchupAt = null;
  let breakStartedAt = null;
  let breakSimulated = false;
  let voiceEnabled = false;
  let latestTriggerSequence = 0;
  const sentMessageIds = new Set();

  function publishState() {
    emitter.emit('state', getState());
  }

  function getState() {
    const current = now();
    return {
      mode,
      demo: mode === 'demo',
      pending: pending ? publicCard(pending) : null,
      onAir: onAirCard ? { ...publicCard(onAirCard), until: onAirCard.onAirUntil } : null,
      cards: cards.slice(0, 20).map(card => ({ ...card })),
      onBreak: breakStartedAt !== null,
      voiceEnabled,
      voiceSegments: voiceSegments.slice(-3),
      modelEnabled: Boolean(process.env.OPENAI_API_KEY),
      approvalMode: approvalSettings.get().mode,
      approvalSeconds: approvalSettings.get().seconds,
      narratorVoiceEnabled: featureSettings.get().narratorVoice,
      soundEffectsEnabled: featureSettings.get().soundEffects
    };
  }

  function addLog(card) {
    const existing = cards.findIndex(item => item.id === card.id);
    if (existing >= 0) cards.splice(existing, 1);
    cards.unshift(publicCard(card));
    cards.splice(20);
    emitter.emit('log', cards.slice(0, 20));
  }

  function recordDecision(card) {
    if (mode !== 'real' || !onDecided) return;
    Promise.resolve(onDecided(card, mode)).catch(error => emitter.emit('log:error', error));
  }

  async function buildCard({ trigger, event, simulated = false, from, fallbackFrom, to, overlayEligible = true, triggerInfo = {}, receiptPromise }) {
    const sequence = ++latestTriggerSequence;
    const end = to ?? now();
    const start = from ?? end - (trigger === 'raid' ? 10 : trigger === 'catchup' ? 5 : 10) * 60_000;
    const windowMinutes = trigger === 'catchup' ? 5 : trigger === 'ad-break' ? 4 : 10;
    let selected = await sourceBuffer.window({ from: start, to: end, max: 120 });
    if (trigger === 'ad-break' && !hasRecapSources(selected)) {
      selected = await sourceBuffer.window({ from: fallbackFrom ?? end - 10 * 60_000, to: end, max: 120 });
    }
    const items = selected.map((item, index) => ({ ...item, id: `S${index + 1}` }));
    const recapResult = await recap({ trigger, items, channel, windowMinutes });
    if (sequence !== latestTriggerSequence) return null;
    let headline = recapResult.headline;
    let bullets = recapResult.bullets;
    let engine = recapResult.engine;
    let provenance = recapResult.provenance;
    let welcomeOnly = false;
    const hasContent = hasRecapSources(items);
    if (!hasContent && trigger === 'raid') {
      welcomeOnly = true;
      headline = `Welcome, raiders from ${triggerInfo.name}`;
      bullets = [{ text: 'The stream just got started, nothing to catch up on yet', sources: [] }];
      engine = 'fallback';
      provenance = recapResult.provenance;
    } else if (!hasContent && trigger === 'ad-break') {
      recordDroppedAdBreak({ simulated, provenance });
      return null;
    } else if (!hasContent || !bullets.length) {
      return null;
    }
    if (pending) {
      clearTimer(pending.timer);
      pending.status = 'Replaced';
      pending.updatedAt = now();
      addLog(pending);
      recordDecision(pending);
      pending = null;
    }
    const sourceById = new Map(items.map(item => [item.id, item]));
    const sourceDetails = bullets.flatMap(bullet => bullet.sources.map(id => {
      const item = sourceById.get(id);
      return item ? { id, kind: item.kind, text: item.text, user: item.user } : null;
    }).filter(Boolean));
    const card = {
      id: randomUUID(),
      channel,
      trigger,
      triggerInfo,
      simulated,
      headline,
      bullets,
      welcomeOnly,
      sourceDetails,
      provenance,
      engine,
      latencyMs: recapResult.latencyMs,
      droppedBullets: recapResult.droppedBullets ?? [],
      overlayEligible,
      replyParentMessageId: trigger === 'catchup' ? event.raw?.message_id : undefined,
      status: 'Waiting',
      createdAt: now(),
      approvalMode: approvalSettings.get().mode,
      approvalSeconds: approvalSettings.get().seconds
    };
    if (receiptPromise) card.receiptPromise = receiptPromise;
    if (featureSettings.get().narratorVoice) {
      try {
        const audio = await narrator?.generate({ cardId: card.id, channel, headline, bullets });
        if (audio) {
          card.audioUrl = audio.audioUrl;
          card.voiceDurationMs = audio.durationMs;
        } else log(`Narrator voice unavailable for card ${card.id}.`);
      } catch (error) {
        log(`Narrator voice unavailable for card ${card.id}.`);
      }
    }
    if (sequence !== latestTriggerSequence) return null;
    setPendingTimer(card);
    pending = card;
    addLog(card);
    if (receiptPromise) Promise.resolve(receiptPromise).then(receipt => {
      card.clipUrl = receipt?.clipUrl ?? null;
      addLog(card);
      publishState();
    }).catch(() => {});
    emitter.emit('pending', publicCard(card));
    publishState();
    return publicCard(card);
  }

  function recordDroppedAdBreak({ simulated, provenance }) {
    const headline = 'Ad break: nothing new to recap';
    log(headline);
    addLog({
      id: randomUUID(), channel, trigger: 'ad-break', triggerInfo: { name: 'Ad break' },
      simulated, headline, bullets: [], welcomeOnly: false, sourceDetails: [], provenance,
      engine: 'fallback', latencyMs: 0, droppedBullets: [], overlayEligible: false,
      status: 'Dropped', createdAt: now()
    });
  }

  async function approve(cardId = pending?.id, automatic = false) {
    if (!pending || pending.id !== cardId) return false;
    const card = pending;
    pending = null;
    clearTimer(card.timer);
    card.status = card.overlayEligible ? 'Shown' : 'Chat only';
    card.updatedAt = now();
    addLog(card);
    recordDecision(card);
    emitter.emit('approved', { ...publicCard(card), automatic });
    if (card.overlayEligible) {
      if (onAirTimer) clearTimer(onAirTimer);
      lastOnAirAt = now();
      const airDuration = Math.max(ON_AIR_MS, 1200 + 760 + (card.voiceDurationMs ?? 0) + 2000);
      card.onAirUntil = lastOnAirAt + airDuration;
      onAirCard = card;
      emitter.emit('card:show', publicCard(card));
      onAirTimer = setTimer(() => {
        onAirTimer = null;
        onAirCard = null;
        emitter.emit('card:hide', { id: card.id });
        publishState();
      }, airDuration);
    }
    publishState();
    let clipUrl = null;
    if (card.receiptPromise) {
      try { clipUrl = (await card.receiptPromise)?.clipUrl ?? null; }
      catch { clipUrl = null; }
      card.clipUrl = clipUrl;
      addLog(card);
      publishState();
    }
    const line = chatLineFor(card, clipUrl);
    try {
      if (mode === 'demo') logChat(line);
      else {
        const sent = await sendChat(line, card);
        if (sent?.message_id) {
          sentMessageIds.add(sent.message_id);
          if (sentMessageIds.size > 500) sentMessageIds.delete(sentMessageIds.values().next().value);
        }
      }
    } catch (error) {
      emitter.emit('chat:error', { cardId: card.id, message: error.message });
    }
    return true;
  }

  function veto(cardId = pending?.id) {
    if (!pending || pending.id !== cardId) return false;
    const card = pending;
    pending = null;
    clearTimer(card.timer);
    card.status = 'Vetoed';
    card.updatedAt = now();
    addLog(card);
    recordDecision(card);
    emitter.emit('vetoed', publicCard(card));
    publishState();
    return true;
  }

  async function setApprovalSettings(value) {
    const settings = await approvalSettings.set(value);
    if (pending) {
      clearTimer(pending.timer);
      pending.approvalMode = settings.mode;
      pending.approvalSeconds = settings.seconds;
      pending.deadline = settings.mode === 'timed' ? now() + settings.seconds * 1000 : null;
      setPendingTimer(pending);
      addLog(pending);
      emitter.emit('pending', publicCard(pending));
    }
    publishState();
    return settings;
  }

  async function setFeatureSettings(value) {
    const settings = await featureSettings.set(value);
    publishState();
    return settings;
  }

  function setPendingTimer(card) {
    card.timer = card.approvalMode === 'timed'
      ? setTimer(() => { void approve(card.id, true); }, card.approvalSeconds * 1000)
      : null;
    card.deadline = card.approvalMode === 'timed' ? now() + card.approvalSeconds * 1000 : null;
  }

  async function handleRaid(event, { simulated = false } = {}) {
    const raider = event.from_broadcaster_user_name;
    const raidText = `raid from ${raider} with ${event.viewers} viewers`;
    const eventTime = new Date(now()).toISOString();
    await sourceBuffer.add({ t: eventTime, twitchTime: event.started_at, kind: 'event', text: raidText, user: raider });
    const receiptPromise = captureReceipt('raid', simulated);
    return buildCard({
      trigger: 'raid', event, simulated,
      triggerInfo: { name: raider, viewerCount: event.viewers }, receiptPromise
    });
  }

  async function handleChat(event, { simulated = false } = {}) {
    const chatterId = event.raw?.chatter_user_id ?? event.userId;
    const messageId = event.raw?.message_id;
    if (chatterId === broadcasterId && (
      (messageId && sentMessageIds.has(messageId)) || isBotOutput(event.text)
    )) return null;
    const isCommand = /^\s*!/u.test(event.text ?? '');
    if (!isCommand) {
      await sourceBuffer.add({
        t: new Date(now()).toISOString(),
        ...(event.t ? { twitchTime: event.t } : {}),
        kind: 'chat', text: event.text, user: event.user
      });
    }
    if (!/^\s*!catchup(?:\s|$)/i.test(event.text ?? '')) return null;
    const userId = chatterId ?? event.user;
    const lastUser = cooldowns.get(userId) ?? -Infinity;
    const current = now();
    if (current - lastUser < CATCHUP_VIEWER_COOLDOWN || current - (lastGlobalCatchupAt ?? -Infinity) < CATCHUP_GLOBAL_COOLDOWN) return null;
    cooldowns.set(userId, current);
    lastGlobalCatchupAt = current;
    const overlayEligible = lastOnAirAt === null || current - lastOnAirAt >= 60_000;
    return buildCard({
      trigger: 'catchup', event, simulated, overlayEligible,
      triggerInfo: { name: event.user, viewerId: userId }
    });
  }

  async function handleAdBreak(event, { simulated = false, timeScale = adBreakTimeScale } = {}) {
    const eventText = `ad break began for ${event.duration_seconds} seconds`;
    const receivedAt = now();
    const receivedTime = new Date(receivedAt).toISOString();
    await sourceBuffer.add({
      t: receivedTime,
      twitchTime: event.started_at,
      kind: 'event',
      text: eventText,
      user: event.requester_user_name
    });
    const receiptPromise = captureReceipt('ad-break', simulated);
    const start = receivedAt;
    const durationSeconds = Number(event.duration_seconds);
    const end = start + durationSeconds * 1000;
    const delay = Math.max(0, (end - now()) * timeScale);
    setTimer(() => {
      void buildCard({
        trigger: 'ad-break', event, simulated,
        from: start - 180_000,
        fallbackFrom: start - 10 * 60_000,
        to: end,
        triggerInfo: { seconds: durationSeconds, name: 'Ad break' }, receiptPromise
      });
    }, delay);
    const result = { payload: event, scheduledAt: end };
    emitter.emit('ad-break:scheduled', result);
    return result;
  }

  async function handleEvent(event) {
    if (event.kind === 'chat') return handleChat(event);
    if (event.kind === 'raid') return handleRaid(event.raw ?? event);
    if (event.kind === 'ad_break') return handleAdBreak(event.raw ?? event);
    return null;
  }

  function goingOnBreak({ simulated = mode === 'demo' } = {}) {
    breakStartedAt = now();
    breakSimulated = simulated;
    emitter.emit('break', { onBreak: true, startedAt: breakStartedAt });
    publishState();
    return breakStartedAt;
  }

  async function backFromBreak({ simulated = breakSimulated || mode === 'demo' } = {}) {
    if (breakStartedAt === null) {
      const error = new Error('A break has not been started.');
      error.statusCode = 400;
      throw error;
    }
    const startedAt = breakStartedAt;
    breakStartedAt = null;
    breakSimulated = false;
    const endedAt = now();
    const minutesAway = Math.max(1, Math.round((endedAt - startedAt) / 60_000));
    emitter.emit('break', { onBreak: false, startedAt });
    publishState();
    return buildCard({
      trigger: 'break',
      simulated,
      from: startedAt - 10 * 60_000,
      to: startedAt,
      triggerInfo: { name: 'Break', minutesAway }
    });
  }

  function simulateAdBreak() {
    const timestamp = new Date(now()).toISOString();
    const event = {
      duration_seconds: 60,
      started_at: timestamp,
      is_automatic: false,
      broadcaster_user_id: broadcasterId ?? 'demo-broadcaster',
      broadcaster_user_login: channel.toLowerCase(),
      broadcaster_user_name: channel,
      requester_user_id: broadcasterId ?? 'demo-broadcaster',
      requester_user_login: channel.toLowerCase(),
      requester_user_name: channel
    };
    return handleAdBreak(event, { simulated: true });
  }

  function simulateRaid() {
    return handleRaid({
      from_broadcaster_user_id: 'synthetic-raider',
      from_broadcaster_user_login: 'cozycampfire',
      from_broadcaster_user_name: 'CozyCampfire',
      to_broadcaster_user_id: broadcasterId ?? 'demo-broadcaster',
      to_broadcaster_user_login: channel.toLowerCase(),
      to_broadcaster_user_name: channel,
      viewers: 14,
      started_at: new Date(now()).toISOString()
    }, { simulated: true });
  }

  function simulateCatchup() {
    return handleChat({
      t: new Date(now()).toISOString(),
      user: 'FernAndFable',
      userId: 'synthetic-viewer',
      text: '!catchup',
      raw: { chatter_user_id: 'synthetic-viewer' }
    }, { simulated: true });
  }

  async function addVoiceSegment(text) {
    const segment = await sourceBuffer.add({ t: new Date(now()).toISOString(), kind: 'voice', text, user: channel });
    voiceSegments.push(segment);
    voiceSegments.splice(0, Math.max(0, voiceSegments.length - 3));
    emitter.emit('voice:segment', segment);
    publishState();
    return segment;
  }

  function captureReceipt(trigger, simulated) {
    if (clipReceipts) return clipReceipts.capture({ trigger, simulated });
    if (simulated) log('Twitch clip receipt skipped because the trigger was simulated.');
    return undefined;
  }

  async function addNote(text) {
    const note = await sourceBuffer.add({ t: new Date(now()).toISOString(), kind: 'note', text, user: channel });
    emitter.emit('note', note);
    return note;
  }

  function setVoiceEnabled(enabled) {
    voiceEnabled = Boolean(enabled);
    emitter.emit('voice:enabled', voiceEnabled);
    publishState();
  }

  function logAudioFailure(cardId) {
    if (!CARD_ID_RE.test(String(cardId)) || !cards.some(card => card.id === cardId)) return false;
    log(`Narrator playback unavailable for card ${cardId}.`);
    return true;
  }

  const api = {
    on(...args) { emitter.on(...args); return api; },
    getState,
    handleEvent,
    handleChat,
    handleRaid,
    handleAdBreak,
    goingOnBreak,
    backFromBreak,
    simulateAdBreak,
    simulateRaid,
    simulateCatchup,
    addVoiceSegment,
    addNote,
    setVoiceEnabled,
    notifyState: publishState,
    approve,
    veto,
    setApprovalSettings,
    setFeatureSettings,
    logAudioFailure
  };
  return api;

  function publicCard(card) {
    const { timer, deadline, receiptPromise, ...copy } = card;
    return {
      ...copy,
      remainingMs: pending?.id === card.id
        ? deadline === null ? null : Math.max(0, deadline - now())
        : 0
    };
  }

  function chatLineFor(card, clipUrl) {
    let prefix = 'Previously on: ';
    if (card.welcomeOnly) return appendClip(`${prefix}Welcome raiders from ${card.triggerInfo.name}. The stream just got started, nothing to catch up on yet.`, clipUrl);
    if (card.trigger === 'raid') prefix += `Welcome raiders from ${card.triggerInfo.name}. `;
    const parts = [card.headline, ...card.bullets.map(bullet => bullet.text)].filter(Boolean)
      .map(text => text.replace(/[.!?]+$/u, ''));
    let line = `${prefix}${parts.shift() ?? ''}`;
    for (const part of parts) {
      const next = `${line}. ${part}`;
      if ([...next].length > MAX_CHAT_CHARACTERS) break;
      line = next;
    }
    if (line && [...line].length < MAX_CHAT_CHARACTERS) line += '.';
    line = appendClip(line, clipUrl);
    return [...line].length <= MAX_CHAT_CHARACTERS ? line : `${[...line].slice(0, MAX_CHAT_CHARACTERS - 3).join('')}...`;
  }

  function appendClip(line, clipUrl) {
    if (!clipUrl) return line;
    const receipt = ` Watch the moment: ${clipUrl}`;
    if ([...receipt].length >= MAX_CHAT_CHARACTERS) return line;
    if ([...line + receipt].length <= MAX_CHAT_CHARACTERS) return line + receipt;
    const prefix = [...line].slice(0, MAX_CHAT_CHARACTERS - [...receipt].length - 1).join('').replace(/[\s.!?]+$/u, '');
    return `${prefix}…${receipt}`;
  }

}

const CARD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isBotOutput(text) {
  return /^\s*(?:@\S+\s+)?Previously(?:\s+on| On check)?\s*:/i.test(String(text ?? ''));
}

function hasRecapSources(items) {
  return items.some(item => ['voice', 'note', 'chat'].includes(item.kind));
}
