import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardPipeline } from '../src/cards/pipeline.js';
import { buildRecap } from '../src/recap/index.js';

const start = Date.parse('2026-10-25T18:00:00Z');

function makeHarness(options = {}) {
  const clock = makeClock(start);
  const stored = [];
  const sent = [];
  const sourceBuffer = {
    async add(item) {
      const added = { id: `source-${stored.length + 1}`, user: null, ...item };
      stored.push(added);
      return added;
    },
    async window({ from = -Infinity, to = Infinity } = {}) {
      return stored.filter(item => Date.parse(item.t) >= from && Date.parse(item.t) <= to)
        .map((item, index) => ({ ...item, sourceId: item.id, id: `S${index + 1}` }));
    }
  };
  const pipeline = createCardPipeline({
    sourceBuffer,
    channel: 'MeadowMoth',
    broadcasterId: 'broadcaster-1',
    sendChat: async (line, card) => { sent.push({ line, card }); },
    recap: async ({ items }) => ({
      headline: 'The greenhouse is ready.',
      bullets: items.length ? [{ text: 'The north path opened.', sources: [items.at(-1).id] }] : [],
      provenance: { voiceSeconds: 60, chatCount: 1, eventCount: 1, noteCount: 0 },
      engine: 'fallback',
      latencyMs: 1
    }),
    now: () => clock.now,
    setTimer: clock.setTimer.bind(clock),
    clearTimer: clock.clearTimer.bind(clock),
    featureSettings: { get: () => ({ narratorVoice: false, soundEffects: true }), set: async value => value },
    ...options
  });
  return { pipeline, clock, stored, sent, sourceBuffer };
}

function makeClock(initial) {
  let nextId = 0;
  const timers = new Map();
  return {
    now: initial,
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: this.now + delay });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    async advance(ms) {
      this.now += ms;
      let entry;
      while ((entry = [...timers.entries()].filter(([, timer]) => timer.at <= this.now).sort((a, b) => a[1].at - b[1].at)[0])) {
        timers.delete(entry[0]);
        entry[1].callback();
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    timers
  };
}

const raid = (overrides = {}) => ({
  from_broadcaster_user_id: 'raider-1',
  from_broadcaster_user_login: 'cozycampfire',
  from_broadcaster_user_name: 'CozyCampfire',
  to_broadcaster_user_id: 'broadcaster-1',
  to_broadcaster_user_login: 'meadowmoth',
  to_broadcaster_user_name: 'MeadowMoth',
  viewers: 14,
  ...overrides
});

test('approval broadcasts a card and sends one recap chat line', async () => {
  const { pipeline, sent } = makeHarness();
  const shown = [];
  pipeline.on('card:show', card => shown.push(card));
  const pending = await pipeline.handleRaid(raid());
  assert.equal(pending.status, 'Waiting');
  assert.equal(await pipeline.approve(pending.id), true);
  assert.equal(shown.length, 1);
  assert.match(sent[0].line, /^Previously on: Welcome raiders from CozyCampfire\./);
});

test('card enters the approval queue while narrator audio generates in the background', async () => {
  let resolveAudio;
  const shown = [];
  const { pipeline, clock } = makeHarness({
    featureSettings: { get: () => ({ narratorVoice: true, soundEffects: true }), set: async value => value },
    narrator: { generate: () => new Promise(resolve => { resolveAudio = resolve; }) }
  });
  pipeline.on('card:show', card => shown.push(card));
  const card = await pipeline.handleRaid(raid());
  assert.equal(card.status, 'Waiting');
  assert.equal(card.voicePending, true);
  const approval = pipeline.approve(card.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shown.length, 0);
  await clock.advance(2999);
  assert.equal(shown.length, 0);
  await clock.advance(1);
  await approval;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].audioUrl, undefined);
  resolveAudio({ audioUrl: '/audio/late', durationMs: 4000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pipeline.getState().onAir.audioUrl, undefined);
});

