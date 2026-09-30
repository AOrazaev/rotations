const { test, expect } = require('@playwright/test');

async function openPlayerReview(page, { removeTeamComment = false, width = 1280 } = {}) {
  const databaseName = `basketball-stats-review-player-${Date.now()}-${Math.random()}`;
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 0,
      playing: false,
      calls: [],
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; this.calls.push(['seek', seconds]); },
      play() { this.playing = true; this.calls.push(['play']); },
      isPlaying() { return this.playing; },
      pause() { this.playing = false; this.calls.push(['pause']); },
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
    window.__clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => { window.__clipboardWrites.push(text); }
      }
    });
  }, databaseName);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.ready);
  const game = await page.evaluate(async shouldRemoveTeamComment => {
    const fixture = await fetch('/stats/docs/fixtures/review-view-game-v1.json').then(response => response.json());
    if (shouldRemoveTeamComment) delete fixture.events.find(event => event.id === 'e6').coachComment;
    await window.__statsApp.store.saveGame(fixture);
    return fixture;
  }, removeTeamComment);
  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(game.id)}`);
  await page.evaluate(() => window.__statsApp.ready);
  await page.locator('[data-review-section="feedback"]').click();
  return game;
}

test('Review feedback shows player statistics and navigates canonical moments', async ({ page }) => {
  await openPlayerReview(page);
  await page.locator('#feedbackPlayer').selectOption('p1');

  await expect(page.locator('#feedbackPlayerSummary')).toBeVisible();
  await expect(page.locator('[data-player-stat="points"] dd')).toHaveText('2');
  await expect(page.locator('[data-player-stat="fieldGoals"] dd')).toHaveText('1/1');
  await expect(page.locator('[data-player-stat="assists"] dd')).toHaveText('1');
  await expect(page.locator('[data-player-stat="plusMinus"] dd')).toHaveText('+2');
  await expect(page.locator('[data-player-stat="efficiency"] dd')).toHaveText('3');
  await expect(page.locator('[data-player-stat="trueShooting"] dd')).toHaveText('100%');
  await expect(page.locator('[data-player-stat="videoTime"] dd')).toHaveText('1:40.0');

  await expect(page.locator('#playerFeedbackList .player-feedback-item')).toHaveCount(2);
  expect(await page.locator('#playerFeedbackList .player-feedback-item').evaluateAll(items =>
    items.map(item => item.dataset.eventId)
  )).toEqual(['e1', 'e6']);
  await expect(page.locator('#playerFeedbackList [data-event-id="e1"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#feedbackMomentPosition')).toHaveText('1 of 2');
  await expect(page.locator('#previousFeedbackMoment')).toBeDisabled();
  await expect(page.locator('#nextFeedbackMoment')).toBeEnabled();

  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#nextFeedbackMoment').click();
  await expect(page.locator('#playerFeedbackList [data-event-id="e6"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#feedbackMomentPosition')).toHaveText('2 of 2');
  await expect(page.locator('#nextFeedbackMoment')).toBeDisabled();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 129],
    ['play']
  ]);

  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#previousFeedbackMoment').click();
  await expect(page.locator('#playerFeedbackList [data-event-id="e1"]')).toHaveAttribute('aria-current', 'true');
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 107],
    ['play']
  ]);
});

test('Review feedback preserves substitution, jersey, and team attribution', async ({ page }) => {
  await openPlayerReview(page);

  await page.locator('#feedbackPlayer').selectOption('p2');
  expect(await page.locator('#playerFeedbackList .player-feedback-item').evaluateAll(items =>
    items.map(item => item.dataset.eventId)
  )).toEqual(['e4', 'e6']);

  await page.locator('#feedbackPlayer').selectOption('p5');
  expect(await page.locator('#playerFeedbackList .player-feedback-item').evaluateAll(items =>
    items.map(item => item.dataset.eventId)
  )).toEqual(['e6', 'e7']);
  await expect(page.locator('.player-feedback-comment')).toHaveText([
    '@team Sprint back together.',
    'Communicate the substitution matchup.'
  ]);
});

test('Review feedback keeps summary visible for a player without comments', async ({ page }) => {
  await openPlayerReview(page, { removeTeamComment: true });
  await page.locator('#feedbackPlayer').selectOption('p3');

  await expect(page.locator('#feedbackPlayerSummary')).toBeVisible();
  await expect(page.locator('[data-player-stat="fieldGoals"] dd')).toHaveText('0/1');
  await expect(page.locator('#emptyPlayerFeedback')).toBeVisible();
  await expect(page.locator('#feedbackMomentNavigation')).toBeHidden();
  await expect(page.locator('#playerFeedbackList .player-feedback-item')).toHaveCount(0);
  await expect(page.locator('#copyPlayerFeedback')).toBeDisabled();
  await expect(page.locator('#copyYouTubeFeedback')).toBeDisabled();
});

test('Review feedback navigation and copying never write game data', async ({ page }) => {
  await openPlayerReview(page);
  await page.locator('#feedbackPlayer').selectOption('p1');
  await page.evaluate(() => {
    window.__reviewStoreWrites = { save: 0, delete: 0 };
    window.__statsApp.store.saveGame = async () => {
      window.__reviewStoreWrites.save += 1;
      throw new Error('Review view attempted to save.');
    };
    window.__statsApp.store.deleteGame = async () => {
      window.__reviewStoreWrites.delete += 1;
      throw new Error('Review view attempted to delete.');
    };
  });

  await page.locator('#nextFeedbackMoment').click();
  await page.locator('.feedback-event-select').last().uncheck();
  await page.locator('#copyPlayerFeedback').click();
  await page.locator('#copyYouTubeFeedback').click();

  expect(await page.evaluate(() => window.__reviewStoreWrites)).toEqual({ save: 0, delete: 0 });
  const copied = await page.evaluate(() => window.__clipboardWrites);
  expect(copied).toHaveLength(2);
  expect(copied[0]).toContain('Alex — Review view verification game vs Falcons');
  expect(copied[0]).toContain('1:47.0 — Alex made 2PT');
  expect(copied[0]).toContain('https://youtu.be/M7lc1UVf-VE?t=107');
  expect(copied[0]).not.toContain('@team Sprint back together.');
  expect(copied[1]).toContain('1:47 — Alex made 2PT');
  expect(copied[1]).not.toContain('youtu.be');
});

test('Player-focused Review remains contained on mobile', async ({ page }) => {
  await openPlayerReview(page, { width: 600 });
  await page.locator('#feedbackPlayer').selectOption('p1');

  await expect(page.locator('#feedbackPlayerSummary')).toBeVisible();
  await expect(page.locator('#feedbackMomentNavigation')).toBeVisible();
  await expect(page.locator('#previousFeedbackMoment')).toBeVisible();
  await expect(page.locator('#nextFeedbackMoment')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
});
