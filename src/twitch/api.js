export class TwitchApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'TwitchApiError';
    this.status = status;
    this.body = body;
  }
}

export async function twitchRequest(path, { clientId, accessToken, method = 'GET', body, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`https://api.twitch.tv/helix/${path}`, {
    method,
    headers: {
      'Client-Id': clientId,
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new TwitchApiError(`Twitch API request failed with status ${response.status}.`, response.status, result);
  return result;
}

export async function sendChat(text, { clientId, accessToken, broadcasterId, senderId, replyParentMessageId, fetchImpl = fetch } = {}) {
  if (typeof text !== 'string') throw new TypeError('Chat text must be a string.');
  if ([...text].length > 500) throw new RangeError('Chat text cannot exceed 500 characters.');
  const result = await twitchRequest('chat/messages', {
    clientId, accessToken, fetchImpl, method: 'POST',
    body: {
      broadcaster_id: broadcasterId,
      sender_id: senderId,
      message: text,
      ...(replyParentMessageId ? { reply_parent_message_id: replyParentMessageId } : {})
    }
  });
  const message = result?.data?.[0];
  if (!message?.is_sent) {
    const reason = message?.drop_reason;
    throw new TwitchApiError(`Twitch did not send the chat message${reason ? ` (${reason.code}: ${reason.message})` : ''}.`, 200, result);
  }
  return message;
}
