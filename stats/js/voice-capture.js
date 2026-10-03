import { formatVideoTime } from './youtube-player.js';
import {
  buildVoiceCommandContext,
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
  onCommandsChanged = () => {},
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
  const diagnostics = documentObject.querySelector('#voiceDiagnostics');
  const settingsDialog = documentObject.querySelector('#voiceSettingsDialog');
  const openSettingsButton = documentObject.querySelector('#voiceOpenSettings');
  const closeSettingsButton = documentObject.querySelector('#voiceCloseSettings');
  const recordButton = documentObject.querySelector('#voiceRecordToggle');
  const recordLabel = documentObject.querySelector('#voiceRecordLabel');
  const readiness = documentObject.querySelector('#voiceReadiness');
  const commandStatus = documentObject.querySelector('#voiceCommandStatus');
  const undoLatestBatchButton = documentObject.querySelector('#voiceUndoLatestBatch');
  const microphoneSelect = documentObject.querySelector('#voiceMicrophone');
  const audioProcessingSelect = documentObject.querySelector('#voiceAudioProcessing');
  const channelPreferenceSelect = documentObject.querySelector('#voiceChannelPreference');
  const refreshMicrophonesButton = documentObject.querySelector('#voiceRefreshMicrophones');
  const pauseVideoInput = documentObject.querySelector('#voicePauseVideoDuringRecording');
  const audioSummary = documentObject.querySelector('#voiceAudioSummary');
  const toggleChannelTestButton = documentObject.querySelector('#voiceToggleChannelTest');
  const leftChannelLevel = documentObject.querySelector('#voiceLeftChannelLevel');
  const rightChannelLevel = documentObject.querySelector('#voiceRightChannelLevel');
  const channelStatus = documentObject.querySelector('#voiceChannelStatus');
  const evaluationStatus = documentObject.querySelector('#voiceEvaluationStatus');
  const refreshEvaluationsButton = documentObject.querySelector('#voiceRefreshEvaluations');
  const evaluationList = documentObject.querySelector('#voiceEvaluationList');
  const eventList = documentObject.querySelector('#eventList');

  let client = null;
  let connected = false;
  let warming = false;
  let destroyed = false;
  let recorder = null;
  let stream = null;
  let chunks = [];
  let recording = null;
  let recordingStartedAt = 0;
  let recordingTimer = null;
  let discardingRecording = false;
  let resumePlaybackAfterRecording = false;
  let channelPreviewStream = null;
  let channelPreviewContext = null;
  let channelPreviewFrame = null;
  let jobs = [];
  let nextJobOrder = 1;
  let processingJobId = null;
  let lastCommittedBatch = null;
  let statusNotice = null;
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

  function setCommandStatus(message, kind = '') {
    commandStatus.textContent = message;
    commandStatus.className = `message voice-command-status voice-status ${kind}`.trim();
  }

  function setStatusNotice(message, kind = '') {
    statusNotice = { message, kind };
    setCommandStatus(message, kind);
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

  function activeJob() {
    return jobs.find(job => job.id === processingJobId) || null;
  }

  function commandView(job) {
    return {
      id: job.id,
      order: job.order,
      state: job.state,
      capturedSeconds: job.capturedSeconds,
      transcript: job.transcript || '',
      expectedTranscript: job.expectedTranscript || '',
      events: structuredClone(job.events || []),
      warnings: [...(job.warnings || [])],
      errorMessage: job.errorMessage || '',
      audioUrl: job.audioUrl || '',
      diagnostics: job.response
        ? `${job.response.processor?.transcriptionModel || 'transcription'} + ${job.response.processor?.commandModel || 'command model'} · ${job.response.timingMs?.total ?? 0} ms`
        : '',
      canSaveEvaluation: Boolean(
        client
        && job.audio
        && job.context
        && job.transcript
        && job.expectedTranscript
      ),
      evaluationStatus: job.evaluationStatus || '',
      evaluationStatusKind: job.evaluationStatusKind || ''
    };
  }

  function publishJobs() {
    onCommandsChanged(jobs.map(commandView));
  }

  function revokeJobAudio(job) {
    if (!job.audioUrl) return;
    URL.revokeObjectURL(job.audioUrl);
    job.audioUrl = '';
  }

  function removeJob(job) {
    revokeJobAudio(job);
    jobs = jobs.filter(item => item.id !== job.id);
    if (processingJobId === job.id) processingJobId = null;
    publishJobs();
  }

  function clearJobs() {
    jobs.forEach(revokeJobAudio);
    jobs = [];
    processingJobId = null;
    publishJobs();
  }

  function syncCommittedBatch() {
    if (!lastCommittedBatch) return;
    const game = getGame();
    const batchIds = new Set(lastCommittedBatch.eventIds);
    const present = game?.events.filter(event => batchIds.has(event.id)) || [];
    if (!game || game.id !== lastCommittedBatch.gameId || !present.length) {
      lastCommittedBatch = null;
      undoLatestBatchButton.classList.add('hidden');
      return;
    }
    const ordered = [...game.events].sort((a, b) => a.sequence - b.sequence);
    const latestIds = ordered
      .slice(-lastCommittedBatch.eventIds.length)
      .map(event => event.id);
    const undoAvailable = latestIds.every(
      (eventId, index) => eventId === lastCommittedBatch.eventIds[index]
    );
    undoLatestBatchButton.disabled = !undoAvailable;
    undoLatestBatchButton.classList.toggle('hidden', !undoAvailable);
  }

  function recordingDurationLabel() {
    const elapsed = Math.max(0, Date.now() - recordingStartedAt);
    const seconds = Math.floor(elapsed / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function refreshCompactControls() {
    if (destroyed) return;
    const currentGameId = getGame()?.id || null;
    if (currentGameId !== observedGameId) {
      observedGameId = currentGameId;
      if (recording) discardActiveRecording();
      if (processingJobId && client) client.cancel(activeJob()?.requestId).catch(() => {});
      clearJobs();
      lastCommittedBatch = null;
      undoLatestBatchButton.classList.add('hidden');
      setCommandStatus(
        currentGameId
          ? 'Game changed. Voice commands from the previous game were cleared.'
          : 'Open a game with a ready video to use voice entry.'
      );
    }
    syncCommittedBatch();

    const available = hasGameAndVideo()
      && mediaDevices?.getUserMedia
      && MediaRecorderClass;
    recordButton.disabled = !available;
    recordButton.classList.toggle('recording', Boolean(recording));
    recordButton.setAttribute(
      'aria-label',
      recording ? 'Stop voice recording' : 'Start voice recording'
    );
    recordButton.title = recording ? 'Stop voice recording' : 'Start voice recording';

    if (recording) {
      readiness.className = 'voice-readiness recording';
      recordLabel.textContent = `Stop ${recordingDurationLabel()}`;
      setCommandStatus(
        `Recording at ${formatVideoTime(recording.capturedSeconds)}. Click again to stop.`,
        'recording'
      );
    } else {
      recordLabel.textContent = 'Voice';
      readiness.className = `voice-readiness ${
        connected ? 'ready' : warming ? 'loading' : 'error'
      }`;
      const queued = jobs.filter(job => job.state === 'queued').length;
      const processing = jobs.filter(job => ['processing', 'cancelling'].includes(job.state)).length;
      const drafts = jobs.filter(job => job.state === 'draft').length;
      if (queued || processing || drafts) {
        const parts = [];
        if (processing) parts.push(`${processing} processing`);
        if (queued) parts.push(`${queued} queued`);
        if (drafts) parts.push(`${drafts} ready`);
        setCommandStatus(parts.join(' · '), drafts ? 'ready' : 'loading');
      } else if (!available) {
        setCommandStatus('Open a game with a ready video to use voice entry.');
      } else if (!connected) {
        setCommandStatus('Voice companion is unavailable. Click Voice or settings to connect.', 'error');
      } else if (statusNotice) {
        setCommandStatus(statusNotice.message, statusNotice.kind);
      } else {
        setCommandStatus('Voice companion ready.');
      }
    }

    connectButton.disabled = warming;
    warmupButton.disabled = !connected || warming;
    refreshEvaluationsButton.disabled = !client;
  }

  function audioConstraints({ stereoPreview = false } = {}) {
    const selectedDeviceId = microphoneSelect.value;
    const processedAudio = audioProcessingSelect.value === 'processed';
    return {
      ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
      channelCount: stereoPreview ? 2 : 1,
      echoCancellation: processedAudio,
      noiseSuppression: processedAudio,
      autoGainControl: processedAudio
    };
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
      microphoneSelect.replaceChildren();
      const defaultOption = documentObject.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'System default microphone';
      defaultOption.selected = !selected;
      microphoneSelect.append(defaultOption);
      devices.forEach((device, index) => {
        const option = documentObject.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Microphone ${index + 1}`;
        option.selected = device.deviceId === selected;
        microphoneSelect.append(option);
      });
      updateAudioSummary();
    } catch (error) {
      setConnectionStatus(
        `Could not list microphones: ${error.message || 'device enumeration failed'}`,
        'error'
      );
    }
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
      const source = channelPreviewContext.createMediaStreamSource(channelPreviewStream);
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

  async function connect({ openOnFailure = false } = {}) {
    setConnectionStatus('Checking companion...', 'loading');
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
      diagnostics.textContent = `Protocol v${capabilities.protocolVersion} · service ${health.status} · loopback ${capabilities.security?.loopbackOnly === false ? 'not enforced' : 'only'} · origin validation ${capabilities.security?.originValidation === false ? 'off' : 'on'}`;
      await loadEvaluationSamples();
      pumpQueue();
    } catch (error) {
      client = null;
      connected = false;
      setConnectionStatus(error.message || 'Could not connect.', 'error');
      diagnostics.textContent = 'Service diagnostics unavailable.';
      if (openOnFailure && !settingsDialog.open) settingsDialog.showModal();
    } finally {
      refreshCompactControls();
    }
  }

  async function warmup() {
    if (!client || warming) return;
    warming = true;
    setConnectionStatus('Warming companion models...', 'loading');
    refreshCompactControls();
    try {
      const result = await client.warmup();
      setConnectionStatus(`Models ready in ${result.timingMs?.total ?? 0} ms.`, 'ready');
    } catch (error) {
      setConnectionStatus(error.message || 'Model warmup failed.', 'error');
    } finally {
      warming = false;
      refreshCompactControls();
      pumpQueue();
    }
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

  function stopRecordingTimer() {
    if (recordingTimer !== null) {
      documentObject.defaultView.clearInterval(recordingTimer);
      recordingTimer = null;
    }
  }

  function discardActiveRecording() {
    if (recorder?.state === 'recording') {
      discardingRecording = true;
      recorder.stop();
    }
    stopRecordingTimer();
    stopTracks();
    resumeVideoPlayback();
    recorder = null;
    recording = null;
    chunks = [];
    refreshCompactControls();
  }

  function enqueueRecording(audio, mimeType) {
    const job = {
      ...recording,
      state: 'queued',
      audio,
      audioUrl: URL.createObjectURL(audio),
      mimeType,
      requestId: null,
      context: null,
      response: null,
      transcript: '',
      expectedTranscript: '',
      events: [],
      warnings: [],
      errorMessage: '',
      evaluationStatus: '',
      evaluationStatusKind: ''
    };
    jobs.push(job);
    recording = null;
    publishJobs();
    refreshCompactControls();
    pumpQueue();
  }

  async function startRecording() {
    if (recording) {
      stopRecording();
      return;
    }
    if (!connected) {
      await connect({ openOnFailure: true });
      if (!connected) return;
    }
    if (!hasGameAndVideo()) return;
    if (!mediaDevices?.getUserMedia || !MediaRecorderClass) {
      setCommandStatus('Microphone recording is unavailable in this browser.', 'error');
      return;
    }

    statusNotice = null;
    const game = getGame();
    chunks = [];
    try {
      await stopChannelPreview();
      stream = await mediaDevices.getUserMedia({ audio: audioConstraints() });
      await refreshMicrophones();
      const capturedSeconds = videoController.getCurrentSeconds();
      resumePlaybackAfterRecording = pauseVideoInput.checked && videoController.isPlaying();
      if (resumePlaybackAfterRecording) videoController.pause();
      const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        .find(type => !MediaRecorderClass.isTypeSupported
          || MediaRecorderClass.isTypeSupported(type));
      recorder = new MediaRecorderClass(stream, {
        ...(preferredType ? { mimeType: preferredType } : {}),
        audioBitsPerSecond: 128000
      });
      recording = {
        id: crypto.randomUUID(),
        order: nextJobOrder++,
        gameId: game.id,
        gameSnapshot: structuredClone(game),
        capturedSeconds
      };
      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        if (destroyed) return;
        stopRecordingTimer();
        if (discardingRecording) {
          discardingRecording = false;
          stopTracks();
          recorder = null;
          recording = null;
          resumeVideoPlayback();
          refreshCompactControls();
          return;
        }
        const mimeType = recorder.mimeType || 'audio/webm';
        const audio = new Blob(chunks, { type: mimeType });
        stopTracks();
        recorder = null;
        resumeVideoPlayback();
        enqueueRecording(audio, mimeType);
      });
      recorder.start();
      recordingStartedAt = Date.now();
      recordingTimer = documentObject.defaultView.setInterval(refreshCompactControls, 250);
      refreshCompactControls();
    } catch (error) {
      stopTracks();
      recorder = null;
      recording = null;
      resumeVideoPlayback();
      setCommandStatus(
        `Could not start recording: ${error.message || 'microphone unavailable'}`,
        'error'
      );
      refreshCompactControls();
    }
  }

  function stopRecording() {
    if (recorder?.state !== 'recording') return;
    recordButton.disabled = true;
    recordLabel.textContent = 'Finishing...';
    stopRecordingTimer();
    recorder.stop();
  }

  function pumpQueue() {
    if (destroyed || processingJobId || !client || warming) return;
    const job = jobs.find(item => item.state === 'queued');
    if (!job) {
      refreshCompactControls();
      return;
    }
    processJob(job);
  }

  async function processJob(job) {
    const requestId = crypto.randomUUID();
    job.requestId = requestId;
    job.state = 'processing';
    job.errorMessage = '';
    processingJobId = job.id;
    publishJobs();
    refreshCompactControls();
    try {
      const context = buildVoiceCommandContext(
        job.gameSnapshot,
        job.capturedSeconds,
        requestId,
        channelPreferenceSelect.value
      );
      job.context = structuredClone(context);
      const payload = await client.voiceCommand({ audio: job.audio, context });
      if (destroyed || !jobs.includes(job)) return;
      job.response = validateVoiceCommandResponse(payload, {
        requestId,
        game: job.gameSnapshot
      });
      job.transcript = job.response.transcript;
      job.expectedTranscript = job.response.transcript;
      job.events = structuredClone(job.response.events);
      job.warnings = [...job.response.warnings];
      job.state = 'draft';
    } catch (error) {
      if (destroyed || !jobs.includes(job)) return;
      if (error.partialResult?.transcript) {
        job.transcript = error.partialResult.transcript;
        job.expectedTranscript = error.partialResult.transcript;
      }
      job.state = 'error';
      job.errorMessage = error.code === 'request_cancelled'
        ? 'Processing cancelled.'
        : (error.message || 'Voice processing failed.');
    } finally {
      if (processingJobId === job.id) processingJobId = null;
      job.requestId = null;
      publishJobs();
      refreshCompactControls();
      pumpQueue();
    }
  }

  async function cancelJob(job) {
    if (job.state !== 'processing' || !client || !job.requestId) return;
    job.state = 'cancelling';
    publishJobs();
    refreshCompactControls();
    try {
      await client.cancel(job.requestId);
    } catch (error) {
      job.state = 'processing';
      job.errorMessage = error.message || 'Could not cancel processing.';
      publishJobs();
    }
  }

  function retryJob(job) {
    if (!['draft', 'error'].includes(job.state)) return;
    const game = getGame();
    if (!game || game.id !== job.gameId) {
      job.state = 'error';
      job.errorMessage = 'This voice command belongs to a different game.';
      publishJobs();
      return;
    }
    job.gameSnapshot = structuredClone(game);
    job.context = null;
    job.response = null;
    job.events = [];
    job.warnings = [];
    job.errorMessage = '';
    job.state = 'queued';
    publishJobs();
    refreshCompactControls();
    pumpQueue();
  }

  async function confirmJob(job) {
    if (job.state !== 'draft' || !job.events.length || !job.context) return;
    job.state = 'committing';
    job.errorMessage = '';
    publishJobs();
    refreshCompactControls();
    try {
      const batch = await commitProposal({
        expectedGameId: job.gameId,
        expectedLineupIds: [...job.context.currentLineupIds],
        capturedSeconds: job.capturedSeconds,
        events: structuredClone(job.events)
      });
      lastCommittedBatch = {
        gameId: batch.gameId,
        eventIds: [...batch.eventIds]
      };
      removeJob(job);
      undoLatestBatchButton.disabled = false;
      undoLatestBatchButton.classList.remove('hidden');
      setStatusNotice(
        `${batch.eventIds.length} voice event${batch.eventIds.length === 1 ? '' : 's'} added.`,
        'ready'
      );
    } catch (error) {
      job.state = 'draft';
      job.errorMessage = error.message || 'Could not add the voice events.';
      publishJobs();
      setStatusNotice(job.errorMessage, 'error');
    } finally {
      refreshCompactControls();
    }
  }

  async function undoLatestBatch() {
    if (!lastCommittedBatch || undoLatestBatchButton.disabled) return;
    undoLatestBatchButton.disabled = true;
    try {
      await undoProposal({
        expectedGameId: lastCommittedBatch.gameId,
        eventIds: [...lastCommittedBatch.eventIds]
      });
      lastCommittedBatch = null;
      undoLatestBatchButton.classList.add('hidden');
      setStatusNotice('Voice batch undone.', 'ready');
    } catch (error) {
      setStatusNotice(error.message || 'Could not undo the voice batch.', 'error');
    } finally {
      refreshCompactControls();
    }
  }

  function updateJobEvent(job, eventIndex, field, value) {
    const event = job.events[eventIndex];
    if (!event || job.state !== 'draft') return;
    if (field === 'side') {
      event.side = value;
      if (value === 'opponent') event.playerId = null;
    } else if (field === 'playerId') {
      event.playerId = value || null;
    } else if (field === 'type') {
      event.type = value;
      delete event.shotValue;
      delete event.made;
      delete event.reboundKind;
      delete event.shotDetails;
      if (value === 'shot') {
        event.shotValue = 2;
        event.made = true;
      } else if (value === 'rebound') {
        event.reboundKind = 'defensive';
      }
    } else if (field === 'shotValue') {
      event.shotValue = Number(value);
    } else if (field === 'made') {
      event.made = value === 'true';
    } else if (field === 'reboundKind') {
      event.reboundKind = value;
    }
    publishJobs();
  }

  function replaceJobTimestamp(job) {
    const game = getGame();
    if (!game || game.id !== job.gameId || !videoController.isReady()) return;
    job.capturedSeconds = videoController.getCurrentSeconds();
    job.gameSnapshot = structuredClone(game);
    job.context = buildVoiceCommandContext(
      game,
      job.capturedSeconds,
      job.context?.requestId || crypto.randomUUID(),
      channelPreferenceSelect.value
    );
    publishJobs();
  }

  function evaluationOutcome(job) {
    if (!job.response) return 'corrected_after_processing_error';
    const transcriptChanged = job.expectedTranscript.trim() !== job.response.transcript.trim();
    const eventsChanged = JSON.stringify(job.events) !== JSON.stringify(job.response.events);
    return transcriptChanged || eventsChanged ? 'corrected' : 'accepted';
  }

  async function saveEvaluationSample(job) {
    if (!client || !job.audio || !job.context || !job.expectedTranscript.trim()) return;
    job.evaluationStatus = 'Saving audio and evaluation metadata locally...';
    job.evaluationStatusKind = 'loading';
    publishJobs();
    try {
      const result = await client.saveEvaluationSample({
        audio: job.audio,
        metadata: {
          capturedSeconds: job.capturedSeconds,
          context: job.context,
          originalTranscript: job.transcript,
          originalEvents: structuredClone(job.response?.events || []),
          correctedTranscript: job.expectedTranscript.trim(),
          correctedEvents: structuredClone(job.events),
          warnings: structuredClone(job.response?.warnings || []),
          processor: structuredClone(job.response?.processor || {}),
          timingMs: structuredClone(job.response?.timingMs || {}),
          outcome: evaluationOutcome(job)
        }
      });
      job.evaluationStatus = `Saved evaluation sample ${result.sample.sampleId}.`;
      job.evaluationStatusKind = 'ready';
      await loadEvaluationSamples();
    } catch (error) {
      job.evaluationStatus = error.message || 'Could not save evaluation sample.';
      job.evaluationStatusKind = 'error';
    } finally {
      publishJobs();
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

  recordButton.addEventListener('click', startRecording);
  openSettingsButton.addEventListener('click', () => {
    refreshMicrophones();
    loadEvaluationSamples();
    settingsDialog.showModal();
  });
  closeSettingsButton.addEventListener('click', () => settingsDialog.close());
  settingsDialog.addEventListener('close', stopChannelPreview);
  connectButton.addEventListener('click', () => connect());
  warmupButton.addEventListener('click', warmup);
  undoLatestBatchButton.addEventListener('click', undoLatestBatch);
  refreshEvaluationsButton.addEventListener('click', loadEvaluationSamples);
  refreshMicrophonesButton.addEventListener('click', refreshMicrophones);
  toggleChannelTestButton.addEventListener('click', toggleChannelPreview);
  microphoneSelect.addEventListener('change', () => {
    if (microphoneSelect.value) {
      localStorageObject.setItem(MICROPHONE_STORAGE_KEY, microphoneSelect.value);
    } else {
      localStorageObject.removeItem(MICROPHONE_STORAGE_KEY);
    }
    updateAudioSummary();
  });
  audioProcessingSelect.addEventListener('change', () => {
    localStorageObject.setItem(AUDIO_PROCESSING_STORAGE_KEY, audioProcessingSelect.value);
    updateAudioSummary();
  });
  channelPreferenceSelect.addEventListener('change', () => {
    localStorageObject.setItem(CHANNEL_PREFERENCE_STORAGE_KEY, channelPreferenceSelect.value);
    updateAudioSummary();
  });
  pauseVideoInput.addEventListener('change', () => {
    localStorageObject.setItem(PAUSE_VIDEO_STORAGE_KEY, String(pauseVideoInput.checked));
    updateAudioSummary();
  });
  evaluationList.addEventListener('click', event => handleEvaluationAction(event.target));
  eventList.addEventListener('click', event => {
    const row = event.target.closest('[data-voice-command-id]');
    const action = event.target.closest('[data-voice-action]')?.dataset.voiceAction;
    if (!row || !action) return;
    const job = jobs.find(item => item.id === row.dataset.voiceCommandId);
    if (!job) return;
    if (action === 'discard') removeJob(job);
    else if (action === 'cancel') cancelJob(job);
    else if (action === 'retry') retryJob(job);
    else if (action === 'confirm') confirmJob(job);
    else if (action === 'replace-timestamp') replaceJobTimestamp(job);
    else if (action === 'save-evaluation') saveEvaluationSample(job);
    else if (action === 'remove-event') {
      const eventIndex = Number(event.target.closest('[data-voice-event-index]')?.dataset.voiceEventIndex);
      if (Number.isInteger(eventIndex)) {
        job.events.splice(eventIndex, 1);
        publishJobs();
      }
    }
  });
  eventList.addEventListener('change', event => {
    const row = event.target.closest('[data-voice-command-id]');
    const field = event.target.dataset.voiceField;
    if (!row || !field || field === 'expectedTranscript') return;
    const eventIndex = Number(
      event.target.closest('[data-voice-event-index]')?.dataset.voiceEventIndex
    );
    const job = jobs.find(item => item.id === row.dataset.voiceCommandId);
    if (job && Number.isInteger(eventIndex)) {
      updateJobEvent(job, eventIndex, field, event.target.value);
    }
  });
  eventList.addEventListener('input', event => {
    if (event.target.dataset.voiceField !== 'expectedTranscript') return;
    const row = event.target.closest('[data-voice-command-id]');
    const job = jobs.find(item => item.id === row?.dataset.voiceCommandId);
    if (job) job.expectedTranscript = event.target.value;
  });

  const unsubscribeReady = videoController.subscribeReady(refreshCompactControls);
  updateAudioSummary();
  refreshMicrophones();
  publishJobs();
  refreshCompactControls();
  connect();

  return {
    refresh: refreshCompactControls,
    getState() {
      return {
        connected,
        recording: Boolean(recording),
        processingJobId,
        jobs: jobs.map(commandView)
      };
    },
    destroy() {
      destroyed = true;
      unsubscribeReady();
      stopRecordingTimer();
      if (processingJobId && client) client.cancel(activeJob()?.requestId).catch(() => {});
      if (recorder?.state === 'recording') {
        discardingRecording = true;
        recorder.stop();
      }
      stopTracks();
      stopChannelPreview();
      clearJobs();
    }
  };
}
