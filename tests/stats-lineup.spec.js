const { test, expect } = require('@playwright/test');

async function openLineupGame(page) {
  const databaseName = `basketball-stats-lineup-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 40,
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; },
      play() {},
      pause() {},
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
  }, databaseName);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('#addSetupPlayer').click();
  await page.locator('#gameTitle').fill('Lineup game');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#gamesStatus')).toContainText('Saved Lineup game');
  await expect(page.locator('#eventLockMessage')).toBeHidden();
  await expect(page.locator('#currentLineup .player-chip')).toHaveCount(5);
  await expect(page.locator('#benchPlayers .player-chip')).toHaveCount(1);
}

async function currentAndBenchIds(page) {
  return page.evaluate(() => ({
    active: [...document.querySelectorAll('#currentLineup .player-chip')].map(item => item.dataset.playerId),
    bench: [...document.querySelectorAll('#benchPlayers .player-chip')].map(item => item.dataset.playerId)
  }));
}

async function recordSubstitution(page, playerOutId, playerInId, seconds = 40) {
  await page.evaluate(value => { window.__statsFakePlayer.current = value; }, seconds);
  await page.locator('#openSubstitution').click();
  await page.locator('#substitutionPlayerOut').selectOption(playerOutId);
  await page.locator('#substitutionPlayerIn').selectOption(playerInId);
  await page.locator('#substitutionForm button[type="submit"]').click();
  await expect(page.locator('#substitutionDialog')).not.toHaveAttribute('open', '');
}

test('records a valid substitution and attributes later events to the new lineup', async ({ page }) => {
  await openLineupGame(page);
  const before = await currentAndBenchIds(page);
  expect(before.active).toHaveLength(5);
  expect(before.bench).toHaveLength(1);

  await page.locator('#openSubstitution').click();
  const outgoingOptions = await page.locator('#substitutionPlayerOut option').evaluateAll(options => options.map(option => option.value));
  const incomingOptions = await page.locator('#substitutionPlayerIn option').evaluateAll(options => options.map(option => option.value));
  expect(outgoingOptions).toEqual(before.active);
  expect(incomingOptions).toEqual(before.bench);
  expect(outgoingOptions.some(id => incomingOptions.includes(id))).toBe(false);
  await page.locator('#substitutionPlayerOut').selectOption(before.active[0]);
  await page.locator('#substitutionPlayerIn').selectOption(before.bench[0]);
  await page.locator('#substitutionForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);

  const after = await currentAndBenchIds(page);
  expect(after.active).toContain(before.bench[0]);
  expect(after.active).not.toContain(before.active[0]);
  expect(after.bench).toEqual([before.active[0]]);
  await expect(page.locator('.event-description')).toContainText('in for');
  await expect(page.locator('#currentLineup .player-select-button')).toHaveCount(5);
  expect(await page.locator(`#currentLineup [data-player-id="${before.bench[0]}"]`).count()).toBe(1);
  expect(await page.locator(`#currentLineup [data-player-id="${before.active[0]}"]`).count()).toBe(0);

  await page.evaluate(() => { window.__statsFakePlayer.current = 50; });
  await page.locator(`#currentLineup [data-player-id="${before.bench[0]}"]`).click();
  await page.locator('[data-event-type="assist"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(2);
  const game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  const expectedLineup = before.active.map(id => id === before.active[0] ? before.bench[0] : id);
  expect(game.events[0]).toMatchObject({
    type: 'substitution',
    playerOutId: before.active[0],
    playerInId: before.bench[0],
    lineupIds: expectedLineup
  });
  expect(game.events[1]).toMatchObject({
    type: 'assist',
    playerId: before.bench[0],
    lineupIds: expectedLineup
  });
});

test('editing and deleting an earlier substitution rebuilds every later lineup snapshot', async ({ page }) => {
  await openLineupGame(page);
  const before = await currentAndBenchIds(page);
  await recordSubstitution(page, before.active[0], before.bench[0]);

  await page.evaluate(() => { window.__statsFakePlayer.current = 50; });
  await page.locator('[data-event-side="opponent"]').click();
  await page.locator('[data-event-type="shot"][data-shot-value="2"][data-made="false"]').click();

  const substitutionEvent = page.locator('.event-list-item').filter({ hasText: 'in for' });
  await substitutionEvent.locator('[data-action="edit-event"]').click();
  await expect(page.locator('#editSubstitutionFields')).toBeVisible();
  await expect(page.locator('#editEventType')).toBeDisabled();
  await page.locator('#editPlayerOut').selectOption(before.active[1]);
  await page.locator('#editPlayerIn').selectOption(before.bench[0]);
  await page.locator('#eventEditForm button[type="submit"]').click();
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__statsApp.eventController.getGame());
    return current.events.find(event => event.type === 'substitution')?.playerOutId;
  }).toBe(before.active[1]);

  let game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  const laterEvent = game.events.find(event => event.type === 'shot');
  expect(laterEvent.lineupIds).toContain(before.active[0]);
  expect(laterEvent.lineupIds).not.toContain(before.active[1]);
  expect(laterEvent.lineupIds).toContain(before.bench[0]);

  page.once('dialog', dialog => dialog.accept());
  await page.locator('.event-list-item').filter({ hasText: 'in for' }).locator('[data-action="delete-event"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  expect(game.events).toHaveLength(1);
  expect(game.events[0].lineupIds).toEqual(game.startingLineupIds);
  expect((await currentAndBenchIds(page)).active).toEqual(game.startingLineupIds);

  await page.reload();
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('#currentLineup .player-chip')).toHaveCount(5);
  expect((await currentAndBenchIds(page)).active).toEqual(game.startingLineupIds);
});

test('planner imports preserve planned rotation without crowding event entry', async ({ page }) => {
  const databaseName = `basketball-stats-planned-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => { window.__STATS_DATABASE_NAME__ = name; }, databaseName);
  await page.goto('/');
  await page.locator('#generate').click();
  await page.locator('#startStatsReview').click();
  await page.waitForURL('**/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('#gameTitle').fill('Planned lineup game');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();

  await expect(page.getByText('Planned reference')).toHaveCount(0);
  const saved = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(saved.plannedRotation.blocks).toHaveLength(10);
});
