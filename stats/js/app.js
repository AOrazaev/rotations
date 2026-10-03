import {
  createYouTubePlayer,
  formatVideoTime,
  parseYouTubeVideoId
} from './youtube-player.js';
import {
  GameStore,
  StoredGameCorruptionError
} from './game-store.js';
import { createGameSetupController } from './game-setup.js';
import { createEventEntryController } from './event-entry.js';
import { createReviewController } from './review-controller.js';
import { createVoiceCaptureController } from './voice-capture.js';
import { VoiceCompanionClient } from './voice-companion-client.js';
import {
  buildReviewUrl,
  buildSharedReviewUrl,
  parseStatsRoute
} from './review-route.js';
import {
  SharedGameError,
  loadSharedGame
} from './shared-game.js';

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
  let playbackActive = false;
  const readyListeners = new Set();
  const timeListeners = new Set();

  function notifyReady() {
    readyListeners.forEach(listener => listener(!!player));
  }

  function setError(message = '') {
    videoError.textContent = message;
    videoError.classList.toggle('hidden', !message);
  }

  function refreshCurrentTime() {
    if (!player) return;
    const seconds = player.getCurrentSeconds();
    currentTime.textContent = formatVideoTime(seconds);
    timeListeners.forEach(listener => listener(seconds));
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
      playbackActive = false;
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
  playButton.addEventListener('click', () => {
    player?.play();
    playbackActive = Boolean(player);
  });
  pauseButton.addEventListener('click', () => {
    player?.pause();
    playbackActive = false;
  });

  function handleSeekShortcut(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === ' ' || event.code === 'Space') {
      if (!player) return;
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      const isPlaying = typeof player.isPlaying === 'function' ? player.isPlaying() : playbackActive;
      if (isPlaying) {
        player.pause();
        playbackActive = false;
      } else {
        player.play();
        playbackActive = true;
      }
      event.preventDefault();
      return;
    }
    const adjustment = event.key === 'ArrowLeft' ? -3 : event.key === 'ArrowRight' ? 3 : 0;
    if (!adjustment || !player) return;
    player.seekTo(Math.max(0, player.getCurrentSeconds() + adjustment));
    refreshCurrentTime();
    event.preventDefault();
  }

  documentObject.addEventListener('keydown', handleSeekShortcut);

  return {
    loadVideo,
    isReady: () => !!player,
    subscribeReady(listener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    subscribeTime(listener) {
      timeListeners.add(listener);
      if (player) listener(player.getCurrentSeconds());
      return () => timeListeners.delete(listener);
    },
    isPlaying() {
      return player
        ? (typeof player.isPlaying === 'function' ? player.isPlaying() : playbackActive)
        : false;
    },
    getCurrentSeconds() {
      if (!player) throw new Error('The game recording is unavailable for adding events.');
      return player.getCurrentSeconds();
    },
    seekTo(seconds) {
      if (!player) throw new Error('The game recording is unavailable for seeking.');
      player.seekTo(seconds);
      refreshCurrentTime();
    },
    play() {
      if (!player) throw new Error('The game recording is unavailable for playback.');
      player.play();
      playbackActive = true;
    },
    destroy() {
      loadSequence += 1;
      if (timer) clearIntervalFn(timer);
      if (player?.destroy) player.destroy();
      documentObject.removeEventListener('keydown', handleSeekShortcut);
    }
  };
}

const playerFactory = window.__STATS_PLAYER_FACTORY__ || createYouTubePlayer;
const videoController = createStatsSpikeApp({ playerFactory });
const route = parseStatsRoute(location.search);
const reviewMode = ['review', 'shared'].includes(route.mode);
const sharedMode = route.mode === 'shared';
const reviewModeHeader = document.querySelector('#reviewModeHeader');
const reviewModeLabel = document.querySelector('#reviewModeLabel');
const reviewModeTitle = document.querySelector('#reviewModeTitle');
const reviewModeOpponent = document.querySelector('#reviewModeOpponent');
const reviewRouteState = document.querySelector('#reviewRouteState');
const reviewRouteTitle = document.querySelector('#reviewRouteTitle');
const reviewRouteMessage = document.querySelector('#reviewRouteMessage');
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

if (!reviewMode) {
  hideGamePanelButton.addEventListener('click', () => setGamePanelCollapsed(true, { moveFocus: true }));
  showGamePanelButton.addEventListener('click', () => setGamePanelCollapsed(false, { moveFocus: true }));
  setGamePanelCollapsed(localStorage.getItem(gamePanelStorageKey) === 'true');
}

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
let eventController;
let reviewController;
let voiceController;

function openGameWorkspace(game) {
  document.querySelector('#gameVideoUrl').value = game.video.sourceUrl;
  videoController.loadVideo(game.video.sourceUrl);
  eventController.setGame(game);
  voiceController?.refresh();
}

function removeReviewMutationSurfaces() {
  [
    '#gamePanel',
    '#showGamePanel',
    '#eventEntryPanel',
    '#voiceCapturePanel',
    '#eventEditDialog',
    '#coachCommentDialog',
    '#substitutionDialog',
    '#periodEndDialog',
    '#noteDialog'
  ].forEach(selector => document.querySelector(selector)?.remove());
}

