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
    throw new Error(`${response.status} ${payload.error?.code || 'request_failed'}: ${payload.error?.message || 'Request failed.'}`);
  }
  return payload;
}

function show(element, value) {
  element.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

document.querySelector('#checkConnection').addEventListener('click', async () => {
  show(connectionResult, 'Checking...');
  try {
    const [health, capabilities] = await Promise.all([
      fetch('/v1/health', { headers: headers() }).then(readJson),
      fetch('/v1/capabilities', { headers: headers() }).then(readJson)
    ]);
    show(connectionResult, { health, capabilities });
  } catch (error) {
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
  try {
    const roster = JSON.parse(rosterInput.value);
    const context = {
      protocolVersion: 1,
      requestId: crypto.randomUUID(),
      capturedSeconds: seconds,
      language: 'en',
      sideHint: null,
      roster,
      currentLineupIds: roster.slice(0, 5).map(player => player.id),
      allowedEventTypes: ['shot', 'rebound', 'assist', 'steal', 'block', 'turnover', 'foul']
    };
    const form = new FormData();
    form.append('context', new Blob([JSON.stringify(context)], { type: 'application/json' }));
    form.append('audio', blob, `voice-command.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`);
    const response = await fetch('/v1/voice-command', {
      method: 'POST',
      headers: headers(),
      body: form
    });
    show(requestResult, await readJson(response));
  } catch (error) {
    show(requestResult, error.message);
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
