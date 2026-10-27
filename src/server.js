import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const HANKEN_DIR = fileURLToPath(new URL('../node_modules/@fontsource-variable/hanken-grotesk/files/', import.meta.url));
const PHOSPHOR_DIR = fileURLToPath(new URL('../node_modules/@phosphor-icons/web/src/light/', import.meta.url));
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.ogg', 'audio/ogg'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.svg', 'image/svg+xml'],
  ['.wav', 'audio/wav']
]);

export function formatSSE(event, data, id) {
  const lines = [];
  if (id !== undefined) lines.push(`id: ${String(id).replace(/[\r\n]/g, '')}`);
  lines.push(`event: ${String(event).replace(/[\r\n]/g, '')}`);
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  lines.push(`data: ${json}`, '', '');
  return lines.join('\n');
}

export function isAllowedOrigin(origin, port) {
  return origin === `http://127.0.0.1:${port}`;
}

export function createServer({ pipeline, getConnection = () => 'offline', getObsState = () => ({ status: 'not configured', scenes: [] }), setObsBreakScene = async () => '', getObsBreakScene = () => '', port = Number(process.env.PORT) || 4777, mode = 'real', narrator } = {}) {
  if (!pipeline) throw new TypeError('A card pipeline is required.');
  const bus = new EventEmitter();
  let httpServer;
  const publicOrigin = () => `http://127.0.0.1:${httpServer?.address()?.port ?? port}`;
  const getPublicState = () => ({
    ...pipeline.getState(),
    connection: mode === 'demo' ? 'demo' : getConnection(),
    mode,
    demo: mode === 'demo',
    voiceApiAvailable: true,
    obs: { ...getObsState(), breakScene: getObsBreakScene() }
  });

  for (const eventName of ['state', 'pending', 'approved', 'vetoed', 'log', 'break', 'voice:segment', 'voice:enabled', 'note', 'card:show', 'card:hide', 'chat:error', 'ad-break:scheduled']) {
    pipeline.on(eventName, data => bus.emit(eventName, eventName === 'state' ? getPublicState() : data));
  }

  httpServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? '/', publicOrigin());
    if (request.method === 'GET') {
      if (url.pathname === '/events') return handleSSE(request, response, bus, getPublicState);
      if (url.pathname === '/api/state') return sendJSON(response, 200, getPublicState());
      const audioMatch = /^\/audio\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(url.pathname);
      if (audioMatch) {
        const audioPath = narrator?.audioPathFor(audioMatch[1]);
        if (!audioPath) return sendJSON(response, 404, { error: 'Audio not found.' });
        return serveFile(response, audioPath);
      }
      if (url.pathname.startsWith('/audio/')) return sendJSON(response, 400, { error: 'Invalid audio id.' });
      if (url.pathname === '/overlay') return serveFile(response, join(PUBLIC_DIR, 'overlay.html'));
      if (url.pathname === '/control') return serveFile(response, join(PUBLIC_DIR, 'control.html'));
      if (url.pathname.startsWith('/assets/')) return serveAsset(response, url.pathname.slice('/assets/'.length));
      if (url.pathname.startsWith('/')) return servePublicFile(response, url.pathname);
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      if (!isAllowedOrigin(request.headers.origin, httpServer.address()?.port ?? port)) return sendJSON(response, 403, { error: 'Origin not allowed.' });
      return handlePost(request, response, url.pathname, pipeline);
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found.');
  });

  return httpServer;
}

function handleSSE(request, response, bus, getState) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'"
  });
  response.write(formatSSE('state', getState()));
  const events = ['state', 'pending', 'approved', 'vetoed', 'log', 'break', 'voice:segment', 'voice:enabled', 'note', 'card:show', 'card:hide', 'chat:error', 'ad-break:scheduled'];
  const bound = new Map(events.map(name => {
    const handler = data => response.write(formatSSE(name, data));
    bus.on(name, handler);
    return [name, handler];
  }));
  request.on('close', () => {
    for (const [name, handler] of bound) bus.off(name, handler);
    response.end();
  });
}

