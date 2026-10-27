import { createTwitchAuth } from './twitch/auth.js';
import { createEventSubClient } from './twitch/eventsub.js';
import { sendChat, twitchRequest } from './twitch/api.js';
import { startRuntime } from './runtime.js';
import { createLiveCardLogger } from './cards/live-log.js';

const clientId = process.env.TWITCH_CLIENT_ID;
const channel = process.env.TWITCH_CHANNEL;
if (!channel) throw new Error('TWITCH_CHANNEL is required in .env.');

const auth = createTwitchAuth({ clientId });
const identity = await auth.validate();
const accessToken = await auth.getAccessToken();
const users = await twitchRequest(`users?login=${encodeURIComponent(channel)}`, { clientId, accessToken });
const broadcaster = users.data?.[0];
if (!broadcaster) throw new Error(`Twitch channel not found: ${channel}`);
if (identity.user_id !== broadcaster.id) throw new Error('The authorized account must be the broadcaster account.');

let connection = 'reconnecting';
const runtime = await startRuntime({
  mode: 'real',
  channel: broadcaster.display_name,
  broadcasterId: broadcaster.id,
  onDecided: createLiveCardLogger(),
  getConnection: () => connection,
  sendChat: async (text, card) => sendChat(text, {
    clientId,
    accessToken: await auth.getAccessToken(),
    broadcasterId: broadcaster.id,
    senderId: identity.user_id,
    replyParentMessageId: card.replyParentMessageId
  })
});

const eventSub = createEventSubClient({
  clientId,
  getAccessToken: auth.getAccessToken.bind(auth),
  broadcasterId: broadcaster.id,
  userId: identity.user_id
});
eventSub.on('connecting', () => { connection = 'reconnecting'; runtime.pipeline.notifyState(); });
eventSub.on('connected', () => { connection = 'connected'; runtime.pipeline.notifyState(); });
eventSub.on('event', event => {
  void runtime.pipeline.handleEvent(event).catch(error => console.error(`Trigger error: ${error.message}`));
});
eventSub.on('revocation', subscription => {
  console.error(`EventSub subscription revoked: ${subscription?.type ?? 'unknown'} (${subscription?.status ?? 'unknown'}).`);
});
eventSub.on('error', error => {
  connection = 'reconnecting';
  runtime.pipeline.notifyState();
  console.error(`EventSub error: ${error.message}`);
});
eventSub.start();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    eventSub.close();
    runtime.server.close(() => process.exit(0));
  });
}
