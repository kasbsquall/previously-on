import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULTS = Object.freeze({ narratorVoice: true, soundEffects: true });

export function createFeatureSettings({ filePath = '.data/feature-settings.json' } = {}) {
  let value = { ...DEFAULTS };
  const ready = (async () => {
    try { value = { ...DEFAULTS, ...JSON.parse(await readFile(filePath, 'utf8')) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  return {
    ready,
    get: () => ({ ...value }),
    async set(next) {
      await ready;
      if (typeof next?.narratorVoice !== 'boolean' || typeof next?.soundEffects !== 'boolean') {
        const error = new Error('Narrator voice and sound effects must be on or off.');
        error.statusCode = 400;
        throw error;
      }
      value = { narratorVoice: next.narratorVoice, soundEffects: next.soundEffects };
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      return { ...value };
    }
  };
}
