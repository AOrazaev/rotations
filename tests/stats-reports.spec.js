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
    window.__clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => { window.__clipboardWrites.push(text); }
      }
    });
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

  await expect(page.locator('#scoreProgression .score-chart-line')).toHaveCount(2);
  await expect(page.locator('#scoreProgression .score-chart-point')).toHaveCount(4);
  expect(await page.locator('#scoreProgression .score-chart-point').first().evaluate(point => ({
    markerWidth: getComputedStyle(point, '::before').width,
    borderWidth: getComputedStyle(point).borderWidth
  }))).toEqual({ markerWidth: '7px', borderWidth: '0px' });
  expect(await page.locator('#scoreProgression .score-chart-point').evaluateAll(points =>
    points.map(point => point.getAttribute('aria-label'))
  )).toEqual([
    '1:50.0, Our team 2, Falcons 0',
    '2:05.0, Our team 2, Falcons 2',
    '2:30.0, Our team 5, Falcons 2',
    '3:00.0, Our team 5, Falcons 3'
  ]);
  expect(await page.locator('#scoreProgression').evaluate(element =>
    element.getBoundingClientRect().height
  )).toBeLessThan(240);
});

test('score progression chart keeps the existing no-made-shots empty state', async ({ page }) => {
  await openFixtureReport(page);
  await page.evaluate(async () => {
    const game = (await window.__statsApp.store.listGames())[0];
    for (const event of game.events) {
      if (event.type === 'shot') event.made = false;
    }
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.openGame(game.id);
  });

  await expect(page.locator('#emptyScoreProgression')).toBeVisible();
  await expect(page.locator('#scoreProgression')).toBeHidden();
  await expect(page.locator('#reportFinalScore')).toHaveText('0–0');
});

test('score progression chart marks period ends with labeled vertical lines', async ({ page }) => {
  await openFixtureReport(page);
  await page.evaluate(async () => {
    const game = (await window.__statsApp.store.listGames())[0];
    const marker = game.events.find(event => event.id === 'e14');
    marker.type = 'period_end';
    marker.videoSeconds = 145;
    marker.periodLabel = 'Halftime';
    delete marker.note;
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.openGame(game.id);
  });

  await expect(page.locator('#scoreProgression .score-chart-period-line')).toHaveCount(1);
  await expect(page.locator('#scoreProgression .score-chart-period-line')).toHaveAttribute('data-event-id', 'e14');
  await expect(page.locator('#scoreProgression .score-chart-period-label')).toHaveText('Halftime');
  await expect(page.locator('#scoreProgression .score-chart-period-line title'))
    .toHaveText('Halftime at 2:25.0');
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

  await page.locator('#scoreProgression [data-event-id="e4"]').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__statsFakePlayer.calls.at(-1))).toEqual(['seek', 125]);
});

test('report navigation explains when the recording is unavailable', async ({ page }) => {
  await openFixtureReport(page, { playerFails: true });
  await page.locator('#scoreProgression [data-report-event-id]').first().click();
  await expect(page.locator('#reportError')).toContainText('recording is unavailable for seeking');
});

test('player feedback copies selected coach comments with timestamped YouTube links', async ({ page }) => {
  await openFixtureReport(page);
  await expect(page.locator('#feedbackPlayerSummary')).toBeHidden();
  await expect(page.locator('#feedbackMomentNavigation')).toBeHidden();
  await page.evaluate(async () => {
    const game = (await window.__statsApp.store.listGames())[0];
    game.events.find(event => event.id === 'e1').coachComment = 'Attack the space decisively.';
    game.events.find(event => event.id === 'e9').coachComment = 'Good timing on the pass.';
    game.events.find(event => event.id === 'e3').coachComment = 'Secure the rebound first.';
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.openGame(game.id);
  });

  await page.locator('#feedbackPlayer').selectOption('p1');
  await expect(page.locator('#playerFeedbackList .player-feedback-item')).toHaveCount(2);
  await expect(page.locator('#playerFeedbackList a').nth(0))
    .toHaveAttribute('href', 'https://youtu.be/M7lc1UVf-VE?t=107');
  await expect(page.locator('#playerFeedbackList a').nth(1))
    .toHaveAttribute('href', 'https://youtu.be/M7lc1UVf-VE?t=147');
  await expect(page.locator('#playerFeedbackList a')).toHaveText(['1:47.0', '2:27.0']);

  await page.locator('.feedback-event-select').last().uncheck();
  await page.locator('#copyPlayerFeedback').click();
  await expect(page.locator('#playerFeedbackStatus')).toHaveText('Copied player feedback for Telegram.');

  const copied = await page.evaluate(() => window.__clipboardWrites.at(-1));
  expect(copied).toContain('Alex — MVP contract verification game vs Falcons');
  expect(copied).toContain('1:47.0 — Alex made 2PT');
  expect(copied).toContain('“Attack the space decisively.”');
  expect(copied).toContain('https://youtu.be/M7lc1UVf-VE?t=107');
  expect(copied).not.toContain('Good timing on the pass.');
  expect(copied).not.toContain('Secure the rebound first.');

  await page.locator('#copyYouTubeFeedback').click();
  await expect(page.locator('#playerFeedbackStatus')).toHaveText('Copied timestamp comment for YouTube.');
  const youtubeComment = await page.evaluate(() => window.__clipboardWrites.at(-1));
  expect(youtubeComment).toContain('Alex — MVP contract verification game vs Falcons');
  expect(youtubeComment).toContain('1:47 — Alex made 2PT');
  expect(youtubeComment).toContain('Attack the space decisively.');
  expect(youtubeComment).not.toContain('youtu.be');
  expect(youtubeComment).not.toContain('Good timing on the pass.');
});

test('player feedback includes explicit jersey and team mentions', async ({ page }) => {
  await openFixtureReport(page);
  await page.evaluate(async () => {
    const game = (await window.__statsApp.store.listGames())[0];
    game.events.find(event => event.id === 'e4').coachComment = '@2 Close out earlier.';
    game.events.find(event => event.id === 'e6').coachComment = '@TEAM Sprint back together.';
    game.events.find(event => event.id === 'e10').coachComment = '@20 This should not match #2.';
    await window.__statsApp.store.saveGame(game);
    await window.__statsApp.setupController.openGame(game.id);
  });

  await page.locator('#feedbackPlayer').selectOption('p2');
  await expect(page.locator('#playerFeedbackList .player-feedback-item')).toHaveCount(2);
  await expect(page.locator('.player-feedback-comment')).toHaveText([
    '@2 Close out earlier.',
    '@TEAM Sprint back together.'
  ]);

  await page.locator('#feedbackPlayer').selectOption('p3');
  await expect(page.locator('#playerFeedbackList .player-feedback-item')).toHaveCount(1);
  await expect(page.locator('.player-feedback-comment')).toHaveText('@TEAM Sprint back together.');
});
