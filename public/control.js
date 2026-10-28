const $ = selector => document.querySelector(selector);
let currentState = null;
let recognition = null;
let vetoAnimating = false;
let eventSource = null;
let reconnectTimer = null;
let reconnectDelay = 500;

const sourceEvents = ['state', 'pending', 'approved', 'vetoed', 'log', 'break', 'voice:segment', 'voice:enabled', 'note', 'chat:error'];
function refreshPanelState(source) {
  void fetch('/api/state').then(response => {
    if (!response.ok) throw new Error('Could not load control panel state.');
    return response.json();
  }).then(state => {
    if (source === eventSource) handleServerEvent('state', state);
  }).catch(error => {
    if (source !== eventSource) return;
    $('#slips').setAttribute('aria-busy', 'false');
    $('#pending-skeleton').hidden = true;
    $('#log-skeleton').hidden = true;
    $('#panel-error').textContent = error.message;
    $('#panel-error').hidden = false;
    setConnection('offline');
  });
}

function connectPanelEvents() {
  const source = new EventSource('/events');
  eventSource = source;
  for (const name of sourceEvents) source.addEventListener(name, event => handleServerEvent(name, JSON.parse(event.data)));
  source.onopen = () => {
    if (source !== eventSource) return;
    $('#connection-error').hidden = true;
    reconnectDelay = 500;
    refreshPanelState(source);
  };
  source.onerror = () => {
    if (source !== eventSource) return;
    $('#connection-error').hidden = false;
    source.close();
    eventSource = null;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connectPanelEvents, reconnectDelay);
    reconnectDelay = Math.min(5000, reconnectDelay * 2);
  };
}
connectPanelEvents();

$('#break-button').addEventListener('click', () => post('/api/break'));
$('#back-button').addEventListener('click', () => post('/api/back'));
$('#obs-break-scene').addEventListener('change', async event => {
  try {
    currentState.obs.breakScene = await post('/api/obs-break-scene', { scene: event.target.value });
  } catch (error) { showError(error.message); renderConnection(); }
});
$('#approval-setting').addEventListener('change', async event => {
  const selected = event.target.value;
  const settings = selected === 'hold' ? { mode: 'hold' } : { mode: 'timed', seconds: Number(selected) };
  try {
    const saved = await post('/api/approval-settings', settings);
    currentState = { ...currentState, approvalMode: saved.mode, approvalSeconds: saved.seconds };
    renderConnection();
  } catch (error) {
    showError(error.message);
    renderConnection();
  }
});
for (const [selector, key] of [['#narrator-setting', 'narratorVoice'], ['#sound-setting', 'soundEffects']]) {
  $(selector).addEventListener('change', async event => {
    const previous = currentState?.[key === 'narratorVoice' ? 'narratorVoiceEnabled' : 'soundEffectsEnabled'];
    try {
      const saved = await post('/api/feature-settings', {
        narratorVoice: key === 'narratorVoice' ? event.target.checked : currentState.narratorVoiceEnabled,
        soundEffects: key === 'soundEffects' ? event.target.checked : currentState.soundEffectsEnabled
      });
      currentState.narratorVoiceEnabled = saved.narratorVoice;
      currentState.soundEffectsEnabled = saved.soundEffects;
    } catch (error) {
      event.target.checked = Boolean(previous);
      showError(error.message);
    }
  });
}
window.addEventListener('keydown', event => {
  const target = event.target;
  if (event.key.toLocaleLowerCase() !== 'b' || event.altKey || event.ctrlKey || event.metaKey || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  void post(currentState?.onBreak ? '/api/back' : '/api/break').catch(error => showError(error.message));
});
$('#voice-button').addEventListener('click', toggleVoice);
$('#note-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#note-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await post('/api/note', { text });
    input.value = '';
  } catch (error) { showError(error.message); }
});
for (const button of document.querySelectorAll('[data-simulate]')) {
  button.addEventListener('click', async () => {
    try { await post('/api/simulate', { type: button.dataset.simulate }); }
    catch (error) { showError(error.message); }
  });
}

const Recognition = window.webkitSpeechRecognition;
if (Recognition) {
  recognition = new Recognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = event => {
    const finalSegments = [];
    const interimSegments = [];
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const text = event.results[index][0].transcript.trim();
      if (!text) continue;
      if (event.results[index].isFinal) finalSegments.push(text);
      else interimSegments.push(text);
    }
    $('#interim').textContent = interimSegments.join(' ');
    $('#interim').hidden = interimSegments.length === 0;
    for (const text of finalSegments) void post('/api/voice-segment', { text }).catch(error => showError(error.message));
  };
  recognition.onerror = event => {
    $('#voice-warning').textContent = event.error === 'not-allowed'
      ? 'Microphone access was not granted. You can still add notes.'
      : 'Voice capture stopped. You can still add notes.';
    $('#voice-warning').hidden = false;
  };
  recognition.onend = () => {
    if (currentState?.voiceEnabled) {
      try { recognition.start(); } catch { /* The browser can still be stopping the prior session. */ }
    }
  };
} else {
  $('#voice-button').disabled = true;
  $('#voice-warning').hidden = false;
  $('#voice-help').textContent = 'Voice capture needs Chrome. You can still add notes.';
}

