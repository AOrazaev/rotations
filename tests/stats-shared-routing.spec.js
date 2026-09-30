const { test, expect } = require('@playwright/test');

async function installSharedTestEnvironment(page) {
  await page.addInitScript(() => {
    window.__statsFakePlayer = {
      current: 0,
      calls: [],
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; this.calls.push(['seek', seconds]); },
      play() { this.calls.push(['play']); },
      pause() {},
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
    window.__sharedIndexedDbWrites = 0;
    window.__sharedClipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => { window.__sharedClipboardWrites.push(text); }
      }
    });
    for (const method of ['add', 'put', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        window.__sharedIndexedDbWrites += 1;
        return original.apply(this, args);
      };
    }
  });
}

test('shared route parser accepts safe names and rejects paths or file extensions', async ({ page }) => {
  await page.goto('/stats/');
  const result = await page.evaluate(async () => {
    const { buildSharedReviewUrl, parseStatsRoute } = await import('/stats/js/review-route.js');
    return {
      valid: parseStatsRoute('?mode=shared&game=game-20260927'),
      missing: parseStatsRoute('?mode=shared'),
      traversal: parseStatsRoute('?mode=shared&game=..%2Fsecret'),
      extension: parseStatsRoute('?mode=shared&game=game.json'),
      whitespace: parseStatsRoute('?mode=shared&game=%20game'),
      filtered: parseStatsRoute(
        '?mode=shared&game=game-20260927&tl-player=p1&tl-player=p2'
        + '&tl-type=shot&tl-type=invalid&tl-pressure=open&tl-comment=with'
      ),
      built: buildSharedReviewUrl('game-20260927', '/rotations/stats/'),
      builtFiltered: buildSharedReviewUrl('game-20260927', '/rotations/stats/', {
        players: ['p1'],
        types: ['shot'],
        shotPressures: ['open'],
        comment: 'with'
      })
    };
  });

  expect(result).toEqual({
    valid: { mode: 'shared', status: 'ready', snapshotName: 'game-20260927' },
    missing: { mode: 'shared', status: 'missing-game', snapshotName: null },
    traversal: { mode: 'shared', status: 'invalid-game', snapshotName: null },
    extension: { mode: 'shared', status: 'invalid-game', snapshotName: null },
    whitespace: { mode: 'shared', status: 'invalid-game', snapshotName: null },
    filtered: {
      mode: 'shared',
      status: 'ready',
      snapshotName: 'game-20260927',
      timelineFilters: {
        types: ['shot'],
        shotPressures: ['open'],
        players: ['p1', 'p2'],
        comment: 'with'
      }
    },
    built: '/rotations/stats/?mode=shared&game=game-20260927',
    builtFiltered: '/rotations/stats/?mode=shared&game=game-20260927'
      + '&tl-type=shot&tl-pressure=open&tl-player=p1&tl-comment=with'
  });
});

test('published game opens as a reload-safe zero-write shared Review link', async ({ page, request }) => {
  await installSharedTestEnvironment(page);
  const publishedResponse = await request.get('/games/game-20260927.json');
  expect(publishedResponse.ok()).toBe(true);
  const publishedBackup = await publishedResponse.json();

  await page.goto('/stats/?mode=shared&game=game-20260927&ignored=value');
  await page.evaluate(() => window.__statsApp.ready);

  expect(new URL(page.url()).search).toBe('?mode=shared&game=game-20260927');
  await expect(page.locator('#reviewModeLabel')).toHaveText('Shared read-only review');
  await expect(page.locator('#reviewModeTitle')).toHaveText(publishedBackup.game.title);
  await expect(page.locator('#reviewModeOpponent')).toHaveText(`vs ${publishedBackup.game.opponentName}`);
  await expect(page.locator('.event-list-item')).toHaveCount(publishedBackup.game.events.length);
  await expect(page.locator('#gamePanel, #eventEntryPanel, #eventEditDialog, #coachCommentDialog')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    reviewMode: window.__statsApp.reviewMode,
    sharedMode: window.__statsApp.sharedMode,
    setup: Boolean(window.__statsApp.setupController),
    event: Boolean(window.__statsApp.eventController),
    review: Boolean(window.__statsApp.reviewController),
    writes: window.__sharedIndexedDbWrites
  }))).toEqual({
    reviewMode: true,
    sharedMode: true,
    setup: false,
    event: false,
    review: true,
    writes: 0
  });

  const firstEvent = publishedBackup.game.events
    .slice()
    .sort((a, b) => a.videoSeconds - b.videoSeconds || a.sequence - b.sequence)[0];
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator(`.event-list-item[data-event-id="${firstEvent.id}"] .event-time`).click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', Math.max(0, firstEvent.videoSeconds - 3)],
    ['play']
  ]);

  await page.locator('[data-review-section="shots"]').click();
  await expect(page.locator('#shotReportSummary')).toBeVisible();
  await page.locator('#shotReportScope').selectOption('opponent');
  await page.locator('#shotReportResult').selectOption('missed');
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);

  await page.reload();
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewModeTitle')).toHaveText(publishedBackup.game.title);
  await expect(page.locator('.event-list-item')).toHaveCount(publishedBackup.game.events.length);
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);
});

