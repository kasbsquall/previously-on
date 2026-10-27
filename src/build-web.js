import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecording } from '../web-demo/recording-schema.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(root, 'dist-web');
const recordingRoot = join(root, 'web-demo', 'recording');
const recordingPath = join(recordingRoot, 'cards.json');

let recording;
try { recording = validateRecording(JSON.parse(await readFile(recordingPath, 'utf8'))); }
catch (error) {
  throw new Error(`Cannot build the browser demo: ${error.message}. Run npm run record-demo first.`, { cause: error });
}
for (const card of recording.cards) {
  const file = resolve(recordingRoot, card.narrator.file);
  if (!file.startsWith(`${recordingRoot}${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('Recording audio path escapes web-demo/recording.');
  await stat(file);
}

// Keep the output directory stable while a local browser review has files open.
// The fixed build manifest below overwrites every published asset in place.
await mkdir(output, { recursive: true });
await mkdir(join(output, 'assets'), { recursive: true });
await mkdir(join(output, 'sfx'), { recursive: true });
await mkdir(join(output, 'design'), { recursive: true });
await mkdir(dirname(join(output, 'recording', 'cards.json')), { recursive: true });

for (const name of ['index.html', 'demo.css', 'replay-adapter.js', 'recording-schema.js']) {
  await cp(join(root, 'web-demo', name), join(output, name));
}
for (const name of ['overlay.html', 'overlay.css', 'overlay.js', 'fonts.css', 'favicon.svg']) {
  await cp(join(root, 'public', name), join(output, name));
}
await cp(join(root, 'node_modules', '@phosphor-icons', 'web', 'src', 'light', 'style.css'), join(output, 'assets', 'phosphor-light.css'));
await cp(join(root, 'node_modules', '@phosphor-icons', 'web', 'src', 'light', 'Phosphor-Light.woff2'), join(output, 'assets', 'Phosphor-Light.woff2'));
await cp(join(root, 'node_modules', '@fontsource-variable', 'hanken-grotesk', 'files', 'hanken-grotesk-latin-wght-normal.woff2'), join(output, 'assets', 'hanken-latin.woff2'));
await cp(join(root, 'public', 'sfx', 'sting.ogg'), join(output, 'sfx', 'sting.ogg'));
await cp(join(root, 'public', 'sfx', 'stamp.ogg'), join(output, 'sfx', 'stamp.ogg'));
await cp(join(root, 'design', 'reference-bg.png'), join(output, 'design', 'reference-bg.png'));
await cp(recordingRoot, join(output, 'recording'), { recursive: true });
console.log(`Built the static demo in ${output}.`);