function showReviewRouteState(title, message) {
  reviewModeHeader.classList.add('hidden');
  statsShell.classList.add('hidden');
  reviewRouteTitle.textContent = title;
  reviewRouteMessage.textContent = message;
  reviewRouteState.classList.remove('hidden');
}

function buildCurrentReviewUrl(timelineFilters = route.timelineFilters || null) {
  return sharedMode
    ? buildSharedReviewUrl(route.snapshotName, location.pathname, timelineFilters)
    : buildReviewUrl(route.gameId, location.pathname, timelineFilters);
}

function syncReviewUrl(timelineFilters) {
  const canonicalUrl = buildCurrentReviewUrl(timelineFilters);
  if (`${location.pathname}${location.search}` !== canonicalUrl) {
    history.replaceState({}, '', canonicalUrl);
  }
}

async function initializeReviewMode() {
  document.body.classList.add('review-mode');
  if (route.status === 'missing-game') {
    showReviewRouteState(
      sharedMode ? 'Select a shared game' : 'Select a game to review',
      sharedMode
        ? 'This shared review link does not identify a published game.'
        : 'This review link does not identify a saved game.'
    );
    return;
  }
  if (route.status === 'invalid-game') {
    showReviewRouteState(
      sharedMode ? 'Invalid shared review link' : 'Invalid review link',
      sharedMode
        ? 'The published game name in this shared review link is invalid.'
        : 'The game identifier in this review link is invalid.'
    );
    return;
  }

  let game;
  if (sharedMode) {
    try {
      game = await loadSharedGame(route.snapshotName);
    } catch (error) {
      if (error instanceof SharedGameError) {
        const title = error.code === 'not-found'
          ? 'Shared game not found'
          : 'Shared game cannot be reviewed';
        showReviewRouteState(title, error.message);
      } else {
        showReviewRouteState('Shared game cannot be reviewed', 'The shared game could not be loaded safely.');
      }
      return;
    }
  } else {
    try {
      game = await store.getGame(route.gameId);
    } catch (error) {
      if (error instanceof StoredGameCorruptionError) {
        showReviewRouteState('Game cannot be reviewed', 'The saved game is invalid and cannot be reviewed safely.');
      } else {
        showReviewRouteState('Local storage unavailable', error.message || 'The saved game could not be read.');
      }
      return;
    }
    if (!game) {
      showReviewRouteState('Game not found', 'This game is not available in this browser.');
      return;
    }
    if (game.archivedAt) {
      showReviewRouteState('Game is archived', `${game.title} must be restored in the normal stats workspace before reviewing it.`);
      return;
    }
  }

  const canonicalUrl = sharedMode
    ? buildSharedReviewUrl(route.snapshotName, location.pathname, route.timelineFilters)
    : buildReviewUrl(game.id, location.pathname, route.timelineFilters);
  if (`${location.pathname}${location.search}` !== canonicalUrl) {
    history.replaceState({}, '', canonicalUrl);
  }
  reviewRouteState.classList.add('hidden');
  reviewModeLabel.textContent = sharedMode ? 'Shared read-only review' : 'Read-only review';
  reviewModeTitle.textContent = game.title;
  reviewModeOpponent.textContent = game.opponentName ? `vs ${game.opponentName}` : 'No opponent';
  reviewModeHeader.classList.remove('hidden');
  statsShell.classList.remove('hidden');
  videoController.loadVideo(game.video.sourceUrl);
  reviewController.setGame(game);
}

let ready;
if (reviewMode) {
  reviewController = createReviewController({
    videoController,
    initialTimelineFilters: route.timelineFilters,
    onTimelineFiltersChanged: syncReviewUrl
  });
  removeReviewMutationSurfaces();
  ready = initializeReviewMode();
} else {
  eventController = createEventEntryController({
    store,
    videoController,
    onGameChanged: async game => {
      if (setupController) {
        setupController.syncGame(game);
        await setupController.refreshGames();
      }
    }
  });
  const voiceClientFactory = window.__STATS_VOICE_CLIENT_FACTORY__
    || (options => new VoiceCompanionClient(options));
  voiceController = createVoiceCaptureController({
    videoController,
    getGame: () => eventController.getGame(),
    clientFactory: voiceClientFactory,
    mediaDevices: window.__STATS_MEDIA_DEVICES__ || navigator.mediaDevices,
    MediaRecorderClass: window.__STATS_MEDIA_RECORDER__ || window.MediaRecorder
  });
  setupController = createGameSetupController({
    store,
    onGameOpened: openGameWorkspace,
    onReviewRequested(gameId) {
      location.assign(buildReviewUrl(gameId, location.pathname));
    },
  });
  ready = setupController.ready;
}
window.__statsApp = {
  ready,
  reviewMode,
  sharedMode,
  videoController,
  setupController,
  eventController,
  voiceController,
  reviewController,
  store,
  destroy() {
    videoController.destroy();
    eventController?.destroy();
    voiceController?.destroy();
    reviewController?.destroy();
    store.close();
  }
};
