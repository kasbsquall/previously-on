import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createBreakSceneSettings({ filePath, defaultScene = '' } = {}) {
  let scene = String(defaultScene ?? '').trim();
  const ready = filePath ? readFile(filePath, 'utf8').then(value => {
    const stored = JSON.parse(value);
    if (typeof stored.scene === 'string') scene = stored.scene;
  }).catch(error => { if (error.code !== 'ENOENT') throw error; }) : Promise.resolve();
  return {
    ready,
    get: () => scene,
    async set(value) {
      await ready;
      if (typeof value !== 'string' || value.length > 120 || /[\r\n]/u.test(value)) {
        const error = new TypeError('Choose a valid OBS scene name.'); error.statusCode = 400; throw error;
      }
      scene = value.trim();
      if (filePath) { await mkdir(dirname(filePath), { recursive: true }); await writeFile(filePath, `${JSON.stringify({ scene })}\n`, 'utf8'); }
      return scene;
    }
  };
}
