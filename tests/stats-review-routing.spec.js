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
  return databaseName;
}

async function saveReviewFixture(page, overrides = {}) {
  return page.evaluate(async values => {
    const fixture = await fetch('/stats/docs/fixtures/review-view-game-v1.json').then(response => response.json());
    fixture.events.find(event => event.id === 'e1').shotDetails = {
      location: { x: 0.5, y: 0.1117 },
      pressure: 'open',
      phase: 'half_court',
      contexts: ['second_chance'],
      creation: 'cut'
    };
    const periodMarker = fixture.events.find(event => event.id === 'e14');
    periodMarker.type = 'period_end';
    periodMarker.side = 'system';
    periodMarker.playerId = null;
    periodMarker.videoSeconds = 145;
    periodMarker.periodLabel = 'Halftime';
    delete periodMarker.note;
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
  await expect(page.locator('.event-list-item[data-event-id="e1"] .event-detail-badge')).toHaveText([
    'Restricted area',
    'Open',
    'Half court',
    'Second chance',
    'Cut'
  ]);
  await expect(page.locator('#gamePanel')).toBeHidden();
  expect(await page.evaluate(() => window.__statsApp.reviewMode)).toBe(true);
  expect(await page.evaluate(() => ({
    setup: Boolean(window.__statsApp.setupController),
    event: Boolean(window.__statsApp.eventController),
    review: Boolean(window.__statsApp.reviewController)
  }))).toEqual({ setup: false, event: false, review: true });

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

test('Review view interactions expose no mutation workflow or game writes', async ({ page }) => {
  await openIsolatedStats(page);
  const game = await saveReviewFixture(page);
  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(game.id)}`);
  await page.evaluate(() => window.__statsApp.ready);

  await expect(page.locator('#gamePanel')).toHaveCount(0);
  await expect(page.locator('#eventEntryPanel')).toHaveCount(0);
  await expect(page.locator('#undoEvent')).toHaveCount(0);
  await expect(page.locator('[data-action="comment-event"]')).toHaveCount(0);
  await expect(page.locator('[data-action="edit-event"]')).toHaveCount(0);
  await expect(page.locator('[data-action="delete-event"]')).toHaveCount(0);
  await expect(page.locator('#eventEditDialog, #coachCommentDialog, #substitutionDialog, #periodEndDialog, #noteDialog')).toHaveCount(0);

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

  await page.locator('#toggleEventOrder').click();
  await page.locator('#openEventFilters').click();
  await page.locator('input[name="filterComment"][value="with"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await page.locator('#openEventFilters').click();
  await page.locator('#clearEventFilters').click();
  await page.locator('input[name="filterShotPressure"][value="open"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await page.locator('.event-time').first().click();

  await page.locator('[data-review-section="team"]').click();
  await page.locator('#teamComparisonBody tr[data-side="team"] [data-metric="fieldGoals"] button').click();
  await page.locator('#reportSourceList [data-report-event-id]').first().click();
  await page.locator('[data-review-section="shots"]').click();
  await page.locator('#shotReportPeriod').selectOption('1');
  await page.locator('#shotReportPressure').selectOption('open');
  await expect(page.locator('#shotReportSummary')).toContainText('1/1 FG');
  await page.locator('#shotChartPlot [data-report-event-id]').click();
  await page.locator('[data-review-section="feedback"]').click();
  await page.locator('#feedbackPlayer').selectOption('p1');
  await page.locator('#copyPlayerFeedback').click();
  await page.locator('#copyYouTubeFeedback').click();

  expect(await page.evaluate(() => window.__reviewStoreWrites)).toEqual({ save: 0, delete: 0 });
  expect(await page.evaluate(() => window.__clipboardWrites.length)).toBe(2);
});

test('normal tracker mode still initializes mutation controllers', async ({ page }) => {
  await openIsolatedStats(page);
  expect(await page.evaluate(() => ({
    setup: Boolean(window.__statsApp.setupController),
    event: Boolean(window.__statsApp.eventController),
    review: Boolean(window.__statsApp.reviewController)
  }))).toEqual({ setup: true, event: true, review: false });
  await expect(page.locator('#gameSetupForm')).toBeVisible();
  await expect(page.locator('#eventEditDialog')).toHaveCount(1);
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
