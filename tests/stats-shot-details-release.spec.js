const { test, expect } = require('@playwright/test');

test('shot details survive correction, reload, backup recovery, filters, and reports', async ({ page }) => {
  const databaseName = `basketball-stats-shot-release-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
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
  }, databaseName);

  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.ready);
  const fixture = await page.evaluate(() =>
    fetch('/stats/docs/fixtures/shot-details-game-v2.json').then(response => response.json())
  );
  await page.locator('#importGameBackupFile').setInputFiles({
    name: 'shot-details-release.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      backupVersion: 1,
      application: 'basketball-stats',
      exportedAt: '2026-09-30T10:00:00Z',
      game: fixture
    }))
  });
  await expect(page.locator('#gamesStatus')).toContainText('Imported Shot details contract game from backup');
  await page.locator('[data-action="open-game"]').click();

  await expect(page.locator('.event-list-item[data-event-id="e1"] .event-detail-badge')).toHaveText([
    'Left corner 3',
    'Lightly contested',
    'Transition',
    'Second chance',
    'Cut'
  ]);
  await expect(page.locator('.event-list-item[data-event-id="e3"] .event-detail-badge')).toHaveCount(0);

  await page.locator('.event-list-item[data-event-id="e1"] [data-action="edit-event"]').click();
  await page.locator('#editShotDetails [data-shot-detail-field="pressure"][data-value="contested"]').click();
  await page.locator('#editShotDetails [data-shot-detail-field="contexts"][data-value="second_chance"]').click();
  await page.locator('#eventEditForm button[type="submit"]').click();

  await page.locator('.event-list-item[data-event-id="e2"] [data-action="edit-event"]').click();
  await page.locator('#editShotDetails [data-shot-details-action="clear-details"]').click();
  await page.locator('#eventEditForm button[type="submit"]').click();

  await page.reload();
  await page.evaluate(() => window.__statsApp.ready);
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('.event-list-item[data-event-id="e1"] .event-detail-badge')).toHaveText([
    'Left corner 3',
    'Contested',
    'Transition',
    'Cut'
  ]);
  await expect(page.locator('.event-list-item[data-event-id="e2"] .event-detail-badge')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-game"]').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(backup.game.schemaVersion).toBe(2);
  expect(backup.game.events.find(event => event.id === 'e1').shotDetails).toEqual({
    location: { x: 0.06, y: 0.2128 },
    pressure: 'contested',
    phase: 'transition',
    creation: 'cut'
  });
  expect(backup.game.events.find(event => event.id === 'e2')).not.toHaveProperty('shotDetails');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="delete-game"]').click();
  await expect(page.locator('.game-list-item')).toHaveCount(0);
  await page.locator('#importGameBackupFile').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup))
  });
  await expect(page.locator('#gamesStatus')).toContainText('Imported Shot details contract game from backup');
  await page.locator('[data-action="open-game"]').click();

  await page.locator('#openEventFilters').click();
  await page.locator('input[name="filterShotPressure"][value="contested"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-list-item')).toHaveAttribute('data-event-id', 'e1');

  await expect(page.locator('#shotReportSummary'))
    .toHaveText('2/2 FG (100%) · 2.50 points per attempt · 1 plotted · 1 without location');
  await expect(page.locator('#shotZonePlot [data-shot-zone="left_corner_three"]'))
    .toContainText('1/1 · 100%');
  await page.locator('#shotZonePlot [data-shot-zone="left_corner_three"]').click();
  await expect(page.locator('#reportSourceList [data-report-event-id]')).toHaveCount(1);

  await page.locator('#shotReportScope').selectOption('opponent');
  await expect(page.locator('#shotReportSummary'))
    .toHaveText('0/1 FG (0%) · 0.00 points per attempt · 0 plotted · 1 without location');
  await page.locator('#shotReportScope').selectOption('player:p1');
  await expect(page.locator('#shotReportSummary'))
    .toHaveText('1/1 FG (100%) · 3.00 points per attempt · 1 plotted · 0 without location');
});