window.setInterval(updateCountdown, 100);

function handleServerEvent(name, data) {
  if (name === 'chat:error') {
    showError('The recap card was shown, but Twitch did not accept its chat line.');
    return;
  }
  if (!currentState) currentState = { mode: 'real', cards: [], voiceSegments: [], voiceEnabled: false, onBreak: false };
  if (name === 'state') {
    currentState = data;
    $('#slips').setAttribute('aria-busy', 'false');
    $('#pending-skeleton').hidden = true;
    $('#log-skeleton').hidden = true;
  }
  else if (name === 'pending') currentState.pending = data;
  else if (name === 'log') currentState.cards = data;
  else if (name === 'break') currentState.onBreak = data.onBreak;
  else if (name === 'voice:enabled') currentState.voiceEnabled = data;
  else if (name === 'voice:segment') currentState.voiceSegments = [...(currentState.voiceSegments ?? []), data].slice(-3);
  else if (name === 'vetoed') {
    vetoAnimating = true;
    $('#pending-card').classList.add('tear');
    window.setTimeout(() => { vetoAnimating = false; renderPending(); }, 230);
  } else if (name === 'approved' && currentState.pending?.id === data.id) currentState.pending = null;
  if ($('#slips').getAttribute('aria-busy') === 'false') renderAll();
}

function renderAll() {
  renderConnection();
  renderPending();
  renderTranscript();
  renderLog();
  $('#demo-badge').hidden = !currentState.demo;
}

function renderConnection() {
  const status = currentState.connection ?? 'offline';
  const labels = { connected: 'Connected', reconnecting: 'Reconnecting', offline: 'Offline', demo: 'Demo mode' };
  setConnection(status, labels[status] ?? 'Offline');
  $('#voice-state').textContent = currentState.voiceEnabled ? 'On' : 'Off';
  $('#voice-state').className = `state ${currentState.voiceEnabled ? 'connected' : ''}`;
  $('#model-state').textContent = currentState.modelEnabled ? 'AI recap on' : 'No API key, quick recaps only';
  $('#model-state').className = `state ${currentState.modelEnabled ? 'connected' : ''}`;
  const obsState = currentState.obs ?? { status: 'not configured', scenes: [] };
  $('#obs-state').textContent = obsState.status === 'connected' ? 'Connected' : obsState.status === 'reconnecting' ? 'Reconnecting' : 'Not configured';
  $('#obs-state').className = `state ${obsState.status === 'connected' ? 'connected' : ''}`;
  const scenePicker = $('#obs-break-scene');
  const selectedScene = obsState.breakScene ?? '';
  scenePicker.replaceChildren();
  const noScene = document.createElement('option'); noScene.value = ''; noScene.textContent = 'No break scene selected'; scenePicker.append(noScene);
  for (const scene of obsState.scenes ?? []) { const option = document.createElement('option'); option.value = scene; option.textContent = scene; scenePicker.append(option); }
  if (selectedScene && ![...scenePicker.options].some(option => option.value === selectedScene)) { const option = document.createElement('option'); option.value = selectedScene; option.textContent = `${selectedScene} (saved)`; scenePicker.append(option); }
  scenePicker.value = selectedScene;
  scenePicker.disabled = obsState.status !== 'connected';
  $('#approval-setting').value = currentState.approvalMode === 'hold' ? 'hold' : String(currentState.approvalSeconds ?? 5);
  $('#narrator-setting').checked = currentState.narratorVoiceEnabled !== false;
  $('#sound-setting').checked = currentState.soundEffectsEnabled !== false;
  $('#break-button').disabled = currentState.onBreak;
  $('#back-button').disabled = !currentState.onBreak;
  if (recognition) {
    $('#voice-button').disabled = false;
    $('#voice-button').lastChild.textContent = currentState.voiceEnabled ? ' Turn voice capture off' : ' Turn voice capture on';
  }
}

function setConnection(status, label) {
  const element = $('#connection-state');
  element.className = `state ${status === 'connected' || status === 'demo' ? status : status === 'offline' ? 'offline' : ''}`;
  element.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'dot';
  element.append(dot, document.createTextNode(label ?? (status === 'offline' ? 'Offline' : status)));
}

