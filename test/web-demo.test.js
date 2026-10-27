import test from 'node:test';
import assert from 'node:assert/strict';
import { citedSourcesForCard, initialCardPlayback, overlayCardForReplay } from '../web-demo/replay-adapter.js';
import { validateRecording } from '../web-demo/recording-schema.js';

function sampleRecording() {
  const makeCard = (trigger, bullets = 1) => {
    const sourceItems = Array.from({ length: bullets }, (_, index) => ({
      id: `S${index + 1}`, t: '2026-10-27T18:00:00.000Z', kind: 'voice', text: `Source line ${index + 1}.`, user: 'MeadowMoth'
    }));
    return {
      id: `card-${trigger}`, trigger, channel: 'MeadowMoth', triggerInfo: { name: trigger }, simulated: true,
      headline: 'The garden is growing.',
      bullets: sourceItems.map((source, index) => ({ text: `Bullet ${index + 1}.`, sources: [source.id] })),
      sourceItems, sourceDetails: sourceItems.map(source => ({ id: source.id, kind: source.kind, text: source.text, user: source.user })),
      provenance: { voiceSeconds: 60, chatCount: 0, eventCount: 0, noteCount: 0 },
      engine: 'model', latencyMs: 10, narrator: { file: `audio/${trigger}.wav`, durationMs: 3000 }
    };
  };
  return {
    version: 1,
    recordedAt: '2026-10-27T18:00:00.000Z',
    model: 'gpt-5.4-mini',
    source: 'Recorded demo pipeline.',
    cards: [makeCard('ad-break'), makeCard('raid', 2), makeCard('catchup')]
  };
}

test('recording format validates three grounded cards and rejects unsafe audio paths', () => {
  const recording = sampleRecording();
  assert.equal(validateRecording(recording), recording);
  recording.cards[0].narrator.file = 'audio/../../secret.wav';
  assert.throws(() => validateRecording(recording), /safe narrator audio path/);
});

test('replay adapter feeds the shared overlay with cached audio and exposes cited source lines', () => {
  const card = sampleRecording().cards[1];
  const overlayCard = overlayCardForReplay(card);
  assert.equal(overlayCard.audioUrl, 'recording/audio/raid.wav');
  assert.equal(overlayCard.bullets, card.bullets);
  const sources = citedSourcesForCard(card);
  assert.equal(sources.length, 2);
  assert.deepEqual(sources[0].sources[0], { id: 'S1', source: card.sourceItems[0] });
});

test('initial ad-break replay is silent and reduced-motion mode skips entry animation', () => {
  assert.deepEqual(initialCardPlayback(false), { animate: true, muteAudio: true });
  assert.deepEqual(initialCardPlayback(true), { animate: false, muteAudio: true });
});
