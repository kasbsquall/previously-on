import { twitchRequest } from './api.js';

export function createClipReceipts({ clientId, broadcasterId, scopes = [], getAccessToken, request = twitchRequest, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollIntervalMs = 1000, maxWaitMs = 15_000, requestTimeoutMs = 4000, log = line => console.log(line) } = {}) {
  const scopeSet = new Set(scopes);
  async function api(path, options = {}) {
    return request(path, { clientId, accessToken: await getAccessToken(), signal: AbortSignal.timeout(requestTimeoutMs), ...options });
  }
  async function capture({ trigger, simulated = false } = {}) {
    if (simulated) {
      log('Twitch clip receipt skipped because the trigger was simulated.');
      return { clipUrl: null, markerCreated: false, skipped: true };
    }
    const triggerLabel = trigger === 'raid' ? 'raid' : 'ad break';
    let markerCreated = false;
    if (!scopeSet.has('channel:manage:broadcast')) log(`Twitch stream marker skipped for ${triggerLabel}: missing channel:manage:broadcast scope.`);
    else {
      try {
        await api('streams/markers', { method: 'POST', body: { user_id: broadcasterId, description: `Previously On: ${triggerLabel}` } });
        markerCreated = true;
      } catch (error) { log(`Twitch stream marker failed for ${triggerLabel}: ${oneLine(error.message)}.`); }
    }
    if (!scopeSet.has('clips:edit')) {
      log(`Twitch clip skipped for ${triggerLabel}: missing clips:edit scope.`);
      return { clipUrl: null, markerCreated };
    }
    try {
      const created = await api(`clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&has_delay=false`, { method: 'POST' });
      const clipId = created?.data?.[0]?.id;
      if (!clipId) throw new Error('Twitch returned no clip id');
      const deadline = Date.now() + maxWaitMs;
      do {
        const clips = await api(`clips?id=${encodeURIComponent(clipId)}`);
        const clipUrl = clips?.data?.[0]?.url;
        if (clipUrl) return { clipUrl, markerCreated };
        if (Date.now() >= deadline) break;
        await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      } while (Date.now() <= deadline);
      throw new Error('clip was not ready within 15 seconds');
    } catch (error) {
      log(`Twitch clip failed for ${triggerLabel}: ${oneLine(error.message)}.`);
      return { clipUrl: null, markerCreated };
    }
  }
  return { capture };
}

function oneLine(value) { return String(value ?? 'request error').replace(/[\r\n]+/g, ' ').slice(0, 180); }
