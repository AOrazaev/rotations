const API_SCRIPT_ID = 'youtube-iframe-api';
const API_SRC = 'https://www.youtube.com/iframe_api';
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Enter a YouTube URL.');
  if (VIDEO_ID_PATTERN.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid YouTube URL.');
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let videoId = null;

  if (host === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || null;
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com')) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live'].includes(parts[0])) videoId = parts[1] || null;
    }
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error('This URL does not contain a valid YouTube video ID.');
  }
  return videoId;
}

export function formatVideoTime(seconds) {
  const value = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const wholeMinutes = Math.floor(value / 60);
  const hours = Math.floor(wholeMinutes / 60);
  const minutes = hours ? wholeMinutes % 60 : wholeMinutes;
  const secs = (value % 60).toFixed(1).padStart(4, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

export function describeYouTubeError(code) {
  if (code === 2) return 'YouTube rejected this video ID.';
  if (code === 5) return 'This video cannot be played in the HTML5 player.';
  if (code === 100) return 'This video is unavailable, private, or has been removed.';
  if (code === 101 || code === 150) return 'The owner of this video has disabled embedding.';
  return 'YouTube could not load this video.';
}

export function loadYouTubeIframeApi(windowObject = window, documentObject = document) {
  if (windowObject.YT?.Player) return Promise.resolve(windowObject.YT);
  if (windowObject.__basketballYouTubeApiPromise) return windowObject.__basketballYouTubeApiPromise;

  windowObject.__basketballYouTubeApiPromise = new Promise((resolve, reject) => {
    const previousReady = windowObject.onYouTubeIframeAPIReady;
    windowObject.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') previousReady();
      if (windowObject.YT?.Player) resolve(windowObject.YT);
      else reject(new Error('The YouTube player API loaded without a player implementation.'));
    };

    let script = documentObject.getElementById(API_SCRIPT_ID);
    if (!script) {
      script = documentObject.createElement('script');
      script.id = API_SCRIPT_ID;
      script.src = API_SRC;
      script.async = true;
      documentObject.head.appendChild(script);
    }
    script.addEventListener('error', () => reject(new Error('Could not load the YouTube player API. Check your connection and try again.')), { once: true });
  });

  windowObject.__basketballYouTubeApiPromise.catch(() => {
    delete windowObject.__basketballYouTubeApiPromise;
  });
  return windowObject.__basketballYouTubeApiPromise;
}

export class YouTubePlayerAdapter {
  constructor(player) {
    this.player = player;
  }

  getCurrentSeconds() {
    const seconds = Number(this.player.getCurrentTime());
    return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  }

  seekTo(seconds) {
    this.player.seekTo(Math.max(0, Number(seconds) || 0), true);
  }

  play() {
    this.player.playVideo();
  }

  pause() {
    this.player.pauseVideo();
  }

  destroy() {
    this.player.destroy();
  }
}

export async function createYouTubePlayer(element, videoId, { onError } = {}) {
  const YT = await loadYouTubeIframeApi();
  return new Promise((resolve, reject) => {
    let settled = false;
    const player = new YT.Player(element, {
      videoId,
      playerVars: {
        playsinline: 1,
        rel: 0
      },
      events: {
        onReady: () => {
          settled = true;
          resolve(new YouTubePlayerAdapter(player));
        },
        onError: event => {
          const error = new Error(describeYouTubeError(event.data));
          if (!settled) reject(error);
          else if (onError) onError(error);
        }
      }
    });
  });
}
