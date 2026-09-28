const { test, expect } = require('@playwright/test');

async function openReview(page) {
  const databaseName = `basketball-stats-review-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 42.4,
      calls: [],
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; this.calls.push(['seek', seconds]); },
      play() { this.calls.push(['play']); },
      pause() { this.calls.push(['pause']); },
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
  }, databaseName);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('#gameTitle').fill('Review game');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#gamesStatus')).toContainText('Saved Review game');
  await expect(page.locator('#eventLockMessage')).toBeHidden();
}

async function addTeamEvent(page, selector, seconds = null) {
  if (seconds !== null) {
    await page.evaluate(value => { window.__statsFakePlayer.current = value; }, seconds);
  }
  const button = page.locator('#currentLineup .player-select-button').first();
  const playerId = await button.getAttribute('data-player-id');
  await button.click();
  await page.locator(selector).click();
  return playerId;
}

test('event timestamp plays with a three-second pre-roll', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]');
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });

  await page.locator('.event-time').click();
  await expect(page.locator('[data-action="preview-event"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 39.4],
    ['play']
  ]);
});

test('editing a made shot to missed immediately recalculates and persists stats', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="3"][data-made="true"]');
  await expect(page.locator('#teamScore')).toHaveText('3');

  await page.locator('[data-action="edit-event"]').click();
  await page.locator('#editShotMade').selectOption('false');
  await page.locator('#eventEditForm button[type="submit"]').click();

  await expect(page.locator('#eventEditDialog')).not.toHaveAttribute('open', '');
  await expect(page.locator('#teamScore')).toHaveText('0');
  await expect(page.locator('#teamFieldGoals')).toHaveText('0/1');
  await expect(page.locator('.event-description')).toContainText('missed 3PT');
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(stored.events[0].made).toBe(false);
});

test('changing an event to opponent attribution moves its score and removes player attribution', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="2"][data-made="true"]');

  await page.locator('[data-action="edit-event"]').click();
  await page.locator('#editEventSide').selectOption('opponent');
  await expect(page.locator('#editEventPlayer')).toBeDisabled();
  await page.locator('#eventEditForm button[type="submit"]').click();

  await expect(page.locator('#teamScore')).toHaveText('0');
  await expect(page.locator('#opponentScore')).toHaveText('2');
  const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event.side).toBe('opponent');
  expect(event.playerId).toBeNull();
});

test('using current video time reorders display without changing insertion sequence', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]', 50);
  await addTeamEvent(page, '[data-event-type="assist"]', 60);

  await page.locator('.event-list-item').first().locator('[data-action="edit-event"]').click();
  await page.locator('[data-time-adjust="-5"]').click();
  await expect(page.locator('#editEventTimestamp')).toHaveText('0:55.0');
  await page.evaluate(() => { window.__statsFakePlayer.current = 40; });
  await page.locator('#useCurrentEventTime').click();
  await expect(page.locator('#editEventTimestamp')).toHaveText('0:40.0');
  await page.locator('#eventEditForm button[type="submit"]').click();

  await expect(page.locator('.event-time')).toHaveText(['0:50.0', '0:40.0']);
  await expect(page.locator('.event-description').last()).toContainText('assist');
  const events = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events;
  expect(events.map(event => event.sequence)).toEqual([1, 2]);
  expect(events[1].videoSeconds).toBe(40);

  await page.reload();
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('[data-action="open-game"]').click();
  await expect(page.locator('.event-time')).toHaveText(['0:50.0', '0:40.0']);
});

test('event type can be corrected with type-specific fields', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]');
  await page.locator('[data-action="edit-event"]').click();
  await page.locator('#editEventType').selectOption('rebound');
  await expect(page.locator('#editReboundFields')).toBeVisible();
  await page.locator('#editReboundKind').selectOption('defensive');
  await page.locator('#eventEditForm button[type="submit"]').click();

  await expect(page.locator('.event-description')).toContainText('defensive rebound');
  const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event).toMatchObject({ type: 'rebound', reboundKind: 'defensive' });
  expect(event).not.toHaveProperty('made');
  expect(event).not.toHaveProperty('shotValue');
});

test('deleting an event removes its statistical contribution', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="2"][data-made="true"]');
  await expect(page.locator('#teamScore')).toHaveText('2');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-action="delete-event"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(0);
  await expect(page.locator('#teamScore')).toHaveText('0');
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(stored.events).toHaveLength(0);
});

test('failed correction storage leaves the original event unchanged', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="2"][data-made="true"]');
  await page.locator('[data-action="edit-event"]').click();
  await page.locator('#editShotMade').selectOption('false');
  await page.evaluate(() => {
    window.__statsOriginalSaveGame = window.__statsApp.store.saveGame;
    window.__statsApp.store.saveGame = async () => { throw new Error('Simulated storage failure.'); };
  });
  await page.locator('#eventEditForm button[type="submit"]').click();

  await expect(page.locator('#eventEditError')).toContainText('Simulated storage failure');
  await expect(page.locator('#eventEditDialog')).toHaveAttribute('open', '');
  await expect(page.locator('#teamScore')).toHaveText('2');
  const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event.made).toBe(true);
});

test('failed current-time lookup leaves the original timestamp unchanged', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]');
  await page.locator('[data-action="edit-event"]').click();
  await page.evaluate(() => {
    window.__statsApp.videoController.getCurrentSeconds = () => {
      throw new Error('Simulated player read failure.');
    };
  });
  await page.locator('#useCurrentEventTime').click();
  await expect(page.locator('#eventEditError')).toContainText('Simulated player read failure');
  await expect(page.locator('#editEventTimestamp')).toHaveText('0:42.4');
  await page.locator('#cancelEventEdit').click();
  const stored = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0]);
  expect(stored.events[0].videoSeconds).toBe(42.4);
});

test('locked state explains whether a game or recording is required', async ({ page }) => {
  const databaseName = `basketball-stats-lock-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__STATS_PLAYER_FACTORY__ = async () => {
      throw new Error('Simulated unavailable recording.');
    };
  }, databaseName);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await expect(page.locator('#workspace')).toBeHidden();

  await page.locator('#gameTitle').fill('Locked state');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#eventLockMessage')).toContainText('loading or unavailable');
  await expect(page.locator('#retryVideo')).toBeVisible();
  await expect(page.locator('.event-action').first()).toBeDisabled();
});

