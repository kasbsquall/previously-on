import { validateRecording } from './recording-schema.js';

export function overlayCardForReplay(card) {
  return { ...card, audioUrl: `recording/${card.narrator.file}` };
}

export function citedSourcesForCard(card) {
  const sourceById = new Map(card.sourceItems.map(source => [source.id, source]));
  return card.bullets.map(bullet => ({
    text: bullet.text,
    sources: bullet.sources.map(id => ({ id, source: sourceById.get(id) }))
  }));
}

export function initialCardPlayback(prefersReducedMotion) {
  return { animate: !prefersReducedMotion, muteAudio: true };
}

export const AD_BREAK_PREVIEW_MS = 1500;

if (typeof document !== 'undefined') void startBrowserReplay();

async function startBrowserReplay() {
  const status = document.querySelector('#recording-status');
  const sourcePanel = document.querySelector('#source-lines');
  const buttons = [...document.querySelectorAll('[data-trigger]')];
  const frame = document.querySelector('#overlay-frame');
  const stage = document.querySelector('#stage');
  const soundToggle = document.querySelector('#sound-toggle');
  const soundLabel = soundToggle.parentElement;
  const adBreakPreview = document.querySelector('#ad-break-preview');
  let recording;
  let activeCard = null;
  let overlayReady = false;
  let adBreakPreviewTimer;

  function send(type, data = {}) {
    frame.contentWindow?.postMessage({ type, ...data }, location.origin);
  }

  function playInitialCard() {
    if (!recording || !overlayReady || activeCard) return;
    activeCard = recording.cards.find(card => card.trigger === 'ad-break');
    if (!activeCard) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    send('previously-on:show', { card: overlayCardForReplay(activeCard), ...initialCardPlayback(reducedMotion) });
    renderSources(activeCard, sourcePanel);
  }

  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
    if (event.data?.type === 'previously-on:ready') {
      overlayReady = true;
      playInitialCard();
    }
  });
  frame.addEventListener('load', () => {
    overlayReady = true;
    send('previously-on:settings', { soundEffectsEnabled: soundToggle.checked });
    playInitialCard();
  });
  try {
    if (frame.contentDocument?.readyState === 'complete') {
      overlayReady = true;
      playInitialCard();
    }
  } catch {}

  try {
    const response = await fetch('recording/cards.json');
    if (!response.ok) throw new Error('Recorded cards are not published yet.');
    recording = validateRecording(await response.json());
    status.textContent = 'Three recorded cards are ready.';
    for (const button of buttons) button.disabled = false;
    playInitialCard();
  } catch (error) {
    status.textContent = error.message;
  }

  const resizeStage = () => { frame.style.transform = `scale(${stage.clientWidth / 1920})`; };
  new ResizeObserver(resizeStage).observe(stage);
  resizeStage();
  soundToggle.addEventListener('change', () => {
    soundLabel.lastChild.textContent = soundToggle.checked ? ' Sound effects on' : ' Sound effects off';
    send('previously-on:settings', { soundEffectsEnabled: soundToggle.checked });
  });
  for (const button of buttons) button.addEventListener('click', () => {
    if (!recording) return;
    window.clearTimeout(adBreakPreviewTimer);
    adBreakPreview.hidden = true;
    activeCard = recording.cards.find(card => card.trigger === button.dataset.trigger);
    if (!activeCard) return;
    renderSources(activeCard, sourcePanel);
    const replayCard = () => {
      adBreakPreview.hidden = true;
      send('previously-on:settings', { soundEffectsEnabled: soundToggle.checked });
      send('previously-on:show', { card: overlayCardForReplay(activeCard) });
    };
    if (activeCard.trigger === 'ad-break') {
      adBreakPreview.hidden = false;
      adBreakPreviewTimer = window.setTimeout(replayCard, AD_BREAK_PREVIEW_MS);
    } else {
      replayCard();
    }
  });
  document.querySelector('#sources-toggle').addEventListener('change', event => {
    sourcePanel.hidden = !event.target.checked || !activeCard;
  });
}

function renderSources(card, panel) {
  const fragments = [];
  for (const bullet of citedSourcesForCard(card)) {
    const block = document.createElement('section');
    block.className = 'source-bullet';
    const text = document.createElement('p');
    text.textContent = bullet.text;
    block.append(text);
    for (const { id, source } of bullet.sources) {
      if (!source) continue;
      const line = document.createElement('p');
      line.className = 'source-line';
      line.textContent = `${id} · ${source.kind}${source.user ? ` · ${source.user}` : ''}: ${source.text}`;
      block.append(line);
    }
    fragments.push(block);
  }
  panel.replaceChildren(...fragments);
  panel.hidden = !document.querySelector('#sources-toggle').checked;
}
