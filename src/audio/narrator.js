import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { WebSocket } from 'ws';

const CARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = 'gpt-realtime-2.1-mini';
const SAMPLE_RATE = 24_000;
export const NARRATOR_TIMEOUT_MS = 20_000;
// Model catalog: https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini; audio session: https://developers.openai.com/api/docs/guides/realtime-conversations.

export function createNarrator({ apiKey = process.env.OPENAI_API_KEY, audioDirectory = '.data/audio', WebSocketImpl = WebSocket, timeoutMs = NARRATOR_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const root = resolve(audioDirectory);
  function audioPathFor(cardId) {
    if (!CARD_ID.test(String(cardId))) return null;
    return resolve(root, `${cardId}.wav`);
  }

  async function generate({ cardId, channel, headline, bullets }) {
    const path = audioPathFor(cardId);
    if (!path) throw new Error('Invalid card id for narrator audio.');
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
    const narration = `Previously on ${channel}. ${headline} ${bullets.map(bullet => bullet.text).join(' ')}`;
    try {
      const cached = await readFile(path);
      return { audioUrl: `/audio/${cardId}`, durationMs: wavDuration(cached) };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const pcm = await synthesize({ apiKey, WebSocketImpl, timeoutMs, setTimer, clearTimer, narration });
    const wav = pcmToWav(pcm);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, wav, { mode: 0o600 });
    return { audioUrl: `/audio/${cardId}`, durationMs: Math.ceil(pcm.length / 2 / SAMPLE_RATE * 1000) };
  }

  return { generate, audioPathFor };
}

function synthesize({ apiKey, WebSocketImpl, timeoutMs, setTimer, clearTimer, narration }) {
  return new Promise((resolvePromise, reject) => {
    const socket = new WebSocketImpl(`wss://api.openai.com/v1/realtime?model=${MODEL}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const chunks = [];
    let settled = false;
    const timer = setTimer(() => finish(new Error('Narrator voice timed out.')), timeoutMs);
    function finish(error, pcm) {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try { socket.close(); } catch {}
      if (error) reject(error); else resolvePromise(pcm);
    }
    socket.on('error', () => finish(new Error('Narrator voice request failed.')));
    socket.on('message', raw => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return finish(new Error('Narrator voice returned invalid data.')); }
      if (event.type === 'error') return finish(new Error('Narrator voice request failed.'));
      if (event.type === 'session.created' || event.type === 'session.updated') {
        if (event.type === 'session.updated') {
          socket.send(JSON.stringify({ type: 'response.create', response: {
            conversation: 'none', output_modalities: ['audio'],
            input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: narration }] }]
          } }));
        } else {
          socket.send(JSON.stringify({ type: 'session.update', session: {
            type: 'realtime', model: MODEL, output_modalities: ['audio'],
            instructions: 'Read the supplied recap exactly, without adding words. Use a warm, slightly dramatic television recap narrator delivery.',
            audio: { output: { format: { type: 'audio/pcm', rate: SAMPLE_RATE }, voice: 'marin' } }
          } }));
        }
      } else if (event.type === 'response.output_audio.delta' && event.delta) {
        chunks.push(Buffer.from(event.delta, 'base64'));
      } else if (event.type === 'response.done') {
        if (event.response?.status !== 'completed' || !chunks.length) return finish(new Error('Narrator voice response was incomplete.'));
        finish(null, Buffer.concat(chunks));
      }
    });
  });
}

function pcmToWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function wavDuration(wav) {
  return wav.length >= 44 ? Math.ceil(wav.readUInt32LE(40) / 2 / SAMPLE_RATE * 1000) : 0;
}