function renderPending() {
  if (!currentState) return;
  const card = currentState.pending;
  const box = $('#pending-card');
  $('#pending-skeleton').hidden = true;
  if (!card) {
    if (vetoAnimating) return;
    box.hidden = true;
    box.replaceChildren();
    $('#empty-pending').hidden = false;
    return;
  }
  $('#empty-pending').hidden = true;
  box.hidden = false;
  box.classList.remove('tear');
  box.replaceChildren();
  box.dataset.cardId = card.id;

  const top = document.createElement('div');
  top.className = 'pending-top';
  const isAdBreak = card.trigger === 'ad-break';
  const isSceneBreak = card.trigger === 'brb';
  const isBreakReview = isAdBreak || isSceneBreak;
  const trigger = document.createElement('span');
  trigger.textContent = triggerName(card.trigger);
  top.append(trigger);
  if (card.simulated) {
    const tag = document.createElement('b');
    tag.className = 'sim-tag';
    tag.textContent = 'SIMULATED';
    top.append(tag);
  }
  const status = document.createElement('span');
  status.textContent = card.vetoed ? 'VETOED' : card.approved ? (isBreakReview ? 'APPROVED FOR BREAK END' : 'APPROVED') : card.building ? 'BUILDING' : 'WAITING';
  top.append(status);

  const mini = document.createElement('div');
  mini.className = 'mini-ticket';
  const coupon = document.createElement('div');
  coupon.className = 'mini-coupon';
  const headline = document.createElement('h3');
  headline.textContent = card.headline || 'Preparing the recap.';
  const lineInfo = document.createElement('p');
  lineInfo.textContent = card.building
    ? card.adBreakPhase === 'finishing' ? 'The break ended; waiting for the recap.' : `Using moments from before ${isSceneBreak ? 'the BRB scene' : 'the ad'}.`
    : `${card.bullets.length} recap ${card.bullets.length === 1 ? 'line' : 'lines'}`;
  const provenance = document.createElement('p');
  provenance.textContent = formatProvenance(card.provenance);
  coupon.append(headline, lineInfo, provenance);

  const stub = document.createElement('div');
  stub.className = 'mini-stub';
  const countdownLabel = document.createElement('span');
  countdownLabel.className = 'countdown-label';
  const heldForApproval = !isBreakReview && card.approvalMode === 'hold';
  countdownLabel.textContent = isBreakReview
    ? card.adBreakPhase === 'finishing' ? 'Recap ready within' : `Airs when you leave ${isSceneBreak ? 'the BRB scene' : 'the ad break'}`
    : heldForApproval ? 'Waiting for approval' : 'Auto-approves in';
  const countdown = document.createElement('b');
  countdown.className = 'countdown';
  const sceneBreakWaiting = isSceneBreak && card.adBreakPhase !== 'finishing';
  countdown.textContent = sceneBreakWaiting ? 'BRB' : String(Math.ceil((card.remainingMs ?? (card.approvalSeconds ?? 5) * 1000) / 1000));
  if (heldForApproval) {
    const hold = document.createElement('div');
    hold.className = 'hold-display';
    const hourglass = document.createElement('i');
    hourglass.className = 'ph-light ph-hourglass-medium';
    hourglass.setAttribute('aria-hidden', 'true');
    const holdLabel = document.createElement('b');
    holdLabel.className = 'countdown hold-value';
    holdLabel.textContent = 'Hold';
    hold.append(hourglass, holdLabel);
    stub.classList.add('is-held');
    stub.append(countdownLabel, hold);
  } else if (sceneBreakWaiting) {
    stub.append(countdownLabel, countdown);
  } else {
    const meter = document.createElement('span');
    meter.className = 'meter';
    const meterFill = document.createElement('span');
    meterFill.className = 'meter-fill';
    meter.append(meterFill);
    stub.append(countdownLabel, countdown, meter);
  }
  mini.append(coupon, stub);

  const actions = document.createElement('div');
  actions.className = 'pending-actions';
  const approve = makeButton('Approve now', 'ph-check', 'button primary');
  if (card.approved) {
    approve.disabled = true;
    approve.textContent = 'Approved';
  }
  approve.addEventListener('click', () => void post('/api/approve', { cardId: card.id }).catch(error => showError(error.message)));
  const veto = makeButton('Veto', 'ph-x', 'button veto');
  veto.disabled = Boolean(card.vetoed);
  veto.addEventListener('click', () => {
    box.classList.add('tear');
    veto.disabled = true;
    window.setTimeout(() => { void post('/api/veto', { cardId: card.id }).catch(error => showError(error.message)); }, 100);
  });
  actions.append(approve, veto);
  box.append(top, mini, actions);
  box.dataset.deadline = String(card.deadline ?? (heldForApproval ? '' : Date.now() + (card.remainingMs ?? (card.approvalSeconds ?? 5) * 1000)));
  box.dataset.duration = String((card.approvalSeconds ?? 5) * 1000);
  box.dataset.held = String(heldForApproval || sceneBreakWaiting);
}

