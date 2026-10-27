import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_SETTINGS = Object.freeze({ mode: 'timed', seconds: 5 });

export function normalizeApprovalSettings(value = {}) {
  if (value.mode === 'hold') return { mode: 'hold', seconds: null };
  const seconds = Number(value.seconds);
  if (value.mode !== 'timed' || ![5, 10, 20].includes(seconds)) {
    throw new TypeError('Choose an auto-approve delay of 5, 10, or 20 seconds, or hold for approval.');
  }
  return { mode: 'timed', seconds };
}

export function createApprovalSettings({ filePath } = {}) {
  let current = { ...DEFAULT_SETTINGS };
  const ready = filePath
    ? readFile(filePath, 'utf8').then(text => {
      try { current = normalizeApprovalSettings(JSON.parse(text)); }
      catch { current = { ...DEFAULT_SETTINGS }; }
    }).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    })
    : Promise.resolve();

  async function set(value) {
    await ready;
    const next = normalizeApprovalSettings(value);
    if (filePath) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(next)}\n`, 'utf8');
    }
    current = next;
    return get();
  }

  function get() {
    return { ...current };
  }

  return { ready, get, set };
}
