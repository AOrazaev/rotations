import {
  createYouTubePlayer,
  formatVideoTime,
  parseYouTubeVideoId
} from './youtube-player.js';

const PREVIEW_SECONDS = 3;

export function createStatsSpikeApp({
  documentObject = document,
  playerFactory = createYouTubePlayer,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  const videoForm = documentObject.querySelector('#videoForm');
  const videoUrl = documentObject.querySelector('#videoUrl');
  const loadVideoButton = documentObject.querySelector('#loadVideo');
  const videoError = documentObject.querySelector('#videoError');
  const videoStatus = documentObject.querySelector('#videoStatus');
  const workspace = documentObject.querySelector('#workspace');
  const playerFrame = documentObject.querySelector('#playerFrame');
  const currentTime = documentObject.querySelector('#currentTime');
  const playButton = documentObject.querySelector('#playVideo');
  const pauseButton = documentObject.querySelector('#pauseVideo');
  const captureButton = documentObject.querySelector('#captureMarker');
  const markerList = documentObject.querySelector('#markerList');
  const emptyMarkers = documentObject.querySelector('#emptyMarkers');
  const markerTemplate = documentObject.querySelector('#markerTemplate');

  let player = null;
  let timer = null;
  let nextSequence = 1;
  let markers = [];

  function setError(message = '') {
    videoError.textContent = message;
    videoError.classList.toggle('hidden', !message);
  }

  function refreshCurrentTime() {
    if (!player) return;
    currentTime.textContent = formatVideoTime(player.getCurrentSeconds());
  }

  function startClock() {
    if (timer) clearIntervalFn(timer);
    refreshCurrentTime();
    timer = setIntervalFn(refreshCurrentTime, 250);
  }

  function renderMarkers() {
    markerList.innerHTML = '';
    emptyMarkers.classList.toggle('hidden', markers.length > 0);
    for (const marker of markers) {
      const node = markerTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.markerId = marker.id;
      node.querySelector('.marker-name').textContent = `Marker ${marker.sequence}`;
      node.querySelector('.marker-time').textContent = formatVideoTime(marker.videoSeconds);
      markerList.appendChild(node);
    }
  }

  function captureMarker() {
    if (!player) return;
    markers.push({
      id: crypto.randomUUID(),
      sequence: nextSequence++,
      videoSeconds: player.getCurrentSeconds()
    });
    renderMarkers();
  }

  function createPlayerMount() {
    const element = documentObject.createElement('div');
    element.id = 'youtubePlayer';
    playerFrame.replaceChildren(element);
    return element;
  }

  async function loadVideo() {
    setError();
    let videoId;
    try {
      videoId = parseYouTubeVideoId(videoUrl.value);
    } catch (error) {
      setError(error.message);
      return;
    }

    loadVideoButton.disabled = true;
    videoStatus.textContent = 'Loading YouTube player…';
    if (timer) clearIntervalFn(timer);
    if (player?.destroy) player.destroy();
    player = null;
    const playerElement = createPlayerMount();
    workspace.classList.add('hidden');

    try {
      player = await playerFactory(playerElement, videoId, {
        onError(error) {
          setError(error.message);
          videoStatus.textContent = 'Video cannot be played.';
        }
      });
      markers = [];
      nextSequence = 1;
      renderMarkers();
      workspace.classList.remove('hidden');
      videoStatus.textContent = `Video ${videoId} is ready.`;
      startClock();
    } catch (error) {
      setError(error.message || 'Could not load the YouTube video.');
      videoStatus.textContent = 'Video failed to load.';
    } finally {
      loadVideoButton.disabled = false;
    }
  }

  videoForm.addEventListener('submit', event => {
    event.preventDefault();
    loadVideo();
  });
  playButton.addEventListener('click', () => player?.play());
  pauseButton.addEventListener('click', () => player?.pause());
  captureButton.addEventListener('click', captureMarker);

  markerList.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    const markerNode = event.target.closest('[data-marker-id]');
    if (!button || !markerNode || !player) return;
    const marker = markers.find(item => item.id === markerNode.dataset.markerId);
    if (!marker) return;

    const action = button.dataset.action;
    if (action === 'seek') {
      player.seekTo(marker.videoSeconds);
    } else if (action === 'preview') {
      player.seekTo(Math.max(0, marker.videoSeconds - PREVIEW_SECONDS));
      player.play();
    } else if (action === 'adjust') {
      marker.videoSeconds = Math.max(0, marker.videoSeconds + Number(button.dataset.delta));
      renderMarkers();
    } else if (action === 'use-current') {
      marker.videoSeconds = player.getCurrentSeconds();
      renderMarkers();
    } else if (action === 'delete') {
      markers = markers.filter(item => item.id !== marker.id);
      renderMarkers();
    }
  });

  renderMarkers();

  return {
    getMarkers: () => markers.map(marker => ({ ...marker })),
    loadVideo,
    destroy() {
      if (timer) clearIntervalFn(timer);
      if (player?.destroy) player.destroy();
    }
  };
}

const playerFactory = window.__STATS_PLAYER_FACTORY__ || createYouTubePlayer;
createStatsSpikeApp({ playerFactory });