function updateCountdown() {
  const box = $('#pending-card');
  if (box.hidden || !box.dataset.cardId || box.dataset.held === 'true') return;
  const remaining = Math.max(0, Number(box.dataset.deadline) - Date.now());
  const duration = Number(box.dataset.duration) || 5000;
  const number = box.querySelector('.countdown');
  const fill = box.querySelector('.meter-fill');
  if (number) number.textContent = String(Math.ceil(remaining / 1000));
  if (fill) fill.style.transform = `scaleX(${Math.min(1, remaining / duration)})`;
}

function renderTranscript() {
  const segments = currentState.voiceSegments ?? [];
  const transcript = $('#transcript');
  transcript.replaceChildren();
  if (!segments.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No transcript yet.';
    transcript.append(empty);
    return;
  }
  for (const segment of segments.slice(-3)) {
    const line = document.createElement('p');
    line.textContent = segment.text;
    transcript.append(line);
  }
}

function renderLog() {
  const cards = currentState.cards ?? [];
  const container = $('#card-log');
  container.replaceChildren();
  $('#empty-log').hidden = cards.length > 0;
  for (const card of cards.slice(0, 20)) container.append(renderLogRow(card));
}

function renderLogRow(card) {
  const details = document.createElement('details');
  details.className = 'log-row';
  const summary = document.createElement('summary');
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = new Date(card.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const trigger = document.createElement('span');
  trigger.className = 'log-trigger';
  trigger.textContent = triggerName(card.trigger);
  if (card.simulated) trigger.textContent += ' SIMULATED';
  const headline = document.createElement('span');
  headline.className = 'log-headline';
  headline.textContent = card.headline;
  const engine = document.createElement('span');
  engine.className = 'log-engine';
  engine.textContent = card.engine === 'model' ? 'AI recap' : 'Quick recap, no AI';
  const status = document.createElement('span');
  status.className = `log-status ${card.status.toLowerCase()}`;
  status.textContent = card.status;
  summary.append(time, trigger, headline, engine, status);
  const detail = document.createElement('div');
  detail.className = 'log-detail';
  const sourceMap = new Map((card.sourceDetails ?? []).map(source => [source.id, source]));
  for (const bullet of card.bullets) {
    const row = document.createElement('div');
    row.className = 'log-bullet';
    const line = document.createElement('p');
    line.textContent = bullet.text;
    const citation = document.createElement('b');
    citation.textContent = `Sources: ${bullet.sources.join(', ')}`;
    row.append(line, citation);
    for (const id of bullet.sources) {
      const source = sourceMap.get(id);
      if (!source) continue;
      const sourceText = document.createElement('p');
      sourceText.className = 'log-source';
      sourceText.textContent = `${id} · ${source.kind}${source.user ? ` · ${source.user}` : ''}: ${source.text}`;
      row.append(sourceText);
    }
    detail.append(row);
  }
  if (card.clipUrl) {
    const link = document.createElement('a');
    link.href = card.clipUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Watch the moment';
    detail.prepend(link);
  }
  details.append(summary, detail);
  return details;
}

async function toggleVoice() {
  if (!recognition) return;
  try {
    if (currentState.voiceEnabled) {
      await post('/api/voice/off');
      currentState.voiceEnabled = false;
      recognition.stop();
    } else {
      $('#voice-warning').hidden = true;
      await post('/api/voice/on');
      currentState.voiceEnabled = true;
      recognition.start();
    }
    renderConnection();
  } catch (error) { showError(error.message); }
}

function formatProvenance(provenance) {
  const parts = [];
  if (provenance.voiceSeconds > 0) parts.push(`${Math.max(1, Math.ceil(provenance.voiceSeconds / 60))} min of voice`);
  if (provenance.chatCount > 0) parts.push(`${provenance.chatCount} chat messages`);
  if (provenance.eventCount > 0) parts.push(`${provenance.eventCount} ${provenance.eventCount === 1 ? 'event' : 'events'}`);
  if (provenance.noteCount > 0) parts.push(`${provenance.noteCount} ${provenance.noteCount === 1 ? 'note' : 'notes'}`);
  return parts.join(', ');
}

function triggerName(trigger) {
  return ({ raid: 'Raid', catchup: '!catchup', break: 'Back from break', brb: 'Back from BRB', 'ad-break': 'Ad break' })[trigger] ?? trigger;
}

function makeButton(label, iconName, className) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  const icon = document.createElement('i');
  icon.className = `ph-light ${iconName}`;
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon, document.createTextNode(label));
  return button;
}

async function post(path, body = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'The request failed.');
  return data.result;
}

function showError(message) {
  $('#panel-error').textContent = message;
  $('#panel-error').hidden = false;
  window.setTimeout(() => { $('#panel-error').hidden = true; }, 5000);
}
