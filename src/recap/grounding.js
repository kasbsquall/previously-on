export function groundBullets(bullets, items, blockedTerms = process.env.BLOCKED_TERMS ?? '') {
  const validIds = new Set(items.map(item => item.id));
  const terms = (Array.isArray(blockedTerms) ? blockedTerms : blockedTerms.split(','))
    .map(term => term.trim().toLocaleLowerCase()).filter(Boolean);
  const kept = [];
  const dropped = [];
  for (const bullet of bullets ?? []) {
    const invalidSource = !Array.isArray(bullet.sources) || bullet.sources.length === 0 || bullet.sources.some(id => !validIds.has(id));
    if (invalidSource) {
      dropped.push({ bullet, reason: 'unknown_source' });
      continue;
    }
    const combined = String(bullet.text ?? '').toLocaleLowerCase();
    if (terms.some(term => combined.includes(term))) {
      dropped.push({ bullet, reason: 'blocked_term' });
      continue;
    }
    kept.push({ text: String(bullet.text ?? '').slice(0, 90), sources: [...bullet.sources] });
  }
  return { bullets: kept, dropped };
}
