export const RECORDING_TRIGGERS = Object.freeze(['ad-break', 'brb', 'raid', 'catchup']);

export function validateRecording(recording) {
  if (recording?.version !== 1 || !Array.isArray(recording.cards)) throw new Error('Recording must use version 1 and include cards.');
  if (recording.cards.length !== RECORDING_TRIGGERS.length) throw new Error('Recording must contain exactly four cards.');
  for (const [index, card] of recording.cards.entries()) {
    if (card.trigger !== RECORDING_TRIGGERS[index]) throw new Error(`Recording card ${index + 1} has an unexpected trigger.`);
    if (!card.id || !card.channel || !card.triggerInfo || !card.provenance || card.engine !== 'model') throw new Error(`Recording card ${index + 1} is missing model card fields.`);
    if (!Array.isArray(card.bullets) || !card.bullets.length || !Array.isArray(card.sourceItems) || !Array.isArray(card.sourceDetails)) {
      throw new Error(`Recording card ${index + 1} is missing bullets or source items.`);
    }
    const sourceIds = new Set(card.sourceItems.map(source => source.id));
    for (const bullet of card.bullets) {
      if (!bullet.text || !Array.isArray(bullet.sources) || !bullet.sources.length || bullet.sources.some(id => !sourceIds.has(id))) {
        throw new Error(`Recording card ${index + 1} has a bullet with a missing cited source.`);
      }
    }
    if (!card.narrator?.file || card.narrator.file.startsWith('/') || card.narrator.file.split(/[\\/]/).includes('..')) {
      throw new Error(`Recording card ${index + 1} is missing a safe narrator audio path.`);
    }
  }
  if (recording.cards[2].bullets.length < 2 || recording.cards[2].bullets.length > 3) {
    throw new Error('The recorded raid must have two or three bullets.');
  }
  return recording;
}