test('approval uses narrator audio if it is ready before the three-second limit', async () => {
  const shown = [];
  const { pipeline } = makeHarness({
    featureSettings: { get: () => ({ narratorVoice: true, soundEffects: true }), set: async value => value },
    narrator: { generate: async () => ({ audioUrl: '/audio/ready', durationMs: 4321 }) }
  });
  pipeline.on('card:show', card => shown.push(card));
  const card = await pipeline.handleRaid(raid());
  await pipeline.waitForAudio(card.id);
  await pipeline.approve(card.id);
  assert.equal(shown[0].audioUrl, '/audio/ready');
  assert.equal(shown[0].voiceDurationMs, 4321);
});

test('clip receipt link is added to the approved chat line and card log', async () => {
  const { pipeline, sent } = makeHarness({ clipReceipts: { capture: async () => ({ clipUrl: 'https://clips.twitch.tv/receipt', markerCreated: true }) } });
  const card = await pipeline.handleRaid(raid());
  await new Promise(resolve => setImmediate(resolve));
  await pipeline.approve(card.id);
  assert.match(sent[0].line, /Watch the moment: https:\/\/clips\.twitch\.tv\/receipt/);
  assert.equal(pipeline.getState().cards[0].clipUrl, 'https://clips.twitch.tv/receipt');
});

