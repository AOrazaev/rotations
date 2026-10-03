import { formatVideoTime } from './youtube-player.js';
import {
  buildVoiceCommandContext,
  editableEventTypes,
  validateVoiceCommandResponse
} from './voice-proposal.js';

const DEFAULT_URL = 'http://127.0.0.1:8766';
const URL_STORAGE_KEY = 'basketball-stats-voice-url';
const TOKEN_STORAGE_KEY = 'basketball-stats-voice-token';

export function createVoiceCaptureController({
  documentObject = document,
  videoController,
  getGame,
  clientFactory,
  mediaDevices = navigator.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder,
  localStorageObject = localStorage,
  sessionStorageObject = sessionStorage
}) {
  const endpointInput = documentObject.querySelector('#voiceCompanionUrl');
  const tokenInput = documentObject.querySelector('#voiceCompanionToken');
  const connectButton = documentObject.querySelector('#voiceConnect');
  const warmupButton = documentObject.querySelector('#voiceWarmup');
  const connectionStatus = documentObject.querySelector('#voiceConnectionStatus');
  const startButton = documentObject.querySelector('#voiceStartRecording');
  const stopButton = documentObject.querySelector('#voiceStopRecording');
  const cancelButton = documentObject.querySelector('#voiceCancelProcessing');
  const retryButton = documentObject.querySelector('#voiceRetryProcessing');
  const discardButton = documentObject.querySelector('#voiceDiscardProposal');
  const replaceTimestampButton = documentObject.querySelector('#voiceReplaceTimestamp');
  const recordingStatus = documentObject.querySelector('#voiceRecordingStatus');
  const timestampOutput = documentObject.querySelector('#voiceCapturedTimestamp');
  const transcript = documentObject.querySelector('#voiceTranscript');
  const warnings = documentObject.querySelector('#voiceWarnings');
  const proposal = documentObject.querySelector('#voiceProposalEvents');

  let client = null;
  let connected = false;
  let state = 'idle';
  let recorder = null;
  let stream = null;
  let chunks = [];
  let audio = null;
  let capturedSeconds = null;
  let activeRequestId = null;
  let response = null;
  let proposalEvents = [];
  let destroyed = false;
  let discarding = false;
  let operationVersion = 0;
  let observedGameId = getGame()?.id || null;

  endpointInput.value = localStorageObject.getItem(URL_STORAGE_KEY) || DEFAULT_URL;
  tokenInput.value = sessionStorageObject.getItem(TOKEN_STORAGE_KEY) || '';

  function setConnectionStatus(message, kind = '') {
    connectionStatus.textContent = message;
    connectionStatus.className = `message voice-status ${kind}`.trim();
  }

  function setRecordingStatus(message, kind = '') {
    recordingStatus.textContent = message;
    recordingStatus.className = `message voice-status ${kind}`.trim();
  }

  function hasGameAndVideo() {
    return Boolean(getGame()) && videoController.isReady();
  }

  function refresh() {
    if (destroyed) return;
    const currentGameId = getGame()?.id || null;
    if (currentGameId !== observedGameId) {
      observedGameId = currentGameId;
      clearCaptureState();
      setRecordingStatus(
        currentGameId
          ? 'Game changed. Record a new proposal for the active game.'
          : 'Open a game with a ready video to record.'
      );
    }
    const ready = connected && hasGameAndVideo();
    startButton.disabled = !ready || !['idle', 'error'].includes(state);
    stopButton.disabled = state !== 'recording';
    cancelButton.disabled = state !== 'processing';
    retryButton.disabled = !audio
      || state === 'recording'
      || state === 'processing'
      || state === 'cancelling'
      || state === 'warming';
    discardButton.disabled = state === 'processing'
      || state === 'cancelling'
      || state === 'warming'
      || (!audio && !response && state === 'idle');
    replaceTimestampButton.disabled = capturedSeconds === null
      || !videoController.isReady()
      || state === 'recording'
      || state === 'processing';
    warmupButton.disabled = !connected
      || !['idle', 'error', 'proposal'].includes(state);
    connectButton.disabled = state === 'recording'
      || state === 'processing'
      || state === 'cancelling'
      || state === 'warming';
  }

  function stopTracks() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  }

  function resetProposal() {
    response = null;
    proposalEvents = [];
    transcript.value = '';
    warnings.replaceChildren();
    proposal.replaceChildren();
  }

  function clearCaptureState() {
    operationVersion += 1;
    if (recorder?.state === 'recording') {
      discarding = true;
      recorder.stop();
    }
    stopTracks();
    recorder = null;
    chunks = [];
    audio = null;
    capturedSeconds = null;
    activeRequestId = null;
    state = 'idle';
    timestampOutput.textContent = 'Not captured';
    resetProposal();
  }

  function discard() {
    if (state === 'processing' || state === 'cancelling') return;
    clearCaptureState();
    setRecordingStatus(
      connected
        ? 'Ready to record when a game and video are available.'
        : 'Connect the companion to enable recording.'
    );
    refresh();
  }

  function option(value, label, selected) {
    const element = documentObject.createElement('option');
    element.value = value;
    element.textContent = label;
    element.selected = selected;
    return element;
  }

  function renderWarnings() {
    warnings.replaceChildren();
    for (const warning of response?.warnings || []) {
      const item = documentObject.createElement('li');
      item.textContent = warning;
      warnings.append(item);
    }
    warnings.classList.toggle('hidden', !warnings.children.length);
  }

  function renderProposal() {
    proposal.replaceChildren();
    const game = getGame();
    if (!proposalEvents.length) {
      const empty = documentObject.createElement('p');
      empty.className = 'message';
      empty.textContent = response ? 'No events were proposed.' : 'No proposal yet.';
      proposal.append(empty);
      return;
    }

    proposalEvents.forEach((event, index) => {
      const card = documentObject.createElement('fieldset');
      card.className = 'voice-proposal-event';
      card.dataset.proposalIndex = String(index);
      const legend = documentObject.createElement('legend');
      legend.textContent = `Event ${index + 1} · ${Math.round(event.confidence * 100)}% confidence`;
      card.append(legend);

      const grid = documentObject.createElement('div');
      grid.className = 'voice-proposal-grid';

      const sideLabel = documentObject.createElement('label');
      sideLabel.textContent = 'Side';
      const sideSelect = documentObject.createElement('select');
      sideSelect.dataset.voiceField = 'side';
      sideSelect.append(
        option('team', 'Our team', event.side === 'team'),
        option('opponent', 'Opponent', event.side === 'opponent')
      );
      sideLabel.append(sideSelect);
      grid.append(sideLabel);

      const playerLabel = documentObject.createElement('label');
      playerLabel.textContent = 'Player';
      const playerSelect = documentObject.createElement('select');
      playerSelect.dataset.voiceField = 'playerId';
      playerSelect.disabled = event.side === 'opponent';
      playerSelect.append(option('', 'Select player', !event.playerId));
      for (const player of game.players) {
        const label = player.number ? `#${player.number} ${player.name}` : player.name;
        playerSelect.append(option(player.id, label, event.playerId === player.id));
      }
      playerLabel.append(playerSelect);
      grid.append(playerLabel);

      const typeLabel = documentObject.createElement('label');
      typeLabel.textContent = 'Event';
      const typeSelect = documentObject.createElement('select');
      typeSelect.dataset.voiceField = 'type';
      for (const type of editableEventTypes()) {
        typeSelect.append(option(type, type.replace('_', ' '), event.type === type));
      }
      typeLabel.append(typeSelect);
      grid.append(typeLabel);

      if (event.type === 'shot') {
        const valueLabel = documentObject.createElement('label');
        valueLabel.textContent = 'Shot value';
        const valueSelect = documentObject.createElement('select');
        valueSelect.dataset.voiceField = 'shotValue';
        [1, 2, 3].forEach(value => valueSelect.append(
          option(String(value), `${value} point`, event.shotValue === value)
        ));
        valueLabel.append(valueSelect);
        grid.append(valueLabel);

        const resultLabel = documentObject.createElement('label');
        resultLabel.textContent = 'Result';
        const resultSelect = documentObject.createElement('select');
        resultSelect.dataset.voiceField = 'made';
        resultSelect.append(
          option('true', 'Made', event.made === true),
          option('false', 'Missed', event.made === false)
        );
        resultLabel.append(resultSelect);
        grid.append(resultLabel);
      }

      if (event.type === 'rebound') {
        const reboundLabel = documentObject.createElement('label');
        reboundLabel.textContent = 'Rebound';
        const reboundSelect = documentObject.createElement('select');
        reboundSelect.dataset.voiceField = 'reboundKind';
        reboundSelect.append(
          option('offensive', 'Offensive', event.reboundKind === 'offensive'),
          option('defensive', 'Defensive', event.reboundKind === 'defensive')
        );
        reboundLabel.append(reboundSelect);
        grid.append(reboundLabel);
      }

      const removeButton = documentObject.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'danger small voice-remove-event';
      removeButton.dataset.voiceAction = 'remove';
      removeButton.textContent = 'Remove event';
      grid.append(removeButton);
      card.append(grid);
      proposal.append(card);
    });
  }

  function updateProposalEvent(target) {
    const card = target.closest('[data-proposal-index]');
    if (!card) return;
    const index = Number(card.dataset.proposalIndex);
    const event = proposalEvents[index];
    if (!event) return;
    if (target.dataset.voiceAction === 'remove') {
      proposalEvents.splice(index, 1);
      renderProposal();
      refresh();
      return;
    }
    const field = target.dataset.voiceField;
    if (!field) return;
    if (field === 'side') {
      event.side = target.value;
      if (event.side === 'opponent') event.playerId = null;
    } else if (field === 'playerId') {
      event.playerId = target.value || null;
    } else if (field === 'type') {
      event.type = target.value;
      delete event.shotValue;
      delete event.made;
      delete event.reboundKind;
      delete event.shotDetails;
      if (event.type === 'shot') {
        event.shotValue = 2;
        event.made = true;
      } else if (event.type === 'rebound') {
        event.reboundKind = 'defensive';
      }
    } else if (field === 'shotValue') {
      event.shotValue = Number(target.value);
    } else if (field === 'made') {
      event.made = target.value === 'true';
    } else if (field === 'reboundKind') {
      event.reboundKind = target.value;
    }
    renderProposal();
    refresh();
  }

  async function connect() {
    setConnectionStatus('Checking companion...', 'loading');
    connectButton.disabled = true;
    try {
      const nextClient = clientFactory({
        baseUrl: endpointInput.value,
        token: tokenInput.value
      });
      const { health, capabilities } = await nextClient.check();
      client = nextClient;
      connected = true;
      localStorageObject.setItem(URL_STORAGE_KEY, client.baseUrl || endpointInput.value);
      sessionStorageObject.setItem(TOKEN_STORAGE_KEY, tokenInput.value);
      setConnectionStatus(
        `Connected · ${capabilities.transcriptionModel || 'transcription'} + ${capabilities.commandModel || 'command model'} · ${health.status}`,
        'ready'
      );
      setRecordingStatus(
        hasGameAndVideo()
          ? 'Ready to record.'
          : 'Connected. Open a game with a ready video to record.'
      );
    } catch (error) {
      client = null;
      connected = false;
      setConnectionStatus(error.message || 'Could not connect.', 'error');
    } finally {
      refresh();
    }
  }

  async function warmup() {
    if (!client) return;
    const previousState = state;
    state = 'warming';
    setConnectionStatus('Warming companion models...', 'loading');
    refresh();
    try {
      const result = await client.warmup();
      setConnectionStatus(
        `Models ready in ${result.timingMs?.total ?? 0} ms.`,
        'ready'
      );
    } catch (error) {
      setConnectionStatus(error.message || 'Model warmup failed.', 'error');
    } finally {
      state = previousState;
      refresh();
    }
  }

  async function processAudio() {
    if (!audio || capturedSeconds === null || !client) return;
    const game = getGame();
    if (!game) {
      state = 'error';
      setRecordingStatus('The active game is no longer available.', 'error');
      refresh();
      return;
    }
    const requestId = crypto.randomUUID();
    const requestGameId = game.id;
    const currentOperation = ++operationVersion;
    activeRequestId = requestId;
    state = 'processing';
    resetProposal();
    setRecordingStatus('Transcribing and interpreting the recording...', 'loading');
    refresh();
    try {
      const context = buildVoiceCommandContext(game, capturedSeconds, requestId);
      const payload = await client.voiceCommand({ audio, context });
      if (currentOperation !== operationVersion || destroyed) return;
      if (getGame()?.id !== requestGameId) {
        observedGameId = getGame()?.id || null;
        clearCaptureState();
        setRecordingStatus(
          observedGameId
            ? 'Game changed while processing. Record a new proposal for the active game.'
            : 'The active game is no longer available.',
          'error'
        );
        return;
      }
      response = validateVoiceCommandResponse(payload, { requestId, game });
      proposalEvents = structuredClone(response.events);
      transcript.value = response.transcript;
      renderWarnings();
      renderProposal();
      state = 'proposal';
      setRecordingStatus(
        `${proposalEvents.length} proposed event${proposalEvents.length === 1 ? '' : 's'} at ${formatVideoTime(capturedSeconds)}. Review only; nothing has been saved.`,
        'ready'
      );
    } catch (error) {
      if (currentOperation !== operationVersion || destroyed) return;
      if (error.partialResult?.transcript) {
        transcript.value = error.partialResult.transcript;
      }
      state = error.code === 'request_cancelled' ? 'idle' : 'error';
      setRecordingStatus(
        error.code === 'request_cancelled'
          ? 'Processing cancelled. The recording is available to retry.'
          : (error.message || 'Voice processing failed.'),
        error.code === 'request_cancelled' ? '' : 'error'
      );
    } finally {
      if (currentOperation === operationVersion && !destroyed) {
        activeRequestId = null;
        refresh();
      }
    }
  }

  async function startRecording() {
    if (!connected || !hasGameAndVideo() || state === 'recording' || state === 'processing') return;
    if (!mediaDevices?.getUserMedia || !MediaRecorderClass) {
      state = 'error';
      setRecordingStatus('Microphone recording is unavailable in this browser.', 'error');
      refresh();
      return;
    }
    resetProposal();
    audio = null;
    chunks = [];
    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
      capturedSeconds = videoController.getCurrentSeconds();
      timestampOutput.textContent = formatVideoTime(capturedSeconds);
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        .find(type => !MediaRecorderClass.isTypeSupported
          || MediaRecorderClass.isTypeSupported(type));
      recorder = new MediaRecorderClass(
        stream,
        preferredType ? { mimeType: preferredType } : undefined
      );
      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        if (destroyed) return;
        if (discarding) {
          discarding = false;
          stopTracks();
          recorder = null;
          return;
        }
        audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        stopTracks();
        recorder = null;
        processAudio();
      });
      recorder.start();
      state = 'recording';
      setRecordingStatus(
        `Recording at ${formatVideoTime(capturedSeconds)}. Stop when the command is complete.`,
        'recording'
      );
    } catch (error) {
      stopTracks();
      recorder = null;
      state = 'error';
      setRecordingStatus(
        `Could not start recording: ${error.message || 'microphone unavailable'}`,
        'error'
      );
    }
    refresh();
  }

  function stopRecording() {
    if (recorder?.state !== 'recording') return;
    state = 'processing';
    setRecordingStatus('Finishing the recording...', 'loading');
    recorder.stop();
    refresh();
  }

  async function cancelProcessing() {
    if (!client || !activeRequestId) return;
    state = 'cancelling';
    setRecordingStatus('Requesting cancellation...', 'loading');
    refresh();
    try {
      await client.cancel(activeRequestId);
    } catch (error) {
      state = 'processing';
      setRecordingStatus(error.message || 'Could not cancel processing.', 'error');
      refresh();
    }
  }

  function replaceTimestamp() {
    if (!videoController.isReady() || capturedSeconds === null) return;
    capturedSeconds = videoController.getCurrentSeconds();
    timestampOutput.textContent = formatVideoTime(capturedSeconds);
    setRecordingStatus(
      `Proposal timestamp replaced with ${formatVideoTime(capturedSeconds)}. Nothing has been saved.`
    );
  }

  connectButton.addEventListener('click', connect);
  warmupButton.addEventListener('click', warmup);
  startButton.addEventListener('click', startRecording);
  stopButton.addEventListener('click', stopRecording);
  cancelButton.addEventListener('click', cancelProcessing);
  retryButton.addEventListener('click', processAudio);
  discardButton.addEventListener('click', discard);
  replaceTimestampButton.addEventListener('click', replaceTimestamp);
  proposal.addEventListener('change', event => updateProposalEvent(event.target));
  proposal.addEventListener('click', event => {
    if (event.target.dataset.voiceAction === 'remove') {
      updateProposalEvent(event.target);
    }
  });
  const unsubscribeReady = videoController.subscribeReady(refresh);

  discard();
  if (tokenInput.value) connect();

  return {
    refresh,
    getState() {
      return {
        state,
        connected,
        capturedSeconds,
        transcript: transcript.value,
        events: structuredClone(proposalEvents)
      };
    },
    destroy() {
      destroyed = true;
      operationVersion += 1;
      unsubscribeReady();
      stopTracks();
      if (recorder?.state === 'recording') recorder.stop();
    }
  };
}
