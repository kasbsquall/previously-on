import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createLiveCardLogger(filePath = 'results/live-cards.jsonl') {
  let writeQueue = Promise.resolve();
  return (card, mode = 'real') => {
    const record = {
      at: new Date(card.updatedAt ?? card.createdAt ?? Date.now()).toISOString(),
      mode,
      trigger: card.trigger,
      simulated: Boolean(card.simulated),
      engine: card.engine,
      latencyMs: card.latencyMs,
      bullets: (card.bullets ?? []).map(bullet => ({ sources: [...(bullet.sources ?? [])] })),
      droppedBullets: (card.droppedBullets ?? []).map(bullet => ({ reason: bullet.reason })),
      status: card.status
    };
    writeQueue = writeQueue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
    });
    return writeQueue;
  };
}
