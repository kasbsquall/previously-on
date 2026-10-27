export async function captureRecordedCard(pipeline, { trigger, action, audioTimeoutMs = 20_500 }) {
  let listener;
  const pendingEvent = new Promise(resolve => {
    listener = pending => {
      if (pending.trigger !== trigger) return;
      pipeline.off('pending', listener);
      resolve(pending);
    };
    pipeline.on('pending', listener);
  });

  let pending;
  try {
    await action();
    pending = await pendingEvent;
  } catch (error) {
    pipeline.off('pending', listener);
    throw error;
  }
  if (pending.trigger !== trigger) throw new Error(`Expected ${trigger}, received ${pending.trigger}.`);
  const audio = await pipeline.waitForAudio(pending.id, audioTimeoutMs);
  if (!audio) throw new Error(`Narrator audio was not ready for ${trigger}.`);
  await pipeline.approve(pending.id);
  const card = pipeline.getState().cards.find(item => item.id === pending.id);
  if (card?.engine !== 'model') throw new Error(`${trigger} recap did not use the OpenAI model.`);
  if (!card.audioUrl) throw new Error(`Narrator audio was not attached to ${trigger}.`);
  if (trigger === 'raid' && (card.bullets.length < 2 || card.bullets.length > 3)) {
    throw new Error('The raid recap must have two or three model bullets.');
  }
  return {
    id: card.id,
    trigger: card.trigger,
    channel: card.channel,
    simulated: card.simulated,
    triggerInfo: card.triggerInfo,
    headline: card.headline,
    bullets: card.bullets,
    sourceItems: card.sourceItems,
    sourceDetails: card.sourceDetails,
    provenance: card.provenance,
    engine: card.engine,
    latencyMs: card.latencyMs,
    narrator: { file: `audio/${card.id}.wav`, durationMs: card.voiceDurationMs }
  };
}
