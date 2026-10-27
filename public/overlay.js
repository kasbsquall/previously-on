const ticket = document.querySelector('#ticket');
const eventSource = new EventSource('/events');
const $ = selector => document.querySelector(selector);
let hideTimer;

$('#demo-tag').hidden = true;

eventSource.addEventListener('state', event => {
  const state = JSON.parse(event.data);
  $('#demo-tag').hidden = !state.demo;
  if (state.onAir && state.onAir.until > Date.now()) {
    if (ticket.hidden || ticket.dataset.cardId !== state.onAir.id) showCard(state.onAir, false);
  }
});
eventSource.addEventListener('card:show', event => showCard(JSON.parse(event.data), true));
eventSource.addEventListener('card:hide', event => {
  const data = JSON.parse(event.data);
  if (ticket.dataset.cardId === data.id) hideCard();
});

function showCard(card, animate) {
  window.clearTimeout(hideTimer);
  if (!ticket.hidden && ticket.dataset.cardId !== card.id && animate) {
    ticket.classList.remove('play');
    ticket.classList.add('exit');
    window.setTimeout(() => renderCard(card), 200);
    return;
  }
  renderCard(card, animate);
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
  ticket.classList.remove('play');
  ticket.classList.add('exit');
  hideTimer = window.setTimeout(() => { ticket.hidden = true; ticket.classList.remove('exit'); }, 200);
}
