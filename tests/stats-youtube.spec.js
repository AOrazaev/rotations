const { test, expect } = require('@playwright/test');

test('YouTube URL parsing supports common URL formats and rejects invalid input', async ({ page }) => {
  await page.goto('/stats/');
  const results = await page.evaluate(async () => {
    const { parseYouTubeVideoId } = await import('/stats/js/youtube-player.js');
    const inputs = [
      'https://www.youtube.com/watch?v=M7lc1UVf-VE',
      'https://youtu.be/M7lc1UVf-VE?t=12',
      'https://www.youtube.com/shorts/M7lc1UVf-VE',
      'https://www.youtube.com/embed/M7lc1UVf-VE',
      'https://www.youtube.com/live/M7lc1UVf-VE',
      'M7lc1UVf-VE'
    ];
    let invalidMessage = '';
    try { parseYouTubeVideoId('https://example.com/not-youtube'); }
    catch (error) { invalidMessage = error.message; }
    return { parsed: inputs.map(parseYouTubeVideoId), invalidMessage };
  });

  expect(results.parsed).toEqual(Array(6).fill('M7lc1UVf-VE'));
  expect(results.invalidMessage).toMatch(/YouTube video ID/i);
});

test('video time formatting includes tenths and supports hour-long recordings', async ({ page }) => {
  await page.goto('/stats/');
  const values = await page.evaluate(async () => {
    const { formatVideoTime } = await import('/stats/js/youtube-player.js');
    return [0, 42.46, 125.04, 3723.2].map(formatVideoTime);
  });
  expect(values).toEqual(['0:00.0', '0:42.5', '2:05.0', '1:02:03.2']);
});

test('YouTube player errors are translated into actionable messages', async ({ page }) => {
  await page.goto('/stats/');
  const messages = await page.evaluate(async () => {
    const { describeYouTubeError } = await import('/stats/js/youtube-player.js');
    return [2, 5, 100, 101, 150, 999].map(describeYouTubeError);
  });
  expect(messages).toEqual([
    'YouTube rejected this video ID.',
    'This video cannot be played in the HTML5 player.',
    'This video is unavailable, private, or has been removed.',
    'The owner of this video has disabled embedding.',
    'The owner of this video has disabled embedding.',
    'YouTube could not load this video.'
  ]);
});

test.describe('video controller workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.__statsFakePlayer = {
        current: 42.4,
        calls: [],
        getCurrentSeconds() { return this.current; },
        seekTo(seconds) { this.current = seconds; this.calls.push(['seek', seconds]); },
        play() { this.calls.push(['play']); },
        pause() { this.calls.push(['pause']); },
        destroy() { this.calls.push(['destroy']); }
      };
      window.__statsLoadedVideoIds = [];
      window.__STATS_PLAYER_FACTORY__ = async (_element, videoId) => {
        window.__statsLoadedVideoId = videoId;
        window.__statsLoadedVideoIds.push(videoId);
        return window.__statsFakePlayer;
      };
    });
    await page.goto('/stats/');
    await page.locator('#videoUrl').fill('https://youtu.be/M7lc1UVf-VE');
    await page.locator('#loadVideo').click();
    await expect(page.locator('#workspace')).toBeVisible();
  });

  test('exposes the current timestamp and seeking through the player adapter', async ({ page }) => {
    expect(await page.evaluate(() => window.__statsLoadedVideoId)).toBe('M7lc1UVf-VE');
    await expect(page.locator('#currentTime')).toHaveText('0:42.4');

    const current = await page.evaluate(() => window.__statsApp.videoController.getCurrentSeconds());
    expect(current).toBe(42.4);
    await page.evaluate(() => window.__statsApp.videoController.seekTo(81.2));
    expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([['seek', 81.2]]);
  });

  test('play and pause controls use the player adapter', async ({ page }) => {
    await page.locator('#playVideo').click();
    await page.locator('#pauseVideo').click();
    expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
      ['play'],
      ['pause']
    ]);
  });

  test('loading another video recreates the player mount', async ({ page }) => {
    await page.locator('#videoUrl').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.locator('#loadVideo').click();

    expect(await page.evaluate(() => window.__statsLoadedVideoIds)).toEqual([
      'M7lc1UVf-VE',
      'dQw4w9WgXcQ'
    ]);
    await expect(page.locator('#playerFrame > #youtubePlayer')).toHaveCount(1);
  });
});

test('invalid URL reports an actionable error without opening the workspace', async ({ page }) => {
  await page.goto('/stats/');
  await page.locator('#videoUrl').fill('https://example.com/video');
  await page.locator('#loadVideo').click();
  await expect(page.locator('#videoError')).toContainText('valid YouTube video ID');
  await expect(page.locator('#workspace')).toBeHidden();
});

if (process.env.YOUTUBE_SMOKE) {
  test('real YouTube player loads and supports timestamp capture', async ({ page }) => {
    await page.goto('/stats/');
    await page.locator('#videoUrl').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
    await page.locator('#loadVideo').click();

    await expect(page.locator('#workspace')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#videoStatus')).toContainText('is ready');
    await page.locator('#playVideo').click();
    await page.locator('#pauseVideo').click();
    await expect(page.locator('#videoError')).toBeHidden();
  });
}