async function handlePost(request, response, pathname, pipeline) {
  let body;
  try {
    body = await readJSON(request);
  } catch (error) {
    if (error.statusCode) return sendJSON(response, error.statusCode, { error: error.message });
    console.error('Request body read failed:', error);
    return sendJSON(response, 500, { error: 'Something went wrong. Check the terminal for details.' });
  }
  try {
    let result;
    switch (pathname) {
      case '/api/approve': result = await pipeline.approve(body.cardId); break;
      case '/api/veto': result = pipeline.veto(body.cardId); break;
      case '/api/approval-settings': result = await pipeline.setApprovalSettings(body); break;
      case '/api/obs-break-scene': result = await setObsBreakScene(body.scene); break;
      case '/api/feature-settings': result = await pipeline.setFeatureSettings(body); break;
      case '/api/audio-failure': result = pipeline.logAudioFailure(body.cardId); if (!result) throw requestError('Audio card id is invalid.'); break;
      case '/api/break': result = pipeline.goingOnBreak(); break;
      case '/api/back': result = await pipeline.backFromBreak(); break;
      case '/api/simulate': result = await simulate(body, pipeline); break;
      case '/api/voice-segment':
        result = await pipeline.addVoiceSegment(validText(body.text, 1000));
        break;
      case '/api/note':
        result = await pipeline.addNote(validNote(body.text));
        break;
      case '/api/voice/on': pipeline.setVoiceEnabled(true); result = { enabled: true }; break;
      case '/api/voice/off': pipeline.setVoiceEnabled(false); result = { enabled: false }; break;
      default: return sendJSON(response, 404, { error: 'Unknown endpoint.' });
    }
    return sendJSON(response, 200, { ok: true, result });
  } catch (error) {
    if (error.statusCode >= 400 && error.statusCode < 500) {
      return sendJSON(response, error.statusCode, { error: error.message });
    }
    console.error('Request failed:', error);
    return sendJSON(response, 500, { error: 'Something went wrong. Check the terminal for details.' });
  }
}

async function simulate(body, pipeline) {
  switch (body.type) {
    case 'raid': return pipeline.simulateRaid();
    case 'catchup': return pipeline.simulateCatchup();
    case 'ad-break': return pipeline.simulateAdBreak();
    default: throw requestError('Simulation type must be raid, catchup, or ad-break.');
  }
}

async function readJSON(request) {
  let value = '';
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 16_384) {
      throw requestError('Request body is too large.', 413);
    }
  }
  try { return value ? JSON.parse(value) : {}; }
  catch { throw requestError('Request body must be valid JSON.'); }
}

function validText(value, max) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) throw requestError(`Text must be between 1 and ${max} characters.`);
  return value.trim();
}

function validNote(value) {
  const text = validText(value, 240);
  if (/[\r\n]/.test(text)) throw requestError('A note must be one line.');
  return text;
}

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function servePublicFile(response, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return sendJSON(response, 400, { error: 'Invalid path.' }); }
  const target = resolve(PUBLIC_DIR, `.${decoded}`);
  if (target !== PUBLIC_DIR && !target.startsWith(`${PUBLIC_DIR}${sep}`)) return sendJSON(response, 403, { error: 'Path not allowed.' });
  return serveFile(response, target);
}

async function serveAsset(response, name) {
  let file;
  if (name === 'phosphor-light.css') file = join(PHOSPHOR_DIR, 'style.css');
  else if (name === 'Phosphor-Light.woff2') file = join(PHOSPHOR_DIR, 'Phosphor-Light.woff2');
  else if (name === 'hanken-latin.woff2') file = join(HANKEN_DIR, 'hanken-grotesk-latin-wght-normal.woff2');
  else if (name === 'hanken-latin-ext.woff2') file = join(HANKEN_DIR, 'hanken-grotesk-latin-ext-wght-normal.woff2');
  else if (name === 'OFL.txt') file = join(fileURLToPath(new URL('../node_modules/@fontsource-variable/hanken-grotesk/', import.meta.url)), 'LICENSE');
  else return sendJSON(response, 404, { error: 'Asset not found.' });
  return serveFile(response, file);
}

async function serveFile(response, path) {
  try {
    const data = await readFile(path);
    response.writeHead(200, {
      'content-type': MIME_TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': path.startsWith(PUBLIC_DIR) ? 'no-cache' : 'public, max-age=86400',
      'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'"
    });
    response.end(data);
  } catch (error) {
    sendJSON(response, error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'File not found.' : 'Could not read file.' });
  }
}

function sendJSON(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026'));
}
