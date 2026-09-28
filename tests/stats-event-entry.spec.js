const { test, expect } = require('@playwright/test');

async function openEventEntry(page, { playerFails = false } = {}) {
  const databaseName = `basketball-stats-events-${Date.now()}-${Math.random()}`;
  await page.addInitScript(({ name, fails }) => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 42.4,
      getCurrentSeconds() { return this.current; },
      seekTo() {},
      play() {},
      pause() {},
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => {
      if (fails) throw new Error('Simulated player failure.');
      return window.__statsFakePlayer;
    };
  }, { name: databaseName, fails: playerFails });
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('#gameTitle').fill('Event test');
  await page.locator('#opponentName').fill('Falcons');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#gamesStatus')).toContainText('Saved Event test');
  await page.locator('#videoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#loadVideo').click();
  return databaseName;
}

test('records a timestamped team event with selected player and active lineup', async ({ page }) => {
  await openEventEntry(page);
  const playerId = await page.locator('#eventPlayer option').nth(1).getAttribute('value');
  await page.locator('#eventPlayer').selectOption(playerId);
  await page.locator('[data-event-type="shot"][data-shot-value="2"][data-made="true"]').click();

  await expect(page.locator('#teamScore')).toHaveText('2');
  await expect(page.locator('#teamFieldGoals')).toHaveText('1/1');
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-description')).toContainText('made 2PT');

  const game = await page.evaluate(() => window.__statsApp.eventController.getGame());
  expect(game.events[0]).toMatchObject({
    sequence: 1,
    videoSeconds: 42.4,
    side: 'team',
    type: 'shot',
    playerId,
    shotValue: 2,
    made: true,
    lineupIds: game.startingLineupIds
  });
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(stored.events).toEqual(game.events);
});

test('team events require a player while opponent events remain team-level', async ({ page }) => {
  await openEventEntry(page);
  await page.locator('[data-event-type="turnover"]').click();
  await expect(page.locator('#eventError')).toContainText('Select one of our on-court players');
  expect((await page.evaluate(() => window.__statsApp.eventController.getGame())).events).toHaveLength(0);

  await page.locator('[data-event-side="opponent"]').click();
  await expect(page.locator('#eventPlayer')).toBeDisabled();
  await page.locator('[data-event-type="shot"][data-shot-value="3"][data-made="false"]').click();

  await expect(page.locator('#opponentScore')).toHaveText('0');
  await expect(page.locator('#opponentFieldGoals')).toHaveText('0/1');
  const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event).toMatchObject({
    side: 'opponent',
    playerId: null,
    shotValue: 3,
    made: false
  });
});

test('identical timestamps retain insertion sequence and survive reload', async ({ page }) => {
  await openEventEntry(page);
  const playerId = await page.locator('#eventPlayer option').nth(1).getAttribute('value');
  await page.locator('#eventPlayer').selectOption(playerId);
  await page.locator('[data-event-type="shot"][data-shot-value="2"][data-made="true"]').click();
  await page.locator('#eventPlayer').selectOption(playerId);
  await page.locator('[data-event-type="assist"]').click();

  let events = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events;
  expect(events.map(event => [event.videoSeconds, event.sequence])).toEqual([[42.4, 1], [42.4, 2]]);

  await page.reload();
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(2);
  events = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events;
  expect(events.map(event => event.sequence)).toEqual([1, 2]);
});

test('undo removes and persists only the latest entered event', async ({ page }) => {
  await openEventEntry(page);
  const playerId = await page.locator('#eventPlayer option').nth(1).getAttribute('value');
  await page.locator('#eventPlayer').selectOption(playerId);
  await page.locator('[data-event-type="shot"][data-shot-value="2"][data-made="true"]').click();
  await page.locator('[data-event-side="opponent"]').click();
  await page.locator('[data-event-type="shot"][data-shot-value="3"][data-made="true"]').click();
  await expect(page.locator('#teamScore')).toHaveText('2');
  await expect(page.locator('#opponentScore')).toHaveText('3');

  await page.locator('#undoEvent').click();
  await expect(page.locator('#teamScore')).toHaveText('2');
  await expect(page.locator('#opponentScore')).toHaveText('0');
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(stored.events.map(event => event.sequence)).toEqual([1]);
});

test('editing game setup after event entry preserves the event log', async ({ page }) => {
  await openEventEntry(page);
  const playerId = await page.locator('#eventPlayer option').nth(1).getAttribute('value');
  await page.locator('#eventPlayer').selectOption(playerId);
  await page.locator('[data-event-type="steal"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);

  await page.locator('#opponentName').fill('Updated opponent');
  await page.locator('#saveGame').click();
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(stored.opponentName).toBe('Updated opponent');
  expect(stored.events).toHaveLength(1);
  expect(stored.events[0]).toMatchObject({ type: 'steal', playerId });
});

test('player load failures cannot create partial events', async ({ page }) => {
  await openEventEntry(page, { playerFails: true });
  await expect(page.locator('#videoError')).toContainText('Simulated player failure');
  await expect(page.locator('#eventLockMessage')).toContainText('Load this game’s recording');
  await expect(page.locator('[data-event-type="shot"]').first()).toBeDisabled();
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(stored.events).toHaveLength(0);
});
