const { test, expect } = require('@playwright/test');

async function openIsolatedStats(page, path = '/stats/') {
  const databaseName = `basketball-stats-setup-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
  }, databaseName);
  await page.goto(path);
  await page.evaluate(() => window.__statsApp.setupController.ready);
  return databaseName;
}

test('creates a standalone game and reopens it after page reload', async ({ page }) => {
  await openIsolatedStats(page);
  await page.locator('#gameTitle').fill('Sunday scrimmage');
  await page.locator('#opponentName').fill('Falcons');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();

  await expect(page.locator('#gamesStatus')).toContainText('Saved Sunday scrimmage');
  await expect(page.locator('.game-list-item')).toHaveCount(1);
  await expect(page.locator('[data-action="view-game"]')).toHaveAttribute('aria-label', 'View Sunday scrimmage');
  await expect(page.locator('[data-action="open-game"]')).toHaveAttribute('aria-label', 'Open Sunday scrimmage');
  await expect(page.locator('[data-action="export-game"]')).toHaveAttribute('aria-label', 'Export Sunday scrimmage');
  await expect(page.locator('[data-action="archive-game"]')).toHaveAttribute('aria-label', 'Archive Sunday scrimmage');
  await expect(page.locator('[data-action="delete-game"]')).toHaveAttribute('aria-label', 'Delete Sunday scrimmage');

  const savedBeforeReload = await page.evaluate(async () => {
    const games = await window.__statsApp.store.listGames();
    return games[0];
  });
  expect(savedBeforeReload.source).toBe('standalone');
  expect(savedBeforeReload.startingLineupIds).toHaveLength(5);
  expect(savedBeforeReload.video.videoId).toBe('M7lc1UVf-VE');

  await page.reload();
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await expect(page.locator('.game-list-item')).toHaveCount(1);
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('#gameTitle')).toHaveValue('Sunday scrimmage');
  await expect(page.locator('#opponentName')).toHaveValue('Falcons');
  await expect(page.locator('#gameVideoUrl')).toHaveValue('https://youtu.be/M7lc1UVf-VE');
  await expect(page.locator('.setup-player')).toHaveCount(5);
  await expect(page.locator('.setup-starter:checked')).toHaveCount(5);
});

test('requires exactly five starters and a valid YouTube URL', async ({ page }) => {
  await openIsolatedStats(page);
  await page.locator('#gameTitle').fill('Validation game');
  await page.locator('#gameVideoUrl').fill('https://example.com/video');
  await page.locator('#addSetupPlayer').click();
  await page.locator('.setup-starter').last().check();
  await page.locator('#saveGame').click();
  await expect(page.locator('#setupError')).toContainText('exactly five starters');

  await page.locator('.setup-starter').last().uncheck();
  await page.locator('#saveGame').click();
  await expect(page.locator('#setupError')).toContainText('valid YouTube video ID');
  await expect(page.locator('.game-list-item')).toHaveCount(0);
});

test('planner button imports the present roster and planned rotation once', async ({ page }) => {
  const databaseName = `basketball-stats-planner-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
  }, databaseName);
  await page.goto('/');
  const presentCount = await page.evaluate(() => state.players.filter(player => player.present).length);
  await page.locator('#generate').click();
  await page.locator('#startStatsReview').click();
  await page.waitForURL('**/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);

  await expect(page.locator('.setup-player')).toHaveCount(presentCount);
  await expect(page.locator('#gamesStatus')).toContainText(`Imported ${presentCount} players`);
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('basketball-stats-handoff-v1'))).toBeNull();

  await page.locator('#gameTitle').fill('Imported game');
  await page.locator('#gameVideoUrl').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  const saved = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(saved.source).toBe('planner');
  expect(saved.players).toHaveLength(presentCount);
  expect(saved.plannedRotation.blocks).toHaveLength(10);

  const originalName = saved.players[0].name;
  await page.evaluate(() => {
    const planner = JSON.parse(localStorage.getItem('basketball-rotation-planner-v1'));
    planner.players[0].name = 'Changed after import';
    localStorage.setItem('basketball-rotation-planner-v1', JSON.stringify(planner));
  });
  const unchanged = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0].players[0].name);
  expect(unchanged).toBe(originalName);
});

test('missing, malformed, stale, and duplicate-player handoffs are actionable and consumed', async ({ page }) => {
  await page.goto('/stats/');
  const results = await page.evaluate(async () => {
    const {
      consumePlannerHandoff,
      PLANNER_HANDOFF_KEY
    } = await import('/stats/js/roster-transfer.js');
    const capture = value => {
      if (value === undefined) localStorage.removeItem(PLANNER_HANDOFF_KEY);
      else localStorage.setItem(PLANNER_HANDOFF_KEY, value);
      try {
        consumePlannerHandoff(localStorage, Date.parse('2026-09-28T08:00:00Z'));
        return null;
      } catch (error) {
        return { code: error.code, message: error.message, consumed: localStorage.getItem(PLANNER_HANDOFF_KEY) === null };
      }
    };
    const players = Array.from({ length: 5 }, (_, index) => ({
      id: `p${index}`,
      name: `Player ${index}`,
      number: '',
      positions: [],
      skill: 50
    }));
    return {
      missing: capture(undefined),
      malformed: capture('{broken'),
      stale: capture(JSON.stringify({
        version: 1,
        createdAt: '2026-09-28T06:00:00Z',
        players,
        plannedRotation: null
      })),
      duplicate: capture(JSON.stringify({
        version: 1,
        createdAt: '2026-09-28T08:00:00Z',
        players: players.map((player, index) => ({ ...player, id: index === 4 ? 'p0' : player.id })),
        plannedRotation: null
      }))
    };
  });

  expect(results.missing).toMatchObject({ code: 'missing', consumed: true });
  expect(results.malformed).toMatchObject({ code: 'malformed', consumed: true });
  expect(results.stale).toMatchObject({ code: 'stale', consumed: true });
  expect(results.duplicate).toMatchObject({ code: 'invalid-roster', consumed: true });
});

