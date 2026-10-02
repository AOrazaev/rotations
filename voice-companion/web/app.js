const tokenInput = document.querySelector('#token');
const connectionResult = document.querySelector('#connectionResult');
const requestResult = document.querySelector('#requestResult');
const videoSeconds = document.querySelector('#videoSeconds');
const rosterInput = document.querySelector('#roster');
const startRecording = document.querySelector('#startRecording');
const stopRecording = document.querySelector('#stopRecording');
const processRecording = document.querySelector('#processRecording');
const discardRecording = document.querySelector('#discardRecording');
const recordingStatus = document.querySelector('#recordingStatus');
const audioPreview = document.querySelector('#audioPreview');
const audioFile = document.querySelector('#audioFile');
const serviceStatus = document.querySelector('#serviceStatus');
const protocolStatus = document.querySelector('#protocolStatus');
const transcriptionStatus = document.querySelector('#transcriptionStatus');
const interpretationStatus = document.querySelector('#interpretationStatus');
const transcriptInput = document.querySelector('#transcriptInput');
const transcriptFixture = document.querySelector('#transcriptFixture');
const interpretTranscript = document.querySelector('#interpretTranscript');
const proposalResult = document.querySelector('#proposalResult');
const transcriptResult = document.querySelector('#transcriptResult');
const processButtons = [...document.querySelectorAll('.process-audio')];

let recorder = null;
let stream = null;
let chunks = [];
let recordedBlob = null;
let capturedSeconds = null;
let previewUrl = null;