test('timeout ownership and period labels can be corrected from the timeline', async ({ page }) => {
  await openReview(page);
  await page.locator('[data-event-type="timeout"]').click();
  await page.locator('#openPeriodEnd').click();
  await page.locator('#periodEndLabel').fill('End of Q1');
  await page.locator('#periodEndForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(2);

  await page.locator('.event-list-item').filter({ hasText: 'timeout' }).locator('[data-action="edit-event"]').click();
  await expect(page.locator('#editEventType')).toBeDisabled();
  await page.locator('#editEventSide').selectOption('opponent');
  await page.locator('#eventEditForm button[type="submit"]').click();

  await page.locator('.event-list-item').filter({ hasText: 'End of Q1' }).locator('[data-action="edit-event"]').click();
  await expect(page.locator('#editPeriodEndFields')).toBeVisible();
  await page.locator('#editPeriodLabel').fill('Halftime');
  await page.locator('#eventEditForm button[type="submit"]').click();

  await expect(page.locator('.event-description')).toHaveText(['Halftime', 'Opponent timeout']);
  const events = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events;
  expect(events[0]).toMatchObject({ type: 'timeout', side: 'opponent', playerId: null });
  expect(events[1]).toMatchObject({ type: 'period_end', side: 'system', periodLabel: 'Halftime' });
});

test('note text can be corrected from the timeline', async ({ page }) => {
  await openReview(page);
  await page.locator('#openNote').click();
  await page.locator('#noteText').fill('Initial note');
  await page.locator('#noteForm button[type="submit"]').click();

  await page.locator('[data-action="edit-event"]').click();
  await expect(page.locator('#editEventType')).toHaveValue('note');
  await expect(page.locator('#editEventType')).toBeDisabled();
  await expect(page.locator('#editNoteFields')).toBeVisible();
  await page.locator('#editNote').fill('Corrected note');
  await page.locator('#eventEditForm button[type="submit"]').click();

  await expect(page.locator('.event-description')).toHaveText('Corrected note');
  const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event).toMatchObject({ type: 'note', side: 'system', playerId: null, note: 'Corrected note' });
});
