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

  let player = null;
  let timer = null;
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
    notifyReady();
    const playerElement = createPlayerMount();
    workspace.classList.add('hidden');

    try {
      player = await playerFactory(playerElement, videoId, {
        onError(error) {
          setError(error.message);
          videoStatus.textContent = 'Video cannot be played.';
        }
      });
      workspace.classList.remove('hidden');
      videoStatus.textContent = `Video ${videoId} is ready.`;
      startClock();
      notifyReady();
    } catch (error) {
      setError(error.message || 'Could not load the YouTube video.');
      videoStatus.textContent = 'Video failed to load.';
      workspace.classList.remove('hidden');
      notifyReady();
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

  return {
    loadVideo,
    isReady: () => !!player,
    showWorkspace() {
      workspace.classList.remove('hidden');
    },
    subscribeReady(listener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    getCurrentSeconds() {
      if (!player) throw new Error('Load the game recording before adding events.');
      return player.getCurrentSeconds();
    },
    seekTo(seconds) {
      if (!player) throw new Error('Load the game recording before seeking.');
      player.seekTo(seconds);
    },
    play() {
      if (!player) throw new Error('Load the game recording before playing.');
      player.play();
    },
    destroy() {
      if (timer) clearIntervalFn(timer);
      if (player?.destroy) player.destroy();
    }
  };
}

const playerFactory = window.__STATS_PLAYER_FACTORY__ || createYouTubePlayer;
const videoController = createStatsSpikeApp({ playerFactory });
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
    document.querySelector('#videoUrl').value = game.video.sourceUrl;
    videoController.showWorkspace();
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
