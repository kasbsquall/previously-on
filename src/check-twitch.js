import { createTwitchAuth } from './twitch/auth.js';
import { sendChat, twitchRequest } from './twitch/api.js';
import { createEventSubClient } from './twitch/eventsub.js';

const clientId = process.env.TWITCH_CLIENT_ID;
const channel = process.env.TWITCH_CHANNEL;
if (!channel) throw new Error('TWITCH_CHANNEL is required in .env.');

const auth = createTwitchAuth({ clientId });
const identity = await auth.validate();
const accessToken = await auth.getAccessToken();
const users = await twitchRequest(`users?login=${encodeURIComponent(channel)}`, { clientId, accessToken });
const broadcaster = users.data?.[0];
if (!broadcaster) throw new Error(`Twitch channel not found: ${channel}`);
if (identity.user_id !== broadcaster.id) throw new Error('The authorized Twitch account must be the broadcaster account.');
console.log(`Twitch login: ${identity.login}`);
console.log(`Broadcaster type: ${broadcaster.broadcaster_type || '(none)'}`);

const eventSub = createEventSubClient({ clientId, getAccessToken: auth.getAccessToken.bind(auth), broadcasterId: broadcaster.id, userId: identity.user_id });
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Timed out waiting for a chat message after 60 seconds.')), 60_000);
  eventSub.on('error', error => { clearTimeout(timeout); reject(error); });
  eventSub.on('event', async event => {
    if (event.kind !== 'chat') return;
    clearTimeout(timeout);
    eventSub.close();
    console.log(`Chat message from ${event.user}: ${event.text}`);
    try {
      await sendChat('Previously On check: connected.', {
        clientId, accessToken: await auth.getAccessToken(), broadcasterId: broadcaster.id, senderId: identity.user_id
      });
      console.log('Connection check message sent.');
      resolve();
    } catch (error) { reject(error); }
  });
  eventSub.start();
});
