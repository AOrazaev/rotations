import {
  createYouTubePlayer,
  formatVideoTime,
  parseYouTubeVideoId
} from './youtube-player.js';
import { GameStore } from './game-store.js';
import { createGameSetupController } from './game-setup.js';
import { createEventEntryController } from './event-entry.js';

export function createStatsSpikeApp({
  documentObject = document,
  playerFactory = createYouTubePlayer,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
} = {}) {
  const videoError = documentObject.querySelector('#videoError');
  const videoStatus = documentObject.querySelector('#videoStatus');
  const retryVideoButton = documentObject.querySelector('#retryVideo');
  const workspace = documentObject.querySelector('#workspace');
  const playerFrame = documentObject.querySelector('#playerFrame');
  const currentTime = documentObject.querySelector('#currentTime');
  const playButton = documentObject.querySelector('#playVideo');
  const pauseButton = documentObject.querySelector('#pauseVideo');

  let player = null;
  let timer = null;
  let sourceUrl = '';
  let loadSequence = 0;
  const readyListeners = new Set();

  function notifyReady() {
    readyListeners.forEach(listener => listener(!!player));
  }

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

  function createPlayerMount() {
    const element = documentObject.createElement('div');
    element.id = 'youtubePlayer';
    playerFrame.replaceChildren(element);
    return element;
  }

  async function loadVideo(nextSourceUrl) {
    sourceUrl = String(nextSourceUrl || sourceUrl).trim();
    const sequence = ++loadSequence;
    setError();
    retryVideoButton.classList.add('hidden');
    let videoId;
    try {
      videoId = parseYouTubeVideoId(sourceUrl);
    } catch (error) {
      if (timer) clearIntervalFn(timer);
      if (player?.destroy) player.destroy();
      player = null;
      notifyReady();
      workspace.classList.remove('hidden');
      setError(error.message);
      videoStatus.textContent = 'Video failed to load.';
      retryVideoButton.classList.remove('hidden');
      return;
    }

    videoStatus.textContent = 'Loading YouTube player…';
    if (timer) clearIntervalFn(timer);
    if (player?.destroy) player.destroy();
    player = null;
    notifyReady();
    const playerElement = createPlayerMount();
    workspace.classList.remove('hidden');

    try {
      const nextPlayer = await playerFactory(playerElement, videoId, {
        onError(error) {
          if (sequence !== loadSequence) return;
          setError(error.message);
          videoStatus.textContent = 'Video cannot be played.';
          retryVideoButton.classList.remove('hidden');
        }
      });
      if (sequence !== loadSequence) {
        nextPlayer?.destroy?.();
        return;
      }
      player = nextPlayer;
      workspace.classList.remove('hidden');
      videoStatus.textContent = `Video ${videoId} is ready.`;
      startClock();
      notifyReady();
    } catch (error) {
      if (sequence !== loadSequence) return;
      setError(error.message || 'Could not load the YouTube video.');
      videoStatus.textContent = 'Video failed to load.';
      retryVideoButton.classList.remove('hidden');
      workspace.classList.remove('hidden');
      notifyReady();
    }
  }

  retryVideoButton.addEventListener('click', () => loadVideo());
  playButton.addEventListener('click', () => player?.play());
  pauseButton.addEventListener('click', () => player?.pause());

  return {
    loadVideo,
    isReady: () => !!player,
    subscribeReady(listener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    getCurrentSeconds() {
      if (!player) throw new Error('The game recording is unavailable for adding events.');
      return player.getCurrentSeconds();
    },
    seekTo(seconds) {
      if (!player) throw new Error('The game recording is unavailable for seeking.');
      player.seekTo(seconds);
    },
    play() {
      if (!player) throw new Error('The game recording is unavailable for playback.');
      player.play();
    },
    destroy() {
      loadSequence += 1;
      if (timer) clearIntervalFn(timer);
      if (player?.destroy) player.destroy();
    }
  };
}

const playerFactory = window.__STATS_PLAYER_FACTORY__ || createYouTubePlayer;
const videoController = createStatsSpikeApp({ playerFactory });
const statsShell = document.querySelector('#statsShell');
const gamePanel = document.querySelector('#gamePanel');
const hideGamePanelButton = document.querySelector('#hideGamePanel');
const showGamePanelButton = document.querySelector('#showGamePanel');
const gamePanelStorageKey = 'basketball-stats-game-panel-collapsed';
const reviewShell = document.querySelector('#reviewShell');
const videoCard = document.querySelector('.video-card');
const videoSizeValue = document.querySelector('#videoSizeValue');
const decreaseVideoSizeButton = document.querySelector('#decreaseVideoSize');
const increaseVideoSizeButton = document.querySelector('#increaseVideoSize');
const resetVideoSizeButton = document.querySelector('#resetVideoSize');
const videoResizeHandle = document.querySelector('#videoResizeHandle');
const videoSizeStorageKey = 'basketball-stats-video-column-size';
let videoSize = 70;
let resizePointerId = null;

function setGamePanelCollapsed(collapsed, { moveFocus = false } = {}) {
  statsShell.classList.toggle('game-panel-collapsed', collapsed);
  gamePanel.classList.toggle('hidden', collapsed);
  showGamePanelButton.classList.toggle('hidden', !collapsed);
  hideGamePanelButton.setAttribute('aria-expanded', String(!collapsed));
  showGamePanelButton.setAttribute('aria-expanded', String(!collapsed));
  localStorage.setItem(gamePanelStorageKey, String(collapsed));
  if (moveFocus) (collapsed ? showGamePanelButton : hideGamePanelButton).focus();
}

hideGamePanelButton.addEventListener('click', () => setGamePanelCollapsed(true, { moveFocus: true }));
showGamePanelButton.addEventListener('click', () => setGamePanelCollapsed(false, { moveFocus: true }));
setGamePanelCollapsed(localStorage.getItem(gamePanelStorageKey) === 'true');

function setVideoSize(value) {
  const size = Math.min(75, Math.max(55, Number(value) || 70));
  videoSize = size;
  reviewShell.style.setProperty('--video-column-width', `${size}%`);
  videoSizeValue.value = `${size}%`;
  decreaseVideoSizeButton.disabled = size <= 55;
  increaseVideoSizeButton.disabled = size >= 75;
  resetVideoSizeButton.disabled = size === 70;
  videoResizeHandle.setAttribute('aria-valuenow', String(size));
  videoResizeHandle.setAttribute('aria-valuetext', `${size} percent`);
  localStorage.setItem(videoSizeStorageKey, String(size));
}

function resizeVideoFromPointer(clientX) {
  const reviewBox = reviewShell.getBoundingClientRect();
  if (!reviewBox.width) return;
  setVideoSize(Math.round(((clientX - reviewBox.left) / reviewBox.width) * 100));
}

decreaseVideoSizeButton.addEventListener('click', () => setVideoSize(videoSize - 5));
increaseVideoSizeButton.addEventListener('click', () => setVideoSize(videoSize + 5));
resetVideoSizeButton.addEventListener('click', () => setVideoSize(70));
videoResizeHandle.addEventListener('dblclick', () => setVideoSize(70));
videoResizeHandle.addEventListener('pointerdown', event => {
  resizePointerId = event.pointerId;
  videoResizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add('video-resizing');
  resizeVideoFromPointer(event.clientX);
});
videoResizeHandle.addEventListener('pointermove', event => {
  if (event.pointerId !== resizePointerId) return;
  resizeVideoFromPointer(event.clientX);
});
videoResizeHandle.addEventListener('pointerup', event => {
  if (event.pointerId !== resizePointerId) return;
  resizePointerId = null;
  document.body.classList.remove('video-resizing');
  videoResizeHandle.releasePointerCapture(event.pointerId);
});
videoResizeHandle.addEventListener('pointercancel', () => {
  resizePointerId = null;
  document.body.classList.remove('video-resizing');
});
videoResizeHandle.addEventListener('keydown', event => {
  const changes = {
    ArrowLeft: -5,
    ArrowDown: -5,
    ArrowRight: 5,
    ArrowUp: 5,
  };
  if (event.key === 'Home') setVideoSize(55);
  else if (event.key === 'End') setVideoSize(75);
  else if (changes[event.key]) setVideoSize(videoSize + changes[event.key]);
  else return;
  event.preventDefault();
});
setVideoSize(localStorage.getItem(videoSizeStorageKey));

const store = new GameStore({
  databaseName: window.__STATS_DATABASE_NAME__ || 'basketball-stats'
});
let setupController;
const eventController = createEventEntryController({
  store,
  videoController,
  onGameChanged: async game => {
    if (setupController) {
      setupController.syncGame(game);
      await setupController.refreshGames();
    }
  }
});
setupController = createGameSetupController({
  store,
  onGameOpened(game) {
    document.querySelector('#gameVideoUrl').value = game.video.sourceUrl;
    videoController.loadVideo(game.video.sourceUrl);
    eventController.setGame(game);
  }
});
window.__statsApp = {
  videoController,
  setupController,
  eventController,
  store,
  destroy() {
    videoController.destroy();
    eventController.destroy();
    store.close();
  }
};
