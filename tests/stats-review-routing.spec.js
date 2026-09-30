const { test, expect } = require('@playwright/test');

async function openIsolatedStats(page) {
  const databaseName = `basketball-stats-review-routing-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 0,
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; },
      play() {},
      pause() {},
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
  }, databaseName);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.ready);
  return databaseName;
}

async function saveReviewFixture(page, overrides = {}) {
  return page.evaluate(async values => {
    const fixture = await fetch('/stats/docs/fixtures/review-view-game-v1.json').then(response => response.json());
    const game = { ...fixture, ...values };
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.refreshGames();
    return game;
  }, overrides);
}

test('View opens a saved game in a reload-safe review route', async ({ page }) => {
  await openIsolatedStats(page);
  const game = await saveReviewFixture(page);

  await page.locator('[data-action="view-game"]').click();
  await page.waitForURL(url => url.searchParams.get('mode') === 'review');
  await page.evaluate(() => window.__statsApp.ready);

  expect(new URL(page.url()).searchParams.get('game')).toBe(game.id);
  await expect(page.locator('#reviewModeHeader')).toBeVisible();
  await expect(page.locator('#reviewModeTitle')).toHaveText(game.title);
  await expect(page.locator('#reviewModeOpponent')).toHaveText('vs Falcons');
  await expect(page.locator('#reviewRouteState')).toBeHidden();
  await expect(page.locator('#reportFinalScore')).toHaveText('5–3');
  await expect(page.locator('#gamePanel')).toBeHidden();
  expect(await page.evaluate(() => window.__statsApp.reviewMode)).toBe(true);

  await page.reload();
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewModeTitle')).toHaveText(game.title);
  await expect(page.locator('#reportFinalScore')).toHaveText('5–3');

  await page.locator('#reviewModeHeader a').click();
  await page.waitForURL('/stats/');
  await page.evaluate(() => window.__statsApp.ready);
  expect(await page.evaluate(() => window.__statsApp.reviewMode)).toBe(false);
  await expect(page.locator('#gamePanel')).toBeVisible();
});

test('review routes reject missing, empty, and unknown game identifiers', async ({ page }) => {
  await openIsolatedStats(page);

  await page.goto('/stats/?mode=review');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Select a game to review');
  await expect(page.locator('#reviewRouteMessage')).toContainText('does not identify a saved game');
  await expect(page.locator('#statsShell')).toBeHidden();

  await page.goto('/stats/?mode=review&game=');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Invalid review link');
  await expect(page.locator('#statsShell')).toBeHidden();

  await page.goto('/stats/?mode=review&game=missing-game');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Game not found');
  await expect(page.locator('#reviewRouteMessage')).toContainText('not available in this browser');
  await expect(page.locator('#statsShell')).toBeHidden();
});

test('archived games cannot be opened in Review view', async ({ page }) => {
  await openIsolatedStats(page);
  const game = await saveReviewFixture(page, {
    archivedAt: '2026-09-29T10:00:00Z',
    updatedAt: '2026-09-29T10:00:00Z'
  });

  await expect(page.locator('[data-action="view-game"]')).toBeHidden();
  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(game.id)}`);
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Game is archived');
  await expect(page.locator('#reviewRouteMessage')).toContainText(game.title);
  await expect(page.locator('#reviewRouteMessage')).toContainText('must be restored');
  await expect(page.locator('#statsShell')).toBeHidden();
});

test('review routing ignores planner imports and canonicalizes the URL', async ({ page }) => {
  await openIsolatedStats(page);
  const game = await saveReviewFixture(page);
  await page.evaluate(() => {
    localStorage.setItem('basketball-stats-handoff-v1', JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      players: [],
      plannedRotation: null
    }));
  });

  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(game.id)}&import=planner`);
  await page.evaluate(() => window.__statsApp.ready);

  const url = new URL(page.url());
  expect([...url.searchParams.keys()]).toEqual(['mode', 'game']);
  expect(await page.evaluate(() => localStorage.getItem('basketball-stats-handoff-v1'))).not.toBeNull();
  await expect(page.locator('#reviewModeTitle')).toHaveText(game.title);
});

test('invalid stored games show a safe Review view error', async ({ page }) => {
  const databaseName = await openIsolatedStats(page);
  const game = await saveReviewFixture(page);
  await page.evaluate(async ({ name, gameId }) => {
    window.__statsApp.destroy();
    const request = indexedDB.open(name, 2);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('games', 'readwrite');
    const stored = await new Promise((resolve, reject) => {
      const lookup = transaction.objectStore('games').get(gameId);
      lookup.onsuccess = () => resolve(lookup.result);
      lookup.onerror = () => reject(lookup.error);
    });
    stored.startingLineupIds = ['p1', 'p1', 'p2', 'p3', 'p4'];
    transaction.objectStore('games').put(stored);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { name: databaseName, gameId: game.id });

  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(game.id)}`);
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Game cannot be reviewed');
  await expect(page.locator('#reviewRouteMessage')).toContainText('cannot be reviewed safely');
  await expect(page.locator('#statsShell')).toBeHidden();
});
