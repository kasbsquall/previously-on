import { createObsClient } from './obs/client.js';

const client = createObsClient();
if (!process.env.OBS_WEBSOCKET_PASSWORD) throw new Error('Set OBS_WEBSOCKET_PASSWORD in .env.');

try {
  const info = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Could not connect to OBS within 10 seconds.')), 10_000);
    client.on('scenes', () => {
        clearTimeout(timeout);
        void client.getSceneList().then(resolve, reject);
    });
    client.start();
  });
  console.log(`OBS version: ${info.obsStudioVersion ?? 'unknown'}`);
  console.log(`Current program scene: ${info.currentProgramSceneName ?? '(none)'}`);
  console.log('Scenes:');
  for (const scene of info.scenes) console.log(`- ${scene}`);
} finally {
  client.close();
}
