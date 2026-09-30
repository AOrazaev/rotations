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
  const fixture = await page.evaluate(() =>
    fetch('/stats/docs/fixtures/review-view-game-v1.json').then(response => response.json())
  );
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
  await expect(page.locator('.event-list-item').first()).toHaveAttribute('data-event-id', 'e14');
  await page.locator('#openEventFilters').click();
  await page.locator('input[name="filterComment"][value="with"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(4);

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
