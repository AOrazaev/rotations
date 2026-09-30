const { test, expect } = require('@playwright/test');

test('complete Review workflow remains read-only across reload and tracker return', async ({ page }) => {
  const databaseName = `basketball-stats-review-release-${Date.now()}-${Math.random()}`;
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

    for (const method of ['add', 'put', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        if (sessionStorage.getItem('trackReviewWrites') === 'true') {
          const count = Number(sessionStorage.getItem('reviewWriteCount') || 0);
          sessionStorage.setItem('reviewWriteCount', String(count + 1));
        }
        return original.apply(this, args);
      };
    }
  }, databaseName);

  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.ready);
  const fixture = await page.evaluate(async () => {
    const game = await fetch('/stats/docs/fixtures/review-view-game-v1.json').then(response => response.json());
    game.events.find(event => event.id === 'e1').shotDetails = {
      location: { x: 0.5, y: 0.1117 },
      pressure: 'open',
      phase: 'half_court',
      contexts: ['second_chance'],
      creation: 'cut'
    };
    game.events.find(event => event.id === 'e2').shotDetails = {
      location: { x: 0.06, y: 0.2128 },
      pressure: 'heavily_contested',
      phase: 'transition',
      creation: 'pull_up'
    };
    game.events.find(event => event.id === 'e5').shotDetails = {
      pressure: 'contested',
      phase: 'transition',
      creation: 'drive'
    };
    game.events.find(event => event.id === 'e8').shotDetails = {
      location: { x: 0.94, y: 0.2128 },
      pressure: 'lightly_contested',
      phase: 'half_court',
      creation: 'catch_and_shoot'
    };
    const periodMarker = game.events.find(event => event.id === 'e14');
    periodMarker.type = 'period_end';
    periodMarker.side = 'system';
    periodMarker.playerId = null;
    periodMarker.videoSeconds = 145;
    periodMarker.periodLabel = 'Halftime';
    delete periodMarker.note;
    return game;
  });
  await page.locator('#importGameBackupFile').setInputFiles({
    name: 'review-release-game.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      backupVersion: 1,
      application: 'basketball-stats',
      exportedAt: '2026-09-29T00:00:00Z',
      game: fixture
    }))
  });
  await expect(page.locator('#gamesStatus')).toContainText('Imported Review view verification game from backup');
  await expect(page.locator('.game-list-item')).toHaveCount(1);
  await page.evaluate(() => {
    sessionStorage.setItem('reviewWriteCount', '0');
    sessionStorage.setItem('trackReviewWrites', 'true');
  });

  await page.locator('[data-action="view-game"]').click();
  await page.waitForURL(url => url.searchParams.get('mode') === 'review');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewModeTitle')).toHaveText('Review view verification game');
  await expect(page.locator('#reviewModeScore')).toHaveText('0–0');
  await expect(page.locator('#gamePanel, #eventEntryPanel, #eventEditDialog, #coachCommentDialog')).toHaveCount(0);

  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('.event-list-item[data-event-id="e1"] .event-time').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 107],
    ['play']
  ]);

  await page.locator('#toggleEventOrder').click();
  await expect(page.locator('#eventOrderDescription')).toHaveText('Latest first.');
  await expect(page.locator('.event-list-item').first()).toHaveAttribute('data-event-id', 'e13');
  await page.locator('#openEventFilters').click();
  await page.locator('input[name="filterComment"][value="with"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(4);
  await page.locator('#openEventFilters').click();
  await page.locator('#clearEventFilters').click();
  await page.locator('#shotFilterDetails summary').click();
  await page.locator('input[name="filterShotPressure"][value="open"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-detail-badge')).toHaveText([
    'Restricted area',
    'Open',
    'Half court',
    'Second chance',
    'Cut'
  ]);

  await page.locator('[data-review-section="team"]').click();
  await expect(page.locator('#teamReportSection')).toBeVisible();
  await page.locator('#teamComparisonBody tr[data-side="team"] [data-metric="fieldGoals"] button').click();
  await expect(page.locator('#reportSourceList [data-report-event-id]')).toHaveCount(3);
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#reportSourceList [data-report-event-id="e8"]').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([['seek', 147]]);

  await page.locator('[data-review-section="players"]').click();
  await expect(page.locator('#playerReportSection')).toBeVisible();
  await expect(page.locator('#playerReportBody tr')).toHaveCount(6);
  await page.locator('[data-review-section="shots"]').click();
  await expect(page.locator('#shotReportSummary'))
    .toHaveText('2/3 FG (66.7%) · 1.67 points per attempt · 2 plotted · 1 without location');
  await expect(page.locator('#shotChartPlot [data-report-event-id]')).toHaveCount(2);
  await page.locator('#shotReportPeriod').selectOption('1');
  await expect(page.locator('#shotReportSummary'))
    .toHaveText('1/2 FG (50%) · 1.00 points per attempt · 1 plotted · 1 without location');
  await page.locator('#shotReportPeriod').selectOption('__any__');
  await page.locator('#shotReportPressure').selectOption('open');
  await expect(page.locator('#shotReportSummary')).toContainText('1/1 FG');
  await page.locator('#clearShotReportFilters').click();
  await page.locator('#shotReportScope').selectOption('opponent');
  await expect(page.locator('#shotReportSummary'))
    .toHaveText('1/2 FG (50%) · 1.00 points per attempt · 1 plotted · 1 without location');
  await page.locator('#shotReportScope').selectOption('player:p1');
  await expect(page.locator('#shotReportSummary'))
    .toHaveText('1/1 FG (100%) · 2.00 points per attempt · 1 plotted · 0 without location');
  await page.locator('#shotReportScope').selectOption('team');
  await page.locator('#shotZonePlot [data-shot-zone="restricted_area"]').click();
  await expect(page.locator('#reportSourceList [data-report-event-id]')).toHaveCount(1);
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#shotChartPlot [data-report-event-id="e8"]').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([['seek', 147]]);
  await page.locator('[data-review-section="lineups"]').click();
  await expect(page.locator('#lineupReportSection')).toBeVisible();
  await expect(page.locator('#lineupReportBody tr')).toHaveCount(2);

  await page.locator('[data-review-section="feedback"]').click();
  await page.locator('#feedbackPlayer').selectOption('p1');
  await expect(page.locator('[data-player-stat="points"] dd')).toHaveText('2');
  await expect(page.locator('#feedbackMomentPosition')).toHaveText('1 of 2');
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#nextFeedbackMoment').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 129],
    ['play']
  ]);
  await page.locator('#copyPlayerFeedback').click();
  await page.locator('#copyYouTubeFeedback').click();
  await expect(page.locator('#playerFeedbackStatus')).toHaveText('Copied timestamp comment for YouTube.');
  expect(await page.evaluate(() => window.__clipboardWrites.length)).toBe(2);
  expect(await page.evaluate(() => Number(sessionStorage.getItem('reviewWriteCount')))).toBe(0);

  await page.reload();
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewModeTitle')).toHaveText('Review view verification game');
  await expect(page.locator('#reportFinalScore')).toHaveText('5–3');
  await page.locator('[data-review-section="shots"]').click();
  await expect(page.locator('#shotChartPlot [data-report-event-id]')).toHaveCount(2);
  await expect(page.locator('.event-list-item[data-event-id="e8"] .event-detail-badge')).toHaveText([
    'Right corner 3',
    'Lightly contested',
    'Half court',
    'Catch-and-shoot'
  ]);
  expect(new URL(page.url()).searchParams.get('game')).toBe(fixture.id);
  expect(await page.evaluate(() => Number(sessionStorage.getItem('reviewWriteCount')))).toBe(0);

  await page.locator('#reviewModeHeader a').click();
  await page.waitForURL('/stats/');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#gamePanel')).toBeVisible();
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('#reportFinalScore')).toHaveText('5–3');
  await expect(page.locator('#eventEntryPanel')).toBeVisible();
  expect(await page.evaluate(() => Number(sessionStorage.getItem('reviewWriteCount')))).toBe(0);
});
