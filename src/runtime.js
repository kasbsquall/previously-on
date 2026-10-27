import { createSourceBuffer } from './sources/buffer.js';
import { createCardPipeline } from './cards/pipeline.js';
import { createApprovalSettings } from './cards/approval-settings.js';
import { createFeatureSettings } from './cards/feature-settings.js';
import { createServer } from './server.js';
import { createNarrator } from './audio/narrator.js';
import { createBreakSceneSettings } from './obs/break-scene-settings.js';

export async function startRuntime({ mode = 'real', channel, broadcasterId, sendChat, recap, getConnection, getObsState = () => ({ status: 'not configured', scenes: [] }), setObsBreakScene = async () => '', getObsBreakScene = () => '', adBreakTimeScale = 1, sessionPath = '.data/session.jsonl', port = Number(process.env.PORT) || 4777, logChat, onDecided, clipReceipts, narrator = createNarrator() } = {}) {
  if (!channel) throw new Error('TWITCH_CHANNEL is required.');
  const sourceBuffer = createSourceBuffer({ filePath: sessionPath });
  await sourceBuffer.ready;
  const approvalSettings = createApprovalSettings({ filePath: '.data/approval-settings.json' });
  await approvalSettings.ready;
  const featureSettings = createFeatureSettings({ filePath: '.data/feature-settings.json' });
  await featureSettings.ready;
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
    approvalSettings,
    featureSettings,
    narrator,
    clipReceipts
  });
  const server = createServer({ pipeline, getConnection, getObsState, setObsBreakScene, getObsBreakScene, port, mode, narrator });
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