test('saved games render in stable updated-time and ID order', async ({ page }) => {
  await openIsolatedStats(page);
  await page.evaluate(async () => {
    const fixture = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    const games = [
      { ...structuredClone(fixture), id: 'game-b', title: 'Older', updatedAt: '2026-09-28T07:00:00Z' },
      { ...structuredClone(fixture), id: 'game-c', title: 'Newer C', updatedAt: '2026-09-28T09:00:00Z' },
      { ...structuredClone(fixture), id: 'game-a', title: 'Newer A', updatedAt: '2026-09-28T09:00:00Z' }
    ];
    for (const game of games) await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.refreshGames();
  });

  await expect(page.locator('.game-list-title')).toHaveText(['Newer A', 'Newer C', 'Older']);
});

test('export, delete, and import recover an identical game and report', async ({ page }) => {
  await openIsolatedStats(page);
  const fixture = await page.evaluate(async () => {
    const game = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.refreshGames();
    return window.__statsApp.store.getGame(game.id);
  });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-game"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mvp-contract-verification-game-backup.json');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backupText = Buffer.concat(chunks).toString('utf8');

  await page.locator('[data-action="delete-game"]').click();
  await expect(page.locator('.game-list-item')).toHaveCount(0);
  await page.locator('#importGameBackupFile').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(backupText)
  });

  await expect(page.locator('#gamesStatus')).toContainText('Imported MVP contract verification game from backup');
  await expect(page.locator('.game-list-item')).toHaveCount(1);
  const restored = await page.evaluate(() => window.__statsApp.store.getGame('game-representative-v1'));
  expect(restored).toEqual(fixture);

  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('#reportFinalScore')).toHaveText('5–3');
  await expect(page.locator('#playerReportBody tr[data-player-id="p1"] .player-points')).toHaveText('2');
});

test('invalid and conflicting backup imports preserve existing games', async ({ page }) => {
  await openIsolatedStats(page);
  const fixture = await page.evaluate(async () => {
    const game = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.refreshGames();
    return window.__statsApp.store.getGame(game.id);
  });

  const invalidBackup = {
    backupVersion: 1,
    application: 'basketball-stats',
    exportedAt: '2026-09-28T16:00:00Z',
    game: { ...fixture, startingLineupIds: ['p1', 'p1', 'p2', 'p3', 'p4'] }
  };
  await page.locator('#importGameBackupFile').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(invalidBackup))
  });
  await expect(page.locator('#gamesStatus')).toContainText('Game data is invalid');

  const validBackup = {
    backupVersion: 1,
    application: 'basketball-stats',
    exportedAt: '2026-09-28T16:00:00Z',
    game: fixture
  };
  await page.locator('#importGameBackupFile').setInputFiles({
    name: 'conflict.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(validBackup))
  });
  await expect(page.locator('#gamesStatus')).toContainText('already exists');
  await expect(page.locator('.game-list-item')).toHaveCount(1);
  expect(await page.evaluate(() => window.__statsApp.store.getGame('game-representative-v1'))).toEqual(fixture);
});

test('games can be archived and restored without changing their contents', async ({ page }) => {
  await openIsolatedStats(page);
  const fixture = await page.evaluate(async () => {
    const game = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.refreshGames();
    return window.__statsApp.store.getGame(game.id);
  });

  await page.locator('[data-action="archive-game"]').click();
  const row = page.locator('.game-list-item');
  await expect(row).toHaveClass(/archived/);
  await expect(row.locator('.game-list-detail')).toContainText('Archived');
  await expect(row.locator('[data-action="open-game"]')).toBeHidden();
  await expect(row.locator('[data-action="restore-game"]')).toHaveText('Restore');

  const archived = await page.evaluate(() => window.__statsApp.store.getGame('game-representative-v1'));
  expect(archived).toEqual({
    ...fixture,
    updatedAt: archived.updatedAt,
    archivedAt: archived.archivedAt
  });
  expect(archived.archivedAt).toEqual(expect.any(String));

  await row.locator('[data-action="restore-game"]').click();
  await expect(row).not.toHaveClass(/archived/);
  await expect(row.locator('[data-action="open-game"]')).toBeVisible();
  const restored = await page.evaluate(() => window.__statsApp.store.getGame('game-representative-v1'));
  expect(restored).toEqual({ ...fixture, updatedAt: restored.updatedAt });
  expect(restored).not.toHaveProperty('archivedAt');
});