test('dropped ad break cards do not request narrator audio', async () => {
  let narratorCalls = 0;
  const { pipeline, clock } = makeHarness({
    featureSettings: { get: () => ({ narratorVoice: true, soundEffects: true }), set: async value => value },
    narrator: { generate: async () => { narratorCalls++; return { audioUrl: '/audio/id', durationMs: 1000 }; } }
  });
  await pipeline.handleAdBreak({ duration_seconds: 0, started_at: new Date(start).toISOString() }, { simulated: true, timeScale: 0 });
  await clock.advance(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(narratorCalls, 0);
});

test('raid trigger event remains available for provenance while its recap content is filtered', async () => {
  const captured = [];
  const { pipeline, stored } = makeHarness({ recap: async ({ items }) => {
    captured.push(...items);
    return {
      headline: 'A cozy stream.',
      bullets: items.some(item => item.kind === 'note') ? [{ text: 'A viewer joined.', sources: [items.find(item => item.kind === 'note').id] }] : [],
      provenance: { voiceSeconds: 0, chatCount: 0, eventCount: items.filter(item => item.kind === 'event').length, noteCount: 1 },
      engine: 'fallback', latencyMs: 1
    };
  } });
  await pipeline.addNote('The garden is growing.');
  const card = await pipeline.handleRaid(raid());
  assert.equal(stored.at(-1).kind, 'event');
  assert.equal(captured.some(item => item.kind === 'event' && item.text.startsWith('raid from ')), true);
  assert.equal(captured.find(item => item.kind === 'note').text, 'The garden is growing.');
  assert.equal(card.provenance.eventCount, 1);
});

test('demo simulated raid excludes its source id from the model input', async () => {
  const submittedPrompts = [];
  const client = { responses: { parse: async params => {
    submittedPrompts.push(params.input[1].content);
    return { status: 'completed', output_parsed: {
      headline: 'The stream is building a stone bridge',
      bullets: [{ text: 'The river is clear.', sources: ['S1'] }]
    } };
  } } };
  const { pipeline, clock } = makeHarness({
    recap: options => buildRecap({ ...options, modelOptions: { client } })
  });
  await pipeline.addVoiceSegment('The river is clear.');
  const card = await pipeline.simulateRaid();
  assert.equal(card.simulated, true);
  assert.match(submittedPrompts[0], /The river is clear/);
  assert.doesNotMatch(submittedPrompts[0], /raid from CozyCampfire with 14 viewers/i);
  assert.equal(card.engine, 'model');

  await pipeline.handleAdBreak({
    duration_seconds: 1,
    started_at: new Date(start).toISOString(),
    requester_user_name: 'MeadowMoth'
  }, { timeScale: 1 });
  await clock.advance(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(submittedPrompts[1], /The river is clear/);
  assert.doesNotMatch(submittedPrompts[1], /ad break began for 1 seconds/i);
});

test('demo simulated raid fallback excludes all event content', async () => {
  let fallbackItems;
  const { pipeline } = makeHarness({
    recap: options => buildRecap({ ...options, model: async modelArgs => {
      fallbackItems = modelArgs.items;
      throw new Error('model unavailable');
    } })
  });
  await pipeline.addVoiceSegment('The river is clear.');
  const card = await pipeline.simulateRaid();
  assert.equal(card.simulated, true);
  assert.equal(card.headline, 'The last 10 min on stream');
  assert.doesNotMatch(fallbackItems.map(item => item.text).join(' '), /raid from CozyCampfire/i);
  assert.doesNotMatch(card.bullets[0].text, /raid from CozyCampfire/i);
});

test('veto never broadcasts or sends chat', async () => {
  const { pipeline, sent } = makeHarness();
  const shown = [];
  pipeline.on('card:show', card => shown.push(card));
  const pending = await pipeline.handleRaid(raid());
  assert.equal(pipeline.veto(pending.id), true);
  assert.equal(shown.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(pipeline.getState().cards[0].status, 'Vetoed');
});

test('pending card auto-approves after five seconds', async () => {
  const { pipeline, clock, sent } = makeHarness();
  const approved = [];
  pipeline.on('approved', card => approved.push(card));
  await pipeline.handleRaid(raid());
  await clock.advance(4999);
  assert.equal(sent.length, 0);
  await clock.advance(1);
  assert.equal(approved[0].automatic, true);
  assert.equal(sent.length, 1);
});

test('hold approval setting leaves the card pending until explicit approval', async () => {
  const { pipeline, clock, sent } = makeHarness();
  await pipeline.setApprovalSettings({ mode: 'hold' });
  const pending = await pipeline.handleRaid(raid());
  assert.equal(pending.approvalMode, 'hold');
  assert.equal(pending.remainingMs, null);
  await clock.advance(60_000);
  assert.equal(pipeline.getState().pending.status, 'Waiting');
  assert.equal(sent.length, 0);
  await pipeline.approve(pending.id);
  assert.equal(sent.length, 1);
});

test('approval delay setting controls the pending card countdown', async () => {
  const { pipeline, clock, sent } = makeHarness();
  await pipeline.setApprovalSettings({ mode: 'timed', seconds: 10 });
  const pending = await pipeline.handleRaid(raid());
  assert.equal(pending.approvalSeconds, 10);
  await clock.advance(9999);
  assert.equal(sent.length, 0);
  await clock.advance(1);
  assert.equal(sent.length, 1);
});

test('a newer trigger replaces the one pending card', async () => {
  const { pipeline, sent } = makeHarness();
  const first = await pipeline.handleRaid(raid());
  const second = await pipeline.handleRaid(raid({ from_broadcaster_user_name: 'MossyMira' }));
  assert.notEqual(first.id, second.id);
  assert.equal(pipeline.getState().pending.id, second.id);
  assert.ok(pipeline.getState().cards.some(card => card.id === first.id && card.status === 'Replaced'));
  assert.equal(sent.length, 0);
});

test('catch-up respects per-viewer and global cooldowns silently', async () => {
  const { pipeline, clock, stored } = makeHarness();
  await pipeline.handleChat({ t: new Date(clock.now).toISOString(), user: 'MeadowMoth', text: 'The garden is ready.' });
  const makeMessage = (name, id) => ({
    t: new Date(clock.now).toISOString(), user: name, userId: id, text: '!catchup', raw: { chatter_user_id: id }
  });
  const first = await pipeline.handleChat(makeMessage('FernAndFable', 'viewer-1'));
  assert.ok(first);
  assert.equal(await pipeline.handleChat(makeMessage('FernAndFable', 'viewer-1')), null);
  assert.equal(await pipeline.handleChat(makeMessage('PondPal', 'viewer-2')), null);
  await clock.advance(30_001);
  const second = await pipeline.handleChat(makeMessage('PondPal', 'viewer-2'));
  assert.ok(second);
  assert.equal(stored.filter(item => item.kind === 'chat').length, 1);
});

test('raid with no recap sources shows a welcome ticket and still sends the welcome line', async () => {
  const { pipeline, stored, sent } = makeHarness({ recap: buildRecap });
  const shown = [];
  pipeline.on('card:show', card => shown.push(card));
  const pending = await pipeline.handleRaid(raid());
  assert.equal(stored.length, 1);
  assert.equal(pending.welcomeOnly, true);
  assert.equal(pending.headline, 'Welcome, raiders from CozyCampfire');
  assert.deepEqual(pending.bullets, [{ text: 'The stream just got started, nothing to catch up on yet', sources: [] }]);
  assert.equal(pending.provenance.chatCount, 0);
  assert.equal(pending.provenance.eventCount, 1);
  assert.equal(await pipeline.approve(pending.id), true);
  assert.equal(shown[0].bullets.length, 1);
  assert.equal(sent[0].line, 'Previously on: Welcome raiders from CozyCampfire. The stream just got started, nothing to catch up on yet.');
});

test('an ad break with only event sources does not create a pending recap card', async () => {
  const logged = [];
  const { pipeline, clock } = makeHarness({ recap: buildRecap, log: line => logged.push(line) });
  const result = await pipeline.handleAdBreak({
    duration_seconds: 1,
    started_at: new Date(start).toISOString(),
    requester_user_name: 'MeadowMoth'
  }, { timeScale: 0 });
  await clock.advance(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.payload.duration_seconds, 1);
  assert.equal(pipeline.getState().pending, null);
  assert.equal(pipeline.getState().cards[0].status, 'Dropped');
  assert.equal(pipeline.getState().cards[0].headline, 'Ad break: nothing new to recap');
  assert.deepEqual(logged, ['Ad break: nothing new to recap']);
});

test('an ad break widens its window from three to ten minutes when the narrow window has no content', async () => {
  let recapItems = [];
  const { pipeline, clock, sourceBuffer } = makeHarness({ recap: async ({ items }) => {
    recapItems = items;
    const voice = items.find(item => item.kind === 'voice');
    return {
      headline: 'The forest path is open',
      bullets: voice ? [{ text: voice.text, sources: [voice.id] }] : [],
      provenance: { voiceSeconds: 0, chatCount: 0, eventCount: items.filter(item => item.kind === 'event').length, noteCount: 0 },
      engine: 'fallback', latencyMs: 1
    };
  } });
  await sourceBuffer.add({ t: new Date(start - 8 * 60_000).toISOString(), kind: 'voice', text: 'The forest path is open.', user: 'MeadowMoth' });
  await pipeline.handleAdBreak({
    duration_seconds: 1,
    started_at: new Date(start).toISOString(),
    requester_user_name: 'MeadowMoth'
  }, { timeScale: 0 });
  await clock.advance(0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recapItems.some(item => item.kind === 'voice'), true);
  assert.equal(pipeline.getState().pending.trigger, 'ad-break');
  assert.equal(pipeline.getState().pending.bullets[0].text, 'The forest path is open.');
});

test('approved catch-up replies to the triggering chat message', async () => {
  const { pipeline, clock, sent } = makeHarness();
  await pipeline.handleChat({ t: new Date(clock.now).toISOString(), user: 'MeadowMoth', text: 'The garden is ready.' });
  const pending = await pipeline.handleChat({
    t: new Date(clock.now).toISOString(),
    user: 'FernAndFable',
    text: '!catchup',
    raw: { chatter_user_id: 'viewer-3', message_id: 'parent-message-1' }
  });
  assert.ok(pending);
  await pipeline.approve(pending.id);
  assert.equal(sent[0].line, 'Previously on: The greenhouse is ready. The north path opened.');
  assert.equal(sent[0].line.includes('@FernAndFable'), false);
  assert.equal(sent[0].card.replyParentMessageId, 'parent-message-1');
});

test('catch-up includes a chat message when Twitch time is ahead of the local clock', async () => {
  let recapItems = [];
  const { pipeline, clock, stored } = makeHarness({ recap: async ({ items }) => {
    recapItems = items;
    return {
      headline: 'The tower is growing.',
      bullets: items.map(item => ({ text: item.text, sources: [item.id] })).slice(0, 1),
      provenance: { voiceSeconds: 0, chatCount: items.filter(item => item.kind === 'chat').length, eventCount: 0, noteCount: 0 },
      engine: 'fallback', latencyMs: 1
    };
  } });
  const twitchTime = new Date(clock.now + 90_000).toISOString();
  await pipeline.handleChat({
    t: twitchTime, user: 'Artemander95', userId: 'viewer-90', text: 'The bridge is still unfinished.',
    raw: { chatter_user_id: 'viewer-90', message_id: 'clock-skew-content' }
  });
  await pipeline.handleChat({
    t: twitchTime, user: 'Artemander95', userId: 'viewer-90', text: '!catchup',
    raw: { chatter_user_id: 'viewer-90', message_id: 'clock-skew-command' }
  });
  const storedContent = stored.find(item => item.text === 'The bridge is still unfinished.');
  assert.equal(storedContent.t, new Date(clock.now).toISOString());
  assert.equal(storedContent.twitchTime, twitchTime);
  assert.equal(recapItems.some(item => item.kind === 'chat' && item.text === 'The bridge is still unfinished.'), true);
  assert.equal(recapItems.some(item => item.kind === 'chat' && item.text === '!catchup'), false);
  assert.equal(recapItems.filter(item => item.kind === 'chat').length, 1);
});

test('bot output is ignored and remembered sent message IDs are dropped', async () => {
  const { pipeline, stored } = makeHarness({ sendChat: async () => ({ message_id: 'sent-message-1' }) });
  const pending = await pipeline.handleRaid(raid());
  await pipeline.approve(pending.id);
  const countBefore = stored.length;
  assert.equal(await pipeline.handleChat({
    t: new Date(start).toISOString(), user: 'MeadowMoth', userId: 'broadcaster-1',
    text: '@Artemander95 Previously on: The tower grew.',
    raw: { chatter_user_id: 'broadcaster-1', message_id: 'bot-reply-other-id' }
  }), null);
  assert.equal(await pipeline.handleChat({
    t: new Date(start).toISOString(), user: 'MeadowMoth', userId: 'broadcaster-1', text: 'ordinary message',
    raw: { chatter_user_id: 'broadcaster-1', message_id: 'sent-message-1' }
  }), null);
  assert.equal(stored.length, countBefore);
});

test('simulated ad break uses the documented EventSub event fields and schedules at its end', async () => {
  const { pipeline, clock } = makeHarness();
  let scheduled;
  pipeline.on('ad-break:scheduled', data => { scheduled = data; });
  const result = await pipeline.simulateAdBreak();
  assert.deepEqual(Object.keys(result), ['payload', 'scheduledAt']);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.deepEqual(Object.keys(scheduled), ['payload', 'scheduledAt']);
  assert.deepEqual(Object.keys(result.payload), [
    'duration_seconds', 'started_at', 'is_automatic', 'broadcaster_user_id', 'broadcaster_user_login',
    'broadcaster_user_name', 'requester_user_id', 'requester_user_login', 'requester_user_name'
  ]);
  assert.equal(result.payload.duration_seconds, 60);
  assert.equal(result.payload.is_automatic, false);
  assert.equal(result.scheduledAt, clock.now + 60_000);
  assert.equal(scheduled.payload, result.payload);
});
