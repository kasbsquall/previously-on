const ticket = document.querySelector('#ticket');
const $ = selector => document.querySelector(selector);
const replayMode = new URLSearchParams(location.search).get('replay') === '1';
const eventSource = replayMode ? null : new EventSource('events');
let hideTimer;
let coldTimer;
let currentCard = null;
let soundEffectsEnabled = true;
const failedPlayback = new Set();

$('#demo-tag').hidden = true;

eventSource?.addEventListener('state', event => {
  const state = JSON.parse(event.data);
  $('#demo-tag').hidden = !state.demo;
  soundEffectsEnabled = state.soundEffectsEnabled !== false;
  if (state.onAir && state.onAir.until > Date.now()) {
    if (currentCard?.id === state.onAir.id) return;
    if (ticket.hidden || ticket.dataset.cardId !== state.onAir.id) showCard(state.onAir, false);
  }
});
eventSource?.addEventListener('card:show', event => showCard(JSON.parse(event.data), true));
eventSource?.addEventListener('card:hide', event => {
  const data = JSON.parse(event.data);
  if (ticket.dataset.cardId === data.id) hideCard();
});

if (replayMode) {
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== location.origin || !event.data) return;
    if (event.data.type === 'previously-on:settings') {
      soundEffectsEnabled = Boolean(event.data.soundEffectsEnabled);
    } else if (event.data.type === 'previously-on:show' && event.data.card) {
      showCard(event.data.card, event.data.animate !== false, Boolean(event.data.muteAudio));
    } else if (event.data.type === 'previously-on:hide') {
      hideCard();
    }
  });
  window.parent.postMessage({ type: 'previously-on:ready' }, location.origin);
}

function showCard(card, animate, muteAudio = false) {
  currentCard = card;
  window.clearTimeout(hideTimer);
  window.clearTimeout(coldTimer);
  if (!ticket.hidden && ticket.dataset.cardId !== card.id && animate) {
    ticket.classList.remove('play');
    ticket.classList.add('exit');
    window.setTimeout(() => {
      ticket.hidden = true;
      ticket.classList.remove('exit');
      showCard(card, true, muteAudio);
    }, 200);
    return;
  }
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const coldOpen = $('#cold-open');
    $('#cold-channel').textContent = card.channel ?? '';
    coldOpen.hidden = false;
    coldOpen.classList.remove('play');
    coldOpen.classList.remove('leave');
    void coldOpen.offsetWidth;
    coldOpen.classList.add('play');
    if (soundEffectsEnabled && !muteAudio) playSound($('#sting-sound'), card.id);
    coldTimer = window.setTimeout(() => {
      coldOpen.classList.remove('play');
      coldOpen.classList.add('leave');
      enterTicket(card, true, muteAudio);
      window.setTimeout(() => {
        coldOpen.hidden = true;
        coldOpen.classList.remove('leave');
      }, 200);
    }, 1200);
    return;
  }
  enterTicket(card, animate, muteAudio);
}

function enterTicket(card, animate, muteAudio = false) {
  renderCard(card, animate);
  if (soundEffectsEnabled && !muteAudio) window.setTimeout(() => playSound($('#stamp-sound'), card.id), animate ? 700 : 0);
  if (card.audioUrl && !muteAudio) {
    const audio = $('#narrator-audio');
    audio.src = card.audioUrl;
    audio.volume = 0.55;
    const play = () => {
      try { Promise.resolve(audio.play()).catch(() => reportPlaybackFailure(card.id)); }
      catch { reportPlaybackFailure(card.id); }
    };
    window.setTimeout(play, animate ? 760 : 0);
  }
}

function playSound(audio, cardId) {
  audio.currentTime = 0;
  audio.volume = 0.22;
  try { Promise.resolve(audio.play()).catch(() => reportPlaybackFailure(cardId)); }
  catch { reportPlaybackFailure(cardId); }
}

function reportPlaybackFailure(cardId) {
  if (failedPlayback.has(cardId)) return;
  failedPlayback.add(cardId);
  void fetch('/api/audio-failure', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cardId })
  }).catch(() => {});
}

