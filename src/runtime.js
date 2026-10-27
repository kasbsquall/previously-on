import { createSourceBuffer } from './sources/buffer.js';
import { createCardPipeline } from './cards/pipeline.js';
import { createApprovalSettings } from './cards/approval-settings.js';
import { createServer } from './server.js';

export async function startRuntime({ mode = 'real', channel, broadcasterId, sendChat, recap, getConnection, adBreakTimeScale = 1, sessionPath = '.data/session.jsonl', port = Number(process.env.PORT) || 4777, logChat, onDecided } = {}) {
  if (!channel) throw new Error('TWITCH_CHANNEL is required.');
  const sourceBuffer = createSourceBuffer({ filePath: sessionPath });
  await sourceBuffer.ready;
  const approvalSettings = createApprovalSettings({ filePath: '.data/approval-settings.json' });
  await approvalSettings.ready;
  const pipeline = createCardPipeline({
    sourceBuffer,
    channel,
    broadcasterId,
    sendChat,
    recap,
    mode,
    adBreakTimeScale,
    logChat,
    onDecided,
    approvalSettings
  });
  const server = createServer({ pipeline, getConnection, port, mode });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  console.log(`Previously On server listening at ${origin}.`);
  console.log(`Overlay: ${origin}/overlay`);
  console.log(`Control panel: ${origin}/control`);
  return { server, pipeline, sourceBuffer, origin };
}
