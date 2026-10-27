import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEVICE_ENDPOINT = 'https://id.twitch.tv/oauth2/device';
const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token';
const VALIDATE_ENDPOINT = 'https://id.twitch.tv/oauth2/validate';
export const TWITCH_SCOPES = [
  'user:read:chat',
  'user:write:chat',
  'user:bot',
  'channel:read:ads',
  'moderator:read:followers',
  'clips:edit',
  'channel:manage:broadcast'
];

export class TwitchAuthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TwitchAuthError';
    this.details = details;
  }
}

export async function pollDeviceCode({ deviceCode, interval, expiresIn, clientId, fetchImpl = fetch, sleep = delay, now = Date.now }) {
  const expiresAt = now() + expiresIn * 1000;
  let waitSeconds = interval;
  while (now() < expiresAt) {
    await sleep(waitSeconds * 1000);
    if (now() >= expiresAt) break;
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        scopes: TWITCH_SCOPES.join(' '),
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });
    const body = await response.json();
    if (response.ok) return body;
    if (body.message === 'authorization_pending') continue;
    if (body.message === 'slow_down') {
      waitSeconds += 5;
      continue;
    }
    if (body.message === 'expired_token') throw new TwitchAuthError('Device code expired. Run check-twitch again.');
    throw new TwitchAuthError(`Device code authorization failed: ${body.message ?? response.status}`);
  }
  throw new TwitchAuthError('Device code expired. Run check-twitch again.');
}

export function createTwitchAuth({ clientId = process.env.TWITCH_CLIENT_ID, tokenPath = '.data/tokens.json', fetchImpl = fetch, log = console.log, now = Date.now } = {}) {
  if (!clientId) throw new TwitchAuthError('TWITCH_CLIENT_ID is required in .env.');

  async function saveTokens(tokens) {
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  }

  async function loadTokens() {
    try {
      return JSON.parse(await readFile(tokenPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function requestDeviceAuthorization() {
    const response = await fetchImpl(DEVICE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scopes: TWITCH_SCOPES.join(' ') })
    });
    const body = await response.json();
    if (!response.ok) throw new TwitchAuthError(`Could not start device authorization: ${body.message ?? response.status}`);
    log(`Twitch user code: ${body.user_code}`);
    log(`Verification URL: ${body.verification_uri}`);
    return body;
  }

  async function refresh(tokens) {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
    });
    const body = await response.json();
    if (!response.ok) throw new TwitchAuthError(`Could not refresh Twitch authorization: ${body.message ?? response.status}`);
    const renewed = { ...tokens, ...body, expires_at: now() + body.expires_in * 1000 };
    await saveTokens(renewed);
    return renewed;
  }

  async function acquire() {
    let tokens = await loadTokens();
    const requestedScopes = tokens?.requested_scopes;
    const hasRequestedCurrentScopes = Array.isArray(requestedScopes) && TWITCH_SCOPES.every(scope => requestedScopes.includes(scope));
    if (!tokens || !hasRequestedCurrentScopes) {
      const device = await requestDeviceAuthorization();
      tokens = await pollDeviceCode({
        deviceCode: device.device_code,
        interval: device.interval,
        expiresIn: device.expires_in,
        clientId,
        fetchImpl,
        now
      });
      tokens.expires_at = now() + tokens.expires_in * 1000;
      tokens.requested_scopes = [...TWITCH_SCOPES];
      await saveTokens(tokens);
    }
    if (!tokens.expires_at || tokens.expires_at <= now() + 60_000) tokens = await refresh(tokens);
    return tokens;
  }

  async function validate() {
    const tokens = await acquire();
    let response = await fetchImpl(VALIDATE_ENDPOINT, { headers: { authorization: `OAuth ${tokens.access_token}` } });
    if (response.status === 401) {
      const renewed = await refresh(tokens);
      response = await fetchImpl(VALIDATE_ENDPOINT, { headers: { authorization: `OAuth ${renewed.access_token}` } });
    }
    if (!response.ok) throw new TwitchAuthError(`Twitch token validation failed with status ${response.status}.`);
    return response.json();
  }

  async function getAccessToken() {
    const tokens = await acquire();
    return tokens.access_token;
  }

  return { acquire, validate, getAccessToken, loadTokens, saveTokens };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