test('shared timeline filters survive reload, update the URL, and copy as a link', async ({ page, request }) => {
  await installSharedTestEnvironment(page);
  const publishedBackup = await request.get('/games/game-20260927.json').then(response => response.json());
  const playerShot = publishedBackup.game.events.find(event =>
    event.type === 'shot' && event.side === 'team' && event.playerId
  );
  expect(playerShot).toBeTruthy();
  const player = publishedBackup.game.players.find(item => item.id === playerShot.playerId);
  const expectedPlayerShots = publishedBackup.game.events.filter(event =>
    event.type === 'shot' && event.playerId === player.id
  );
  const allShots = publishedBackup.game.events.filter(event => event.type === 'shot');
  const playerLabel = player.number ? `#${player.number} ${player.name}` : player.name;

  await page.goto(
    `/stats/?mode=shared&game=game-20260927`
    + `&tl-player=${encodeURIComponent(player.id)}&tl-player=missing-player`
    + '&tl-type=shot&tl-type=invalid&ignored=value'
  );
  await page.evaluate(() => window.__statsApp.ready);

  await expect(page.locator('.event-list-item')).toHaveCount(expectedPlayerShots.length);
  await expect(page.locator('#activeEventFilters .filter-chip-label')).toHaveText([
    'Shot',
    playerLabel
  ]);
  let url = new URL(page.url());
  expect(url.searchParams.getAll('tl-player')).toEqual([player.id]);
  expect(url.searchParams.getAll('tl-type')).toEqual(['shot']);
  expect(url.searchParams.has('ignored')).toBe(false);

  await page.reload();
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('.event-list-item')).toHaveCount(expectedPlayerShots.length);

  await page.locator('.filter-chip[data-filter-group="players"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(allShots.length);
  expect(new URL(page.url()).searchParams.has('tl-player')).toBe(false);

  await page.locator('#openEventFilters').click();
  await page.locator(`input[name="filterPlayer"][value="${player.id}"]`).check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(expectedPlayerShots.length);
  url = new URL(page.url());
  expect(url.searchParams.getAll('tl-player')).toEqual([player.id]);

  await page.locator('#copyFilteredReviewLink').click();
  await expect(page.locator('#copyFilteredReviewStatus')).toHaveText('Filtered link copied.');
  expect(await page.evaluate(() => window.__sharedClipboardWrites)).toEqual([page.url()]);
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);
});

test('shared routes show explicit missing, unsafe, unavailable, and invalid backup errors', async ({ page }) => {
  await installSharedTestEnvironment(page);

  await page.goto('/stats/?mode=shared');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Select a shared game');
  await expect(page.locator('#reviewRouteMessage')).toContainText('does not identify a published game');

  await page.goto('/stats/?mode=shared&game=..%2Fsecret');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Invalid shared review link');

  await page.goto('/stats/?mode=shared&game=missing-game');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Shared game not found');
  await expect(page.locator('#reviewRouteMessage')).toContainText('file was not found');

  await page.route('**/games/malformed.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{not json'
  }));
  await page.goto('/stats/?mode=shared&game=malformed');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Shared game cannot be reviewed');
  await expect(page.locator('#reviewRouteMessage')).toContainText('not valid JSON');

  await page.route('**/games/wrong-app.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      backupVersion: 1,
      application: 'another-application',
      exportedAt: '2026-09-30T00:00:00.000Z',
      game: {}
    })
  }));
  await page.goto('/stats/?mode=shared&game=wrong-app');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Shared game cannot be reviewed');
  await expect(page.locator('#reviewRouteMessage')).toContainText('not created by Basketball Stats');

  await page.route('**/games/unavailable.json', route => route.abort('failed'));
  await page.goto('/stats/?mode=shared&game=unavailable');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteMessage')).toContainText('could not be downloaded');

  await page.route('**/games/oversized.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: 'x'.repeat(1024 * 1024 + 1)
  }));
  await page.goto('/stats/?mode=shared&game=oversized');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteMessage')).toContainText('too large');
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);
});
