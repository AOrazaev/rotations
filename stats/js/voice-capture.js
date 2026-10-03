import { formatVideoTime } from './youtube-player.js';
import {
  buildVoiceCommandContext,
  editableEventTypes,
  validateVoiceCommandResponse
} from './voice-proposal.js';

const DEFAULT_URL = 'http://127.0.0.1:8766';
const URL_STORAGE_KEY = 'basketball-stats-voice-url';
const TOKEN_STORAGE_KEY = 'basketball-stats-voice-token';
const MICROPHONE_STORAGE_KEY = 'basketball-stats-voice-microphone';
const AUDIO_PROCESSING_STORAGE_KEY = 'basketball-stats-voice-audio-processing';
const CHANNEL_PREFERENCE_STORAGE_KEY = 'basketball-stats-voice-channel-preference';
const PAUSE_VIDEO_STORAGE_KEY = 'basketball-stats-voice-pause-video';

export function classifyChannelActivity(leftRms, rightRms) {
  const threshold = 0.003;
  const leftActive = leftRms >= threshold;
  const rightActive = rightRms >= threshold;
  if (leftActive && rightActive) return 'Both channels active';
  if (leftActive) return 'Left channel active';
  if (rightActive) return 'Right channel active';
  return 'No clear input';
}

export function createVoiceCaptureController({
  documentObject = document,
  videoController,
  getGame,
  commitProposal = async () => {
    throw new Error('Voice event confirmation is unavailable.');
  },
  undoProposal = async () => {
    throw new Error('Voice batch undo is unavailable.');
  },
  clientFactory,
  mediaDevices = navigator.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder,
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  localStorageObject = localStorage,
  sessionStorageObject = sessionStorage
}) {
  const endpointInput = documentObject.querySelector('#voiceCompanionUrl');
  const tokenInput = documentObject.querySelector('#voiceCompanionToken');
  const connectButton = documentObject.querySelector('#voiceConnect');
  const warmupButton = documentObject.querySelector('#voiceWarmup');
  const connectionStatus = documentObject.querySelector('#voiceConnectionStatus');
  const audioSummary = documentObject.querySelector('#voiceAudioSummary');
  const openAudioSettingsButton = documentObject.querySelector('#voiceOpenAudioSettings');
  const audioSettingsDialog = documentObject.querySelector('#voiceAudioSettingsDialog');
  const closeAudioSettingsButton = documentObject.querySelector('#voiceCloseAudioSettings');
  const microphoneSelect = documentObject.querySelector('#voiceMicrophone');
  const audioProcessingSelect = documentObject.querySelector('#voiceAudioProcessing');
  const channelPreferenceSelect = documentObject.querySelector('#voiceChannelPreference');
  const refreshMicrophonesButton = documentObject.querySelector('#voiceRefreshMicrophones');
  const pauseVideoInput = documentObject.querySelector('#voicePauseVideoDuringRecording');
  const toggleChannelTestButton = documentObject.querySelector('#voiceToggleChannelTest');
  const leftChannelLevel = documentObject.querySelector('#voiceLeftChannelLevel');
  const rightChannelLevel = documentObject.querySelector('#voiceRightChannelLevel');
  const channelStatus = documentObject.querySelector('#voiceChannelStatus');
  const startButton = documentObject.querySelector('#voiceStartRecording');
  const stopButton = documentObject.querySelector('#voiceStopRecording');
  const cancelButton = documentObject.querySelector('#voiceCancelProcessing');
  const retryButton = documentObject.querySelector('#voiceRetryProcessing');
  const confirmButton = documentObject.querySelector('#voiceConfirmProposal');
  const undoBatchButton = documentObject.querySelector('#voiceUndoBatch');
  const discardButton = documentObject.querySelector('#voiceDiscardProposal');
  const replaceTimestampButton = documentObject.querySelector('#voiceReplaceTimestamp');
  const recordingStatus = documentObject.querySelector('#voiceRecordingStatus');
  const recordingPreview = documentObject.querySelector('#voiceRecordingPreview');
  const timestampOutput = documentObject.querySelector('#voiceCapturedTimestamp');
  const transcript = documentObject.querySelector('#voiceTranscript');
  const expectedTranscript = documentObject.querySelector('#voiceExpectedTranscript');
  const warnings = documentObject.querySelector('#voiceWarnings');
  const proposal = documentObject.querySelector('#voiceProposalEvents');
  const saveEvaluationButton = documentObject.querySelector('#voiceSaveEvaluation');
  const evaluationStatus = documentObject.querySelector('#voiceEvaluationStatus');
  const refreshEvaluationsButton = documentObject.querySelector('#voiceRefreshEvaluations');
  const evaluationList = documentObject.querySelector('#voiceEvaluationList');

  let client = null;
  let connected = false;
  let state = 'idle';
  let recorder = null;
  let stream = null;
  let chunks = [];
  let audio = null;
  let audioPreviewUrl = null;
  let capturedSeconds = null;
  let activeRequestId = null;
  let response = null;
  let lastContext = null;
  let proposalEvents = [];
  let proposalGameUpdatedAt = null;
  let committedBatch = null;
  let destroyed = false;
  let discarding = false;
  let resumePlaybackAfterRecording = false;
  let channelPreviewStream = null;
  let channelPreviewContext = null;
  let channelPreviewFrame = null;
  let operationVersion = 0;
  let observedGameId = getGame()?.id || null;

  endpointInput.value = localStorageObject.getItem(URL_STORAGE_KEY) || DEFAULT_URL;
  tokenInput.value = sessionStorageObject.getItem(TOKEN_STORAGE_KEY) || '';
  microphoneSelect.value = localStorageObject.getItem(MICROPHONE_STORAGE_KEY) || '';
  audioProcessingSelect.value = localStorageObject.getItem(
    AUDIO_PROCESSING_STORAGE_KEY
  ) || 'raw';
  channelPreferenceSelect.value = localStorageObject.getItem(
    CHANNEL_PREFERENCE_STORAGE_KEY
  ) || 'auto';
  pauseVideoInput.checked = localStorageObject.getItem(PAUSE_VIDEO_STORAGE_KEY) === 'true';

  function setConnectionStatus(message, kind = '') {
    connectionStatus.textContent = message;
    connectionStatus.className = `message voice-status ${kind}`.trim();
  }

  function setRecordingStatus(message, kind = '') {
    recordingStatus.textContent = message;
    recordingStatus.className = `message voice-status ${kind}`.trim();
  }

  function updateAudioSummary() {
    const microphone = microphoneSelect.selectedOptions[0]?.textContent
      || 'System default microphone';
    const processing = audioProcessingSelect.value === 'processed'
      ? 'Processed speech'
      : 'Raw input';
    const channel = {
      auto: 'Automatic channels',
      left: 'Left only',
      right: 'Right only',
      mix: 'Mix both'
    }[channelPreferenceSelect.value];
    const playback = pauseVideoInput.checked ? 'pause video' : 'keep video playing';
    audioSummary.textContent = `${microphone} · ${processing} · ${channel} · ${playback}`;
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
    if (state === 'committed' && committedBatch) {
      const game = getGame();
      const batchIds = new Set(committedBatch.eventIds);
      const presentIds = game?.events
          .filter(event => batchIds.has(event.id))
          .map(event => event.id) || [];
      if (!presentIds.length) {
          clearCaptureState();
          setRecordingStatus('Voice batch undone. No events from it remain in the game.', 'ready');
      } else if (presentIds.length !== committedBatch.eventIds.length) {
          committedBatch.undoAvailable = false;
          setRecordingStatus(
            'Part of the voice batch changed outside the proposal workflow. Review the timeline before continuing.',
            'error'
          );
      } else {
          const ordered = [...game.events].sort((a, b) => a.sequence - b.sequence);
          const latestIds = ordered
            .slice(-committedBatch.eventIds.length)
            .map(event => event.id);
          committedBatch.undoAvailable = latestIds.every(
            (eventId, index) => eventId === committedBatch.eventIds[index]
          );
          if (!committedBatch.undoAvailable) {
            setRecordingStatus(
              'Another event was added after this voice batch, so batch undo is no longer available.',
              'error'
            );
          }
      }
    }
    const ready = connected && hasGameAndVideo();
    startButton.disabled = !ready || !['idle', 'error'].includes(state);
    stopButton.disabled = state !== 'recording';
    cancelButton.disabled = state !== 'processing';
    retryButton.disabled = !audio
      || state === 'recording'
      || state === 'processing'
      || state === 'cancelling'
      || state === 'warming'
      || state === 'committing'
      || state === 'committed'
      || state === 'undoing';
    confirmButton.disabled = state !== 'proposal' || !proposalEvents.length;
    undoBatchButton.disabled = state !== 'committed'
      || !committedBatch
      || committedBatch.undoAvailable === false;
    discardButton.disabled = state === 'processing'
      || state === 'cancelling'
      || state === 'warming'
      || state === 'committing'
      || state === 'undoing'
      || (!audio && !response && state === 'idle');
    discardButton.textContent = state === 'committed' ? 'Done' : 'Discard';
    replaceTimestampButton.disabled = capturedSeconds === null
      || !videoController.isReady()
      || state === 'recording'
      || state === 'processing'
      || state === 'committing'
      || state === 'committed'
      || state === 'undoing';
    warmupButton.disabled = !connected
      || !['idle', 'error', 'proposal'].includes(state);
    connectButton.disabled = state === 'recording'
      || state === 'processing'
      || state === 'cancelling'
      || state === 'warming';
    openAudioSettingsButton.disabled = state === 'recording'
      || state === 'processing'
      || state === 'cancelling'
      || state === 'warming';
    saveEvaluationButton.disabled = !client
      || !audio
      || !lastContext
      || !transcript.value.trim()
      || !expectedTranscript.value.trim()
      || ['recording', 'processing', 'cancelling', 'warming', 'saving'].includes(state);
    refreshEvaluationsButton.disabled = !client || state === 'saving';
  }

  function stopTracks() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  }

  function resumeVideoPlayback() {
    if (!resumePlaybackAfterRecording) return;
    resumePlaybackAfterRecording = false;
    if (videoController.isReady()) videoController.play();
  }

  function clearAudioPreview() {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    audioPreviewUrl = null;
    recordingPreview.removeAttribute('src');
    recordingPreview.classList.add('hidden');
  }

  function showAudioPreview() {
    clearAudioPreview();
    if (!audio) return;
    audioPreviewUrl = URL.createObjectURL(audio);
    recordingPreview.src = audioPreviewUrl;
    recordingPreview.classList.remove('hidden');
  }

  async function refreshMicrophones() {
    if (!mediaDevices?.enumerateDevices) {
      microphoneSelect.disabled = true;
      refreshMicrophonesButton.disabled = true;
      return;
    }
    try {
      const selected = microphoneSelect.value
        || localStorageObject.getItem(MICROPHONE_STORAGE_KEY)
        || '';
      const devices = (await mediaDevices.enumerateDevices())
        .filter(device => device.kind === 'audioinput');
      microphoneSelect.replaceChildren(
        option('', 'System default microphone', !selected)
      );
      devices.forEach((device, index) => {
        microphoneSelect.append(option(
          device.deviceId,
          device.label || `Microphone ${index + 1}`,
          device.deviceId === selected
        ));
      });
      updateAudioSummary();
    } catch (error) {
      setRecordingStatus(
        `Could not list microphones: ${error.message || 'device enumeration failed'}`,
        'error'
      );
    }
  }

  function audioConstraints({ stereoPreview = false } = {}) {
      const selectedDeviceId = microphoneSelect.value;
      const processedAudio = audioProcessingSelect.value === 'processed';
      return {
        ...(selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : {}),
        channelCount: stereoPreview ? 2 : 1,
        echoCancellation: processedAudio,
        noiseSuppression: processedAudio,
        autoGainControl: processedAudio
      };
  }

  function channelLevelPercent(rms) {
      if (rms <= 0) return 0;
      const decibels = 20 * Math.log10(rms);
      return Math.max(0, Math.min(100, ((decibels + 60) / 60) * 100));
  }

  async function stopChannelPreview() {
      if (channelPreviewFrame !== null) {
        documentObject.defaultView.cancelAnimationFrame(channelPreviewFrame);
        channelPreviewFrame = null;
      }
      channelPreviewStream?.getTracks().forEach(track => track.stop());
      channelPreviewStream = null;
      if (channelPreviewContext) await channelPreviewContext.close();
      channelPreviewContext = null;
      leftChannelLevel.style.width = '0%';
      rightChannelLevel.style.width = '0%';
      toggleChannelTestButton.textContent = 'Start preview';
      channelStatus.textContent = 'Preview is stopped.';
      channelStatus.className = 'message voice-status';
  }

  async function toggleChannelPreview() {
      if (channelPreviewStream) {
        await stopChannelPreview();
        return;
      }
      if (!AudioContextClass) {
        channelStatus.textContent = 'Live channel preview is unavailable in this browser.';
        channelStatus.className = 'message voice-status error';
        return;
      }
      toggleChannelTestButton.disabled = true;
      channelStatus.textContent = 'Starting microphone preview...';
      channelStatus.className = 'message voice-status loading';
      try {
        channelPreviewStream = await mediaDevices.getUserMedia({
          audio: audioConstraints({ stereoPreview: true })
        });
        await refreshMicrophones();
        channelPreviewContext = new AudioContextClass();
        const source = channelPreviewContext.createMediaStreamSource(
          channelPreviewStream
        );
        const splitter = channelPreviewContext.createChannelSplitter(2);
        const leftAnalyser = channelPreviewContext.createAnalyser();
        const rightAnalyser = channelPreviewContext.createAnalyser();
        leftAnalyser.fftSize = 256;
        rightAnalyser.fftSize = 256;
        source.connect(splitter);
        splitter.connect(leftAnalyser, 0);
        splitter.connect(rightAnalyser, 1);
        const leftData = new Float32Array(leftAnalyser.fftSize);
        const rightData = new Float32Array(rightAnalyser.fftSize);
        const rms = data => Math.sqrt(
          data.reduce((sum, value) => sum + (value * value), 0) / data.length
        );
        const update = () => {
          leftAnalyser.getFloatTimeDomainData(leftData);
          rightAnalyser.getFloatTimeDomainData(rightData);
          const leftRms = rms(leftData);
          const rightRms = rms(rightData);
          leftChannelLevel.style.width = `${channelLevelPercent(leftRms)}%`;
          rightChannelLevel.style.width = `${channelLevelPercent(rightRms)}%`;
          channelStatus.textContent = classifyChannelActivity(leftRms, rightRms);
          channelStatus.className = 'message voice-status ready';
          channelPreviewFrame = documentObject.defaultView.requestAnimationFrame(update);
        };
        toggleChannelTestButton.textContent = 'Stop preview';
        update();
      } catch (error) {
        await stopChannelPreview();
        channelStatus.textContent = `Could not start preview: ${error.message || 'microphone unavailable'}`;
        channelStatus.className = 'message voice-status error';
      } finally {
        toggleChannelTestButton.disabled = false;
    }
  }

  function resetProposal() {
    response = null;
    lastContext = null;
    proposalEvents = [];
    proposalGameUpdatedAt = null;
    committedBatch = null;
    transcript.value = '';
    expectedTranscript.value = '';
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
    resumeVideoPlayback();
    recorder = null;
    chunks = [];
    audio = null;
    clearAudioPreview();
    capturedSeconds = null;
    activeRequestId = null;
    state = 'idle';
    timestampOutput.textContent = 'Not captured';
    resetProposal();
  }

  function discard() {
    if (state === 'processing' || state === 'cancelling') return;
    const saved = state === 'committed';
    clearCaptureState();
    setRecordingStatus(
      saved
        ? 'Voice events saved. Ready for another recording.'
        : connected
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
      sideSelect.disabled = Boolean(committedBatch);
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
      playerSelect.disabled = event.side === 'opponent' || Boolean(committedBatch);
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
      typeSelect.disabled = Boolean(committedBatch);
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
        valueSelect.disabled = Boolean(committedBatch);
        [1, 2, 3].forEach(value => valueSelect.append(
          option(String(value), `${value} point`, event.shotValue === value)
        ));
        valueLabel.append(valueSelect);
        grid.append(valueLabel);

        const resultLabel = documentObject.createElement('label');
        resultLabel.textContent = 'Result';
        const resultSelect = documentObject.createElement('select');
        resultSelect.dataset.voiceField = 'made';
        resultSelect.disabled = Boolean(committedBatch);
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
        reboundSelect.disabled = Boolean(committedBatch);
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
      removeButton.disabled = Boolean(committedBatch);
      grid.append(removeButton);
      card.append(grid);
      proposal.append(card);
    });
  }

  function updateProposalEvent(target) {
    if (committedBatch) return;
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
      if (tokenInput.value) {
        sessionStorageObject.setItem(TOKEN_STORAGE_KEY, tokenInput.value);
      } else {
        sessionStorageObject.removeItem(TOKEN_STORAGE_KEY);
      }
      const securityLabel = capabilities.security?.tokenRequired === false
        ? 'tokenless local mode'
        : 'authenticated';
      setConnectionStatus(
        `Connected · ${securityLabel} · ${capabilities.transcriptionModel || 'transcription'} + ${capabilities.commandModel || 'command model'} · ${health.status}`,
        'ready'
      );
      setRecordingStatus(
        hasGameAndVideo()
          ? 'Ready to record.'
          : 'Connected. Open a game with a ready video to record.'
      );
      await loadEvaluationSamples();
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
    const requestGameUpdatedAt = game.updatedAt;
    const currentOperation = ++operationVersion;
    activeRequestId = requestId;
    state = 'processing';
    resetProposal();
    setRecordingStatus('Transcribing and interpreting the recording...', 'loading');
    refresh();
    try {
      const context = buildVoiceCommandContext(
        game,
        capturedSeconds,
        requestId,
        channelPreferenceSelect.value
      );
      lastContext = structuredClone(context);
      const payload = await client.voiceCommand({ audio, context });
      if (currentOperation !== operationVersion || destroyed) return;
      const activeGame = getGame();
      if (activeGame?.id !== requestGameId
        || activeGame?.updatedAt !== requestGameUpdatedAt) {
        observedGameId = activeGame?.id || null;
        clearCaptureState();
        setRecordingStatus(
          observedGameId === requestGameId
            ? 'Game events changed while processing. Retry the recording for the current game state.'
            : observedGameId
              ? 'Game changed while processing. Record a new proposal for the active game.'
            : 'The active game is no longer available.',
          'error'
        );
        return;
      }
      response = validateVoiceCommandResponse(payload, { requestId, game });
      proposalEvents = structuredClone(response.events);
      proposalGameUpdatedAt = requestGameUpdatedAt;
      transcript.value = response.transcript;
      expectedTranscript.value = response.transcript;
      renderWarnings();
      state = 'proposal';
      renderProposal();
      setRecordingStatus(
        `${proposalEvents.length} proposed event${proposalEvents.length === 1 ? '' : 's'} at ${formatVideoTime(capturedSeconds)}. Review only; nothing has been saved.`,
        'ready'
      );
    } catch (error) {
      if (currentOperation !== operationVersion || destroyed) return;
      if (error.partialResult?.transcript) {
        transcript.value = error.partialResult.transcript;
        expectedTranscript.value = error.partialResult.transcript;
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
      await stopChannelPreview();
      stream = await mediaDevices.getUserMedia({
        audio: audioConstraints()
      });
      await refreshMicrophones();
      capturedSeconds = videoController.getCurrentSeconds();
      timestampOutput.textContent = formatVideoTime(capturedSeconds);
      resumePlaybackAfterRecording = pauseVideoInput.checked
        && videoController.isPlaying();
      if (resumePlaybackAfterRecording) videoController.pause();
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        .find(type => !MediaRecorderClass.isTypeSupported
          || MediaRecorderClass.isTypeSupported(type));
      recorder = new MediaRecorderClass(
        stream,
        {
          ...(preferredType ? { mimeType: preferredType } : {}),
          audioBitsPerSecond: 128000
        }
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
          resumeVideoPlayback();
          return;
        }
        audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        showAudioPreview();
        stopTracks();
        recorder = null;
        resumeVideoPlayback();
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
      resumeVideoPlayback();
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

  async function confirmProposalEvents() {
    if (state !== 'proposal' || !proposalEvents.length || capturedSeconds === null) return;
    const game = getGame();
    if (!game || !proposalGameUpdatedAt) {
      setRecordingStatus('The active game is no longer available.', 'error');
      return;
    }
    state = 'committing';
    setRecordingStatus('Adding the voice events as one game update...', 'loading');
    refresh();
    try {
      committedBatch = await commitProposal({
        expectedGameId: game.id,
        expectedGameUpdatedAt: proposalGameUpdatedAt,
        capturedSeconds,
        events: structuredClone(proposalEvents)
      });
      committedBatch.undoAvailable = true;
      proposalGameUpdatedAt = committedBatch.gameUpdatedAt;
      state = 'committed';
      renderProposal();
      setRecordingStatus(
        `${committedBatch.eventIds.length} voice event${committedBatch.eventIds.length === 1 ? '' : 's'} added at ${formatVideoTime(capturedSeconds)}. Undo removes the full batch.`,
        'ready'
      );
    } catch (error) {
      state = error.code === 'voice_game_changed' ? 'error' : 'proposal';
      setRecordingStatus(error.message || 'Could not add the voice events.', 'error');
    } finally {
      refresh();
    }
  }

  async function undoCommittedBatch() {
    if (state !== 'committed' || !committedBatch || committedBatch.undoAvailable === false) return;
    state = 'undoing';
    setRecordingStatus('Undoing the complete voice batch...', 'loading');
    refresh();
    try {
      await undoProposal({
        expectedGameId: committedBatch.gameId,
        eventIds: [...committedBatch.eventIds]
      });
      clearCaptureState();
      setRecordingStatus('Voice batch undone. No events from it remain in the game.', 'ready');
    } catch (error) {
      state = 'committed';
      setRecordingStatus(error.message || 'Could not undo the voice batch.', 'error');
    } finally {
      refresh();
    }
  }

  function evaluationOutcome() {
    if (!response) return 'corrected_after_processing_error';
    const transcriptChanged = expectedTranscript.value.trim() !== response.transcript.trim();
    const eventsChanged = JSON.stringify(proposalEvents) !== JSON.stringify(response.events);
    return transcriptChanged || eventsChanged ? 'corrected' : 'accepted';
  }

  async function saveEvaluationSample() {
    if (saveEvaluationButton.disabled || !client) return;
    const previousState = state;
    state = 'saving';
    evaluationStatus.textContent = 'Saving audio and evaluation metadata locally...';
    evaluationStatus.className = 'message voice-status loading';
    refresh();
    try {
      const result = await client.saveEvaluationSample({
        audio,
        metadata: {
          capturedSeconds,
          context: lastContext,
          originalTranscript: transcript.value,
          originalEvents: structuredClone(response?.events || []),
          correctedTranscript: expectedTranscript.value.trim(),
          correctedEvents: structuredClone(proposalEvents),
          warnings: structuredClone(response?.warnings || []),
          processor: structuredClone(response?.processor || {}),
          timingMs: structuredClone(response?.timingMs || {}),
          outcome: evaluationOutcome()
        }
      });
      evaluationStatus.textContent = `Saved evaluation sample ${result.sample.sampleId}.`;
      evaluationStatus.className = 'message voice-status ready';
      await loadEvaluationSamples();
    } catch (error) {
      evaluationStatus.textContent = error.message || 'Could not save evaluation sample.';
      evaluationStatus.className = 'message voice-status error';
    } finally {
      state = previousState;
      refresh();
    }
  }

  function renderEvaluationSamples(samples) {
    evaluationList.replaceChildren();
    if (!samples.length) {
      const empty = documentObject.createElement('p');
      empty.className = 'message';
      empty.textContent = 'No evaluation samples saved.';
      evaluationList.append(empty);
      return;
    }
    for (const sample of samples) {
      const item = documentObject.createElement('article');
      item.className = 'voice-evaluation-item';
      item.dataset.sampleId = sample.sampleId;
      const time = documentObject.createElement('time');
      time.dateTime = sample.createdAt;
      time.textContent = new Date(sample.createdAt).toLocaleString();
      const text = documentObject.createElement('p');
      text.textContent = sample.correctedTranscript || sample.originalTranscript;
      const outcome = documentObject.createElement('p');
      outcome.className = 'message';
      outcome.textContent = sample.outcome.replaceAll('_', ' ');
      const actions = documentObject.createElement('div');
      actions.className = 'voice-actions';
      const exportButton = documentObject.createElement('button');
      exportButton.type = 'button';
      exportButton.className = 'secondary small';
      exportButton.dataset.evaluationAction = 'export';
      exportButton.textContent = 'Export';
      const deleteButton = documentObject.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'danger small';
      deleteButton.dataset.evaluationAction = 'delete';
      deleteButton.textContent = 'Delete';
      actions.append(exportButton, deleteButton);
      item.append(time, text, outcome, actions);
      evaluationList.append(item);
    }
  }

  async function loadEvaluationSamples() {
    if (!client) return;
    try {
      const result = await client.listEvaluationSamples();
      renderEvaluationSamples(result.samples);
    } catch (error) {
      evaluationList.replaceChildren();
      const message = documentObject.createElement('p');
      message.className = 'message error';
      message.textContent = error.message || 'Could not load evaluation samples.';
      evaluationList.append(message);
    }
  }

  async function handleEvaluationAction(target) {
    const item = target.closest('[data-sample-id]');
    const action = target.dataset.evaluationAction;
    if (!item || !action || !client) return;
    const sampleId = item.dataset.sampleId;
    target.disabled = true;
    try {
      if (action === 'delete') {
        if (!documentObject.defaultView.confirm(
          'Delete this local evaluation sample and its audio recording?'
        )) {
          target.disabled = false;
          return;
        }
        await client.deleteEvaluationSample(sampleId);
        await loadEvaluationSamples();
      } else if (action === 'export') {
        const blob = await client.exportEvaluationSample(sampleId);
        const url = URL.createObjectURL(blob);
        const link = documentObject.createElement('a');
        link.href = url;
        link.download = `bask-voice-sample-${sampleId}.zip`;
        link.click();
        documentObject.defaultView.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (error) {
      evaluationStatus.textContent = error.message || `Could not ${action} sample.`;
      evaluationStatus.className = 'message voice-status error';
      target.disabled = false;
    }
  }

  connectButton.addEventListener('click', connect);
  warmupButton.addEventListener('click', warmup);
  startButton.addEventListener('click', startRecording);
  stopButton.addEventListener('click', stopRecording);
  cancelButton.addEventListener('click', cancelProcessing);
  retryButton.addEventListener('click', processAudio);
  confirmButton.addEventListener('click', confirmProposalEvents);
  undoBatchButton.addEventListener('click', undoCommittedBatch);
  discardButton.addEventListener('click', discard);
  replaceTimestampButton.addEventListener('click', replaceTimestamp);
  saveEvaluationButton.addEventListener('click', saveEvaluationSample);
  refreshEvaluationsButton.addEventListener('click', loadEvaluationSamples);
  refreshMicrophonesButton.addEventListener('click', refreshMicrophones);
  microphoneSelect.addEventListener('change', () => {
    if (microphoneSelect.value) {
      localStorageObject.setItem(MICROPHONE_STORAGE_KEY, microphoneSelect.value);
    } else {
      localStorageObject.removeItem(MICROPHONE_STORAGE_KEY);
    }
    updateAudioSummary();
  });
  audioProcessingSelect.addEventListener('change', () => {
    localStorageObject.setItem(
      AUDIO_PROCESSING_STORAGE_KEY,
      audioProcessingSelect.value
    );
    updateAudioSummary();
  });
  channelPreferenceSelect.addEventListener('change', () => {
    localStorageObject.setItem(
      CHANNEL_PREFERENCE_STORAGE_KEY,
      channelPreferenceSelect.value
    );
    updateAudioSummary();
  });
  pauseVideoInput.addEventListener('change', () => {
    localStorageObject.setItem(
      PAUSE_VIDEO_STORAGE_KEY,
      String(pauseVideoInput.checked)
    );
    updateAudioSummary();
  });
  openAudioSettingsButton.addEventListener('click', () => {
    refreshMicrophones();
    audioSettingsDialog.showModal();
  });
  closeAudioSettingsButton.addEventListener('click', () => {
    audioSettingsDialog.close();
  });
  audioSettingsDialog.addEventListener('close', stopChannelPreview);
  toggleChannelTestButton.addEventListener('click', toggleChannelPreview);
  expectedTranscript.addEventListener('input', refresh);
  evaluationList.addEventListener('click', event => {
    handleEvaluationAction(event.target);
  });
  proposal.addEventListener('change', event => updateProposalEvent(event.target));
  proposal.addEventListener('click', event => {
    if (event.target.dataset.voiceAction === 'remove') {
      updateProposalEvent(event.target);
    }
  });
  const unsubscribeReady = videoController.subscribeReady(refresh);

  discard();
  updateAudioSummary();
  refreshMicrophones();
  if (tokenInput.value) connect();

  return {
    refresh,
    getState() {
      return {
        state,
        connected,
        capturedSeconds,
        transcript: transcript.value,
        events: structuredClone(proposalEvents),
        committedBatch: committedBatch ? structuredClone(committedBatch) : null
      };
    },
    destroy() {
      destroyed = true;
      operationVersion += 1;
      unsubscribeReady();
      stopTracks();
      stopChannelPreview();
      clearAudioPreview();
      if (recorder?.state === 'recording') recorder.stop();
    }
  };
}