function headers() {
  return { 'X-Bask-Voice-Token': tokenInput.value };
}

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(`${response.status} ${payload.error?.code || 'request_failed'}: ${payload.error?.message || 'Request failed.'}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function show(element, value) {
  element.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function buildContext(seconds) {
  const roster = JSON.parse(rosterInput.value);
  return {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    capturedSeconds: seconds,
    language: 'en',
    sideHint: null,
    roster,
    currentLineupIds: roster.slice(0, 5).map(player => player.id),
    allowedEventTypes: ['shot', 'rebound', 'assist', 'steal', 'block', 'turnover', 'foul']
  };
}

function renderProposal(payload) {
  proposalResult.replaceChildren();
  if (!payload.events?.length) {
    const empty = document.createElement('div');
    empty.className = 'proposal-event';
    empty.textContent = 'No events proposed.';
    proposalResult.append(empty);
  }
  payload.events?.forEach((event, index) => {
    const item = document.createElement('div');
    item.className = 'proposal-event';
    const details = [
      `${index + 1}. ${event.side} ${event.type}`,
      event.playerId ? `player ${event.playerId}` : 'player unresolved',
      event.shotValue ? `${event.made ? 'made' : 'missed'} ${event.shotValue}` : null,
      event.reboundKind ? `${event.reboundKind} rebound` : null,
      `confidence ${Math.round(event.confidence * 100)}%`
    ].filter(Boolean);
    item.textContent = details.join(' · ');
    proposalResult.append(item);
  });
  payload.warnings?.forEach(warning => {
    const item = document.createElement('div');
    item.className = 'proposal-warning';
    item.textContent = warning;
    proposalResult.append(item);
  });
}

function showResponse(payload) {
  transcriptResult.textContent = payload.transcript || 'No transcript returned.';
  renderProposal(payload);
  show(requestResult, payload);
}

function showRequestError(error) {
  const payload = error.payload;
  if (payload?.partialResult?.transcript) {
    transcriptResult.textContent = payload.partialResult.transcript;
  }
  show(requestResult, payload || error.message);
}

document.querySelector('#checkConnection').addEventListener('click', async () => {
  show(connectionResult, 'Checking...');
  serviceStatus.textContent = 'Checking';
  try {
    const [health, capabilities] = await Promise.all([
      fetch('/v1/health', { headers: headers() }).then(readJson),
      fetch('/v1/capabilities', { headers: headers() }).then(readJson)
    ]);
    if (health.protocolVersion !== 1 || capabilities.protocolVersion !== 1) {
      throw new Error(`Incompatible protocol. Workbench requires v1; service reported health v${health.protocolVersion} and capabilities v${capabilities.protocolVersion}.`);
    }
    serviceStatus.textContent = health.status;
    protocolStatus.textContent = `v${health.protocolVersion}`;
    const transcriptionModel = capabilities.transcriptionModel || 'Not configured';
    transcriptionStatus.textContent = health.transcriptionReady
      ? transcriptionModel
      : `${transcriptionModel} · ${health.transcriptionState}`;
    interpretationStatus.textContent = capabilities.eventInterpretation
      ? (capabilities.commandModel || 'Ready')
      : 'Not implemented';
    show(connectionResult, { health, capabilities });
  } catch (error) {
    serviceStatus.textContent = 'Error';
    protocolStatus.textContent = 'Unknown';
    transcriptionStatus.textContent = 'Unknown';
    interpretationStatus.textContent = 'Unknown';
    show(connectionResult, error.message);
  }
});

startRecording.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const preferredType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
    chunks = [];
    capturedSeconds = Number(videoSeconds.value);
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      recordedBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(recordedBlob);
      audioPreview.src = previewUrl;
      audioPreview.hidden = false;
      processRecording.disabled = false;
      discardRecording.disabled = false;
      recordingStatus.textContent = `Ready to process. Captured timestamp: ${capturedSeconds.toFixed(1)}s.`;
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    });
    recorder.start();
    startRecording.disabled = true;
    stopRecording.disabled = false;
    recordingStatus.textContent = `Recording. Captured timestamp: ${capturedSeconds.toFixed(1)}s.`;
  } catch (error) {
    recordingStatus.textContent = `Could not start recording: ${error.message}`;
  }
});

stopRecording.addEventListener('click', () => {
  if (recorder?.state === 'recording') recorder.stop();
  startRecording.disabled = false;
  stopRecording.disabled = true;
});

discardRecording.addEventListener('click', () => {
  recordedBlob = null;
  capturedSeconds = null;
  processRecording.disabled = true;
  discardRecording.disabled = true;
  audioPreview.hidden = true;
  audioPreview.removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  recordingStatus.textContent = 'Idle.';
});

async function processAudio(blob, seconds) {
  show(requestResult, 'Processing...');
  processButtons.forEach(button => {
    button.disabled = true;
  });
  try {
    const context = buildContext(seconds);
    const form = new FormData();
    form.append('context', new Blob([JSON.stringify(context)], { type: 'application/json' }));
    form.append('audio', blob, `voice-command.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
    const response = await fetch('/v1/voice-command', {
      method: 'POST',
      headers: headers(),
      body: form
    });
    showResponse(await readJson(response));
  } catch (error) {
    showRequestError(error);
  } finally {
    document.querySelector('#processFile').disabled = false;
    processRecording.disabled = !recordedBlob;
  }
}

processRecording.addEventListener('click', () => {
  if (recordedBlob && capturedSeconds !== null) {
    processAudio(recordedBlob, capturedSeconds);
  }
});

document.querySelector('#processFile').addEventListener('click', () => {
  const file = audioFile.files?.[0];
  if (!file) {
    show(requestResult, 'Choose an audio file first.');
    return;
  }
  processAudio(file, Number(videoSeconds.value));
});

document.querySelector('#loadFixture').addEventListener('click', () => {
  transcriptInput.value = transcriptFixture.value;
});

interpretTranscript.addEventListener('click', async () => {
  show(requestResult, 'Interpreting...');
  interpretTranscript.disabled = true;
  try {
    const response = await fetch('/v1/interpret-command', {
      method: 'POST',
      headers: {
        ...headers(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transcript: transcriptInput.value,
        context: buildContext(Number(videoSeconds.value))
      })
    });
    showResponse(await readJson(response));
  } catch (error) {
    showRequestError(error);
  } finally {
    interpretTranscript.disabled = false;
  }
});
