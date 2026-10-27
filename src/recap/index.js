import { performance } from 'node:perf_hooks';
import { buildFallback } from './fallback.js';
import { groundBullets } from './grounding.js';
import { generateRecap } from './model.js';

export async function buildRecap({ trigger, items, channel, windowMinutes, model = generateRecap, modelOptions = {}, blockedTerms = process.env.BLOCKED_TERMS ?? '' }) {
  items = items.slice(-120).map((item, index) => ({
    ...item,
    id: `S${index + 1}`,
    ...(item.kind === 'chat' ? { text: item.text.slice(0, 200) } : {})
  }));
  const contentItems = items.filter(item => ['voice', 'note', 'chat'].includes(item.kind));
  const started = performance.now();
  let candidate;
  let engine = 'model';
  const droppedBullets = [];
  if (contentItems.length && (process.env.OPENAI_API_KEY || model !== generateRecap || modelOptions.client)) {
    try {
      candidate = await model({ ...modelOptions, items: contentItems, channel, trigger });
    } catch {
      candidate = undefined;
    }
  }

  let checked = { bullets: [], dropped: [] };
  if (candidate) {
    checked = groundBullets(candidate.bullets, contentItems, blockedTerms);
    droppedBullets.push(...checked.dropped);
  }
  if (!candidate || checked.bullets.length === 0) {
    engine = 'fallback';
    candidate = buildFallback({ items: contentItems, channel, windowMinutes: windowMinutes ?? ({ raid: 10, catchup: 5, break: 10, 'ad-break': 4 }[trigger] ?? 10) });
    checked = groundBullets(candidate.bullets, contentItems, blockedTerms);
    droppedBullets.push(...checked.dropped);
  }

  const voiceTimes = items.filter(item => item.kind === 'voice').map(item => timeOf(item.t)).filter(Number.isFinite);
  const voiceSeconds = voiceTimes.length > 1 ? Math.max(0, Math.round((Math.max(...voiceTimes) - Math.min(...voiceTimes)) / 1000)) : 0;
  return {
    headline: cleanHeadline(candidate.headline),
    bullets: checked.bullets,
    provenance: {
      voiceSeconds,
      chatCount: items.filter(item => item.kind === 'chat').length,
      eventCount: items.filter(item => item.kind === 'event').length,
      noteCount: items.filter(item => item.kind === 'note').length
    },
    engine,
    latencyMs: Math.round(performance.now() - started),
    droppedBullets
  };
}

function cleanHeadline(headline) {
  return String(headline ?? '').replace(/^\s*previously(?:\s+on)?\s*:\s*/i, '').trim().replace(/\.$/u, '');
}

function timeOf(value) {
  return typeof value === 'number' ? value : Date.parse(value);
}
