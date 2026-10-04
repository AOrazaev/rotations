const { test, expect } = require('@playwright/test');

async function setVideoTime(page, seconds) {
  await page.evaluate(value => {
    window.__statsFakePlayer.current = value;
  }, seconds);
}

async function reportSnapshot(page) {
  return page.evaluate(() => ({
    score: document.querySelector('#reportFinalScore').textContent,
    teams: [...document.querySelectorAll('#teamComparisonBody tr')].map(row => row.textContent),
    players: [...document.querySelectorAll('#playerReportBody tr')].map(row => row.textContent),
    lineups: [...document.querySelectorAll('#lineupReportBody tr')].map(row => row.textContent),
    progression: [...document.querySelectorAll('#scoreProgression [data-report-event-id]')]
      .map(item => item.getAttribute('aria-label')),
  }));
}

test('complete MVP workflow survives reload and backup recovery', async ({ page }) => {
  const databaseName = `basketball-stats-release-${Date.now()}-${Math.random()}`;
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

  await page.goto('/');
  await page.locator('.player-row').filter({ hasText: 'Yedil' }).click();
  await expect.poll(() => page.evaluate(() => state.players.filter(player => player.present).length)).toBe(8);
  await page.locator('#startStatsReview').click();
  await page.waitForURL('**/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await expect(page.locator('.setup-player')).toHaveCount(8);

  await page.locator('#gameTitle').fill('Release gate game');
  await page.locator('#opponentName').fill('Falcons');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#gamesStatus')).toContainText('Saved Release gate game');
  await expect(page.locator('#eventLockMessage')).toBeHidden();
  await expect(page.locator('#currentLineup .player-select-button')).toHaveCount(5);
  await expect(page.locator('#benchPlayers .player-chip')).toHaveCount(3);

  const starters = await page.locator('#currentLineup .player-select-button').evaluateAll(buttons =>
    buttons.map(button => button.dataset.playerId)
  );
  const bench = await page.locator('#benchPlayers .player-chip').evaluateAll(chips =>
    chips.map(chip => chip.dataset.playerId)
  );
  expect(starters).toHaveLength(5);
  expect(bench).toHaveLength(3);

  await setVideoTime(page, 10);
  await page.locator(`#currentLineup [data-player-id="${starters[0]}"]`).click();
  await page.locator('[data-event-type="shot"][data-shot-value="2"][data-made="true"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);

  await setVideoTime(page, 11);
  await page.locator(`#currentLineup [data-player-id="${starters[1]}"]`).click();
  await page.locator('[data-event-type="assist"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(2);

  await setVideoTime(page, 20);
  await page.locator('[data-event-side="opponent"]').click();
  await page.locator('[data-event-type="shot"][data-shot-value="3"][data-made="false"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(3);

  await setVideoTime(page, 21);
  await page.locator(`#currentLineup [data-player-id="${starters[2]}"]`).click();
  await page.locator('[data-event-type="rebound"][data-rebound-kind="defensive"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(4);

  await setVideoTime(page, 30);
  await page.locator('[data-event-side="opponent"]').click();
  await page.locator('[data-event-type="shot"][data-shot-value="3"][data-made="true"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(5);

  await setVideoTime(page, 40);
  await page.locator('#openSubstitution').click();
  await page.locator('#substitutionPlayerOut').selectOption(starters[4]);
  await page.locator('#substitutionPlayerIn').selectOption(bench[0]);
  await page.locator('#substitutionForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(6);

  await setVideoTime(page, 50);
  await page.locator(`#currentLineup [data-player-id="${bench[0]}"]`).click();
  await page.locator('[data-event-type="shot"][data-shot-value="3"][data-made="true"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(7);

  const assistEvent = page.locator('.event-list-item').filter({ hasText: 'assist' });
  await assistEvent.locator('[data-action="edit-event"]').click();
  await page.locator('[data-time-adjust="1"]').click();
  await page.locator('#eventEditForm button[type="submit"]').click();

  const missedThree = page.locator('.event-list-item').filter({ hasText: 'Opponent missed 3PT' });
  await missedThree.locator('[data-action="edit-event"]').click();
  await page.locator('#editShotMade').selectOption('true');
  await page.locator('#eventEditForm button[type="submit"]').click();

  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  const eventTimes = page.locator('.event-time');
  for (let index = 0; index < await eventTimes.count(); index += 1) {
    await eventTimes.nth(index).click();
  }
  await expect.poll(() => page.evaluate(() => window.__statsFakePlayer.calls.length)).toBe(14);

  await page.reload();
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('#reportFinalScore')).toHaveText('5–6');
  await expect(page.locator('#teamComparisonBody tr[data-side="team"] [data-metric="fieldGoals"]')).toContainText('2/2 (100%)');
  await expect(page.locator('#teamComparisonBody tr[data-side="opponent"] [data-metric="threePoint"]')).toContainText('2/2 (100%)');
  await expect(page.locator(`#playerReportBody tr[data-player-id="${starters[0]}"] .player-points`)).toHaveText('2');
  await expect(page.locator(`#playerReportBody tr[data-player-id="${starters[1]}"] .player-assists`)).toHaveText('1');
  await expect(page.locator(`#playerReportBody tr[data-player-id="${starters[2]}"] .player-defensive-rebounds`)).toHaveText('1');
  await expect(page.locator(`#playerReportBody tr[data-player-id="${bench[0]}"] .player-points`)).toHaveText('3');
  await expect(page.locator(`#currentLineup [data-player-id="${bench[0]}"]`)).toHaveCount(1);
  await expect(page.locator(`#benchPlayers [data-player-id="${starters[4]}"]`)).toHaveCount(1);

  const beforeBackup = await reportSnapshot(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('[data-action="export-game"]').click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="delete-game"]').click();
  await expect(page.locator('.game-list-item')).toHaveCount(0);
  await page.locator('#importGameBackupFile').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.concat(chunks)
  });
  await expect(page.locator('#gamesStatus')).toContainText('Imported Release gate game from backup');
  await page.locator('[data-action="open-game"]').click();
  expect(await reportSnapshot(page)).toEqual(beforeBackup);
});