function renderCard(card, animate = true) {
  ticket.hidden = false;
  ticket.dataset.cardId = card.id;
  ticket.classList.remove('exit', 'tear', 'play');
  $('#channel-name').textContent = card.channel ?? '';
  $('#headline').textContent = card.headline;
  $('#bullets').replaceChildren();
  for (const [index, bullet] of card.bullets.entries()) {
    const row = document.createElement('li');
    row.className = 'bullet';
    row.style.setProperty('--index', index);
    const source = card.sourceDetails.find(item => item.id === bullet.sources[0]);
    const icon = document.createElement('i');
    icon.className = `ph-light ${iconFor(source?.kind)}`;
    icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.textContent = bullet.text;
    row.append(icon, text);
    $('#bullets').append(row);
  }
  renderTrigger(card);
  $('#simulated-tag').hidden = !card.simulated;
  $('#stamp small').textContent = 'CATCH UP';
  $('#stamp b').textContent = 'RECAP';
  $('#engine-tag').replaceChildren();
  $('#engine-tag').hidden = Boolean(card.welcomeOnly);
  const engineIcon = document.createElement('i');
  engineIcon.className = `ph-light ${card.engine === 'model' ? 'ph-cpu' : 'ph-hourglass-medium'}`;
  engineIcon.setAttribute('aria-hidden', 'true');
  $('#engine-tag').append(engineIcon, document.createTextNode(card.engine === 'model' ? 'AI recap' : 'Quick recap, no AI'));
  $('#provenance').textContent = formatProvenance(card.provenance, card.trigger);
  if (animate) {
    void ticket.offsetWidth;
    ticket.classList.add('play');
  }
}

function renderTrigger(card) {
  const small = $('#trigger-small');
  const name = $('#trigger-name');
  const count = $('#trigger-count');
  const number = count.querySelector('b');
  const unit = count.querySelector('span');
  count.hidden = true;
  if (card.trigger === 'raid') {
    small.textContent = 'Raid from';
    name.textContent = card.triggerInfo.name;
    count.hidden = false;
    number.textContent = String(card.triggerInfo.viewerCount);
    unit.textContent = 'viewers';
  } else if (card.trigger === 'catchup') {
    small.textContent = 'Asked by';
    name.textContent = card.triggerInfo.name;
  } else if (card.trigger === 'break') {
    small.textContent = 'Back from';
    name.textContent = 'Break';
    count.hidden = false;
    number.textContent = String(card.triggerInfo.minutesAway);
    unit.textContent = 'min';
  } else {
    small.textContent = 'Back from';
    name.textContent = 'Ad break';
    count.hidden = false;
    number.textContent = String(card.triggerInfo.seconds ?? 60);
    unit.textContent = 's';
  }
}

function formatProvenance(provenance, trigger) {
  const parts = [];
  if (provenance.voiceSeconds > 0) parts.push(`from ${Math.max(1, Math.ceil(provenance.voiceSeconds / 60))} min of voice`);
  if (provenance.chatCount > 0) parts.push(`${provenance.chatCount} chat ${provenance.chatCount === 1 ? 'message' : 'messages'}`);
  if (provenance.eventCount > 0) {
    const label = trigger === 'raid' && provenance.eventCount === 1 ? 'raid' : 'event';
    parts.push(`${provenance.eventCount} ${label}${provenance.eventCount === 1 ? '' : 's'}`);
  }
  if (provenance.noteCount > 0) parts.push(`${provenance.noteCount} ${provenance.noteCount === 1 ? 'note' : 'notes'}`);
  return parts.join(', ');
}

function iconFor(kind) {
  if (kind === 'voice') return 'ph-microphone';
  if (kind === 'event') return 'ph-lightning';
  if (kind === 'note') return 'ph-note-pencil';
  return 'ph-chat-circle-text';
}

function hideCard() {
  window.clearTimeout(hideTimer);
  window.clearTimeout(coldTimer);
  $('#cold-open').hidden = true;
  $('#cold-open').classList.remove('play');
  $('#narrator-audio').pause();
  ticket.classList.remove('play');
  ticket.classList.add('exit');
  hideTimer = window.setTimeout(() => { ticket.hidden = true; ticket.classList.remove('exit'); currentCard = null; }, 200);
}
