const { test, expect } = require('@playwright/test');

async function openFixtureReport(page, { playerFails = false } = {}) {
  const databaseName = `basketball-stats-reports-${Date.now()}-${Math.random()}`;
  await page.addInitScript(({ name, fails }) => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 0,
      calls: [],
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; this.calls.push(['seek', seconds]); },
      play() {},
      pause() {},
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => {
      if (fails) throw new Error('Simulated unavailable recording.');
      return window.__statsFakePlayer;
    };
  }, { name: databaseName, fails: playerFails });
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.evaluate(async () => {
    const fixture = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    await window.__statsApp.store.saveGame(fixture);
    await window.__statsApp.setupController.refreshGames();
  });
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('#reportCard')).toBeVisible();
}

test('fixture report renders hand-calculated team, player, lineup, and progression values', async ({ page }) => {
  await openFixtureReport(page);

  await expect(page.locator('#reportFinalScore')).toHaveText('5–3');
  await expect(page.locator('#teamComparisonHead th')).toHaveText([
    'Team', 'FG', '2PT', '3PT', 'FT', 'Offensive rebounds', 'Defensive rebounds',
    'Assists', 'Steals', 'Blocks', 'Turnovers', 'Fouls'
  ]);
  const teamRow = page.locator('#teamComparisonBody tr[data-side="team"]');
  const opponentRow = page.locator('#teamComparisonBody tr[data-side="opponent"]');
  await expect(teamRow.locator('[data-metric="fieldGoals"] .team-report-value')).toHaveText('2/3 (66.7%)');
  await expect(opponentRow.locator('[data-metric="fieldGoals"] .opponent-report-value')).toHaveText('1/2 (50%)');
  await expect(teamRow.locator('[data-metric="defensiveRebounds"] .team-report-value')).toHaveText('1');

  const p1 = page.locator('#playerReportBody tr[data-player-id="p1"]');
  await expect(p1.locator('.player-points')).toHaveText('2');
  await expect(p1.locator('.player-efficiency')).toHaveText('3');
  await expect(p1.locator('.player-true-shooting')).toHaveText('100%');
  await expect(p1.locator('.player-assists')).toHaveText('1');
  await expect(p1.locator('.player-plus-minus')).toHaveText('+2');
  await expect(p1.locator('.player-video-time')).toHaveText('1:40.0');

  const p6 = page.locator('#playerReportBody tr[data-player-id="p6"]');
  await expect(p6.locator('.player-points')).toHaveText('3');
  await expect(p6.locator('.player-efficiency')).toHaveText('3');
  await expect(p6.locator('.player-true-shooting')).toHaveText('150%');
  await expect(p6.locator('.player-video-time')).toHaveText('1:00.0');

  await expect(page.locator('#lineupReportBody tr')).toHaveCount(2);
  const secondLineup = page.locator('#lineupReportBody tr').nth(1);
  await expect(secondLineup.locator('.lineup-points-for')).toHaveText('3');
  await expect(secondLineup.locator('.lineup-points-against')).toHaveText('1');
  await expect(secondLineup.locator('.lineup-plus-minus')).toHaveText('+2');
  await expect(secondLineup.locator('.lineup-video-time')).toHaveText('1:00.0');

  await expect(page.locator('#scoreProgression li')).toHaveCount(4);
  await expect(page.locator('#scoreProgression li strong')).toHaveText(['2–0', '2–2', '5–2', '5–3']);
});

test('linked report values expose source events and seek to the expected play', async ({ page }) => {
  await openFixtureReport(page);
  await expect(page.locator('#eventLockMessage')).toBeHidden();

  await page.locator('#teamComparisonBody tr[data-side="team"] [data-metric="fieldGoals"] .team-report-value').click();
  await expect(page.locator('#reportSourceTitle')).toHaveText('3 source plays');
  await expect(page.locator('#reportSourceList li')).toHaveCount(3);
  await expect(page.locator('#reportSourceList li[data-event-id="e8"]')).toContainText('made 3PT');

  await page.locator('#reportSourceList li[data-event-id="e8"] [data-report-event-id]').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls.at(-1))).toEqual(['seek', 150]);

  await page.locator('#scoreProgression li[data-event-id="e4"] [data-report-event-id]').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls.at(-1))).toEqual(['seek', 125]);
});

test('report navigation explains when the recording is unavailable', async ({ page }) => {
  await openFixtureReport(page, { playerFails: true });
  await page.locator('#scoreProgression li').first().locator('[data-report-event-id]').click();
  await expect(page.locator('#reportError')).toContainText('recording is unavailable for seeking');
});
