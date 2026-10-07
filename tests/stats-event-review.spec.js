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

async function clickEditCourtAt(page, x, y) {
  const court = page.locator('#editShotDetails .shot-court-svg');
  await court.scrollIntoViewIfNeeded();
  const box = await court.boundingBox();
  await court.click({
    position: {
      x: box.width * x,
      y: box.height * y
    }
  });
}

async function clickCaptureCourtAt(page, x, y) {
  const court = page.locator('#shotDetailsCapture .shot-court-svg');
  await court.scrollIntoViewIfNeeded();
  const box = await court.boundingBox();
  await court.click({
    position: {
      x: box.width * x,
      y: box.height * y
    }
  });
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

test('locates the closest visible event without changing playback or selection', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]', 10);
  await addTeamEvent(page, '[data-event-type="assist"]', 20);
  await addTeamEvent(page, '[data-event-type="block"]', 40);
  await page.evaluate(() => {
    window.__statsFakePlayer.current = 30;
    window.__statsFakePlayer.calls = [];
    window.__timelineLocateScroll = null;
    const eventList = document.querySelector('#eventList');
    eventList.style.height = '60px';
    eventList.style.overflowY = 'auto';
    eventList.scrollTo = options => {
      window.__timelineLocateScroll = options;
    };
  });

  const selected = page.locator('.event-list-item').filter({ hasText: 'block' });
  await selected.locator('.event-description').click();
  await page.evaluate(() => { window.__pageScrollBeforeLocate = window.scrollY; });
  await page.locator('#locateTimelineEvent').evaluate(button => button.click());

  const located = page.locator('.event-list-item').filter({ hasText: 'assist' });
  await expect(located).toHaveClass(/located-event/);
  await expect(located.locator('.event-description')).toBeFocused();
  await expect(selected).toHaveClass(/selected-event/);
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([]);
  expect(await page.evaluate(() => window.__statsFakePlayer.current)).toBe(30);
  expect(await page.evaluate(() => window.__timelineLocateScroll.behavior)).toBe('smooth');
  expect(await page.evaluate(() => window.__timelineLocateScroll.top)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(
    await page.evaluate(() => window.__pageScrollBeforeLocate)
  );

  await page.locator('#openEventFilters').click();
  await page.locator('input[name="filterType"][value="block"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await page.evaluate(() => { window.__timelineLocateScroll = null; });
  await page.locator('#locateTimelineEvent').evaluate(button => button.click());
  await expect(page.locator('.event-list-item').filter({ hasText: 'block' })).toHaveClass(/located-event/);
  expect(await page.evaluate(() => window.__timelineLocateScroll)).not.toBeNull();
});

test('selected timeline events can be shifted together by one second', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]', 10);
  for (let index = 1; index < 3; index += 1) {
    await page.evaluate(value => { window.__statsFakePlayer.current = value; }, 10 + index * 10);
    await page.locator('[data-event-type="steal"]').click();
  }
  await expect(page.locator('.event-list-item')).toHaveCount(3);

  const descriptions = page.locator('.event-description');
  await descriptions.first().click();
  await descriptions.nth(1).click({ modifiers: ['Control'] });
  const toolbar = page.locator('#eventSelectionToolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('.event-selection-count')).toHaveText('2 events selected');
  await expect(page.locator('.event-list-item.selected-event')).toHaveCount(2);

  await toolbar.getByRole('button', { name: 'Move selected events one second earlier' }).click();
  await expect(page.locator('.event-time')).toHaveText(['0:29.0', '0:19.0', '0:10.0']);
  await expect.poll(() => page.evaluate(async () => (
    await window.__statsApp.store.listGames()
  )[0].events.map(event => event.videoSeconds))).toEqual([10, 19, 29]);

  await descriptions.first().click();
  await descriptions.nth(2).click({ modifiers: ['Shift'] });
  await expect(toolbar.locator('.event-selection-count')).toHaveText('3 events selected');
  await toolbar.getByRole('button', { name: 'Move selected events one second later' }).click();
  await expect.poll(() => page.evaluate(async () => (
    await window.__statsApp.store.listGames()
  )[0].events.map(event => event.videoSeconds))).toEqual([11, 20, 30]);
});

test('desktop tracker scrolls only timeline events in the capture panel', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]', 10);
  for (let index = 1; index < 24; index += 1) {
    await page.evaluate(value => { window.__statsFakePlayer.current = value; }, 10 + index);
    await page.locator('[data-event-type="steal"]').click();
  }
  await expect(page.locator('.event-list-item')).toHaveCount(24);

  const overflow = await page.locator('.capture-panel, #eventList').evaluateAll(elements =>
    elements.map(element => ({
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }))
  );
  expect(overflow[0].overflowY).toBe('hidden');
  expect(overflow[1].overflowY).toBe('auto');
  expect(overflow[1].scrollHeight).toBeGreaterThan(overflow[1].clientHeight);

  const before = await page.locator('#eventEntryPanel, #eventLogPanel .section-head').evaluateAll(
    elements => elements.map(element => element.getBoundingClientRect().top)
  );
  await page.locator('#eventList').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await page.locator('#eventList').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('.capture-panel').evaluate(element => element.scrollTop)).toBe(0);
  const after = await page.locator('#eventEntryPanel, #eventLogPanel .section-head').evaluateAll(
    elements => elements.map(element => element.getBoundingClientRect().top)
  );
  expect(after).toEqual(before);
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

test('existing field goals can add, edit, and clear structured shot details', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="3"][data-made="true"]');
  await page.locator('#closeShotLocation').click();

  await page.locator('[data-action="edit-event"]').click();
  await expect(page.locator('#editShotDetailsFields')).toBeVisible();
  await clickEditCourtAt(page, 0.06, 0.21);
  await page.locator('#editShotDetails [data-shot-detail-field="pressure"][data-value="lightly_contested"]').click();
  await page.locator('#editShotDetails [data-shot-detail-field="phase"][data-value="half_court"]').click();
  await page.locator('#editShotDetails [data-shot-detail-field="contexts"][data-value="second_chance"]').click();
  await page.locator('#editShotDetails [data-shot-detail-field="creation"][data-value="cut"]').click();
  await page.locator('#eventEditForm button[type="submit"]').click();
  await expect(page.locator('#eventEditDialog')).not.toHaveAttribute('open', '');
  await expect(page.locator('.event-detail-badge')).toHaveText([
    'Left corner 3',
    'Lightly contested',
    'Half court',
    'Second chance',
    'Cut'
  ]);

  let shot = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(shot.shotDetails).toMatchObject({
    location: { x: expect.closeTo(0.06, 2), y: expect.closeTo(0.21, 2) },
    pressure: 'lightly_contested',
    phase: 'half_court',
    contexts: ['second_chance'],
    creation: 'cut'
  });

  await page.locator('[data-action="edit-event"]').click();
  await expect(page.locator('#editShotDetails [data-shot-detail-field="pressure"][data-value="lightly_contested"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editShotDetails .shot-court-marker')).toBeVisible();
  await page.locator('#editShotMade').selectOption('false');
  await page.locator('#editShotDetails [data-shot-detail-field="pressure"][data-value="contested"]').click();
  await page.locator('#editShotDetails [data-shot-details-action="clear-location"]').click();
  await expect(page.locator('#editShotDetails [data-shot-detail-field="pressure"][data-value="contested"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#editShotDetails [data-shot-detail-field="pressure"][data-value="lightly_contested"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#editShotDetails .shot-court-marker')).toBeHidden();
  await page.locator('#eventEditForm button[type="submit"]').click();
  await expect(page.locator('#eventEditDialog')).not.toHaveAttribute('open', '');
  await expect(page.locator('.event-detail-badge')).toHaveText([
    'Contested',
    'Half court',
    'Second chance',
    'Cut'
  ]);

  shot = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(shot.shotDetails).toEqual({
    pressure: 'contested',
    phase: 'half_court',
    contexts: ['second_chance'],
    creation: 'cut'
  });
  expect(shot.made).toBe(false);
});

test('shot-detail filters combine stored and derived dimensions including untagged values', async ({ page }) => {
  await openReview(page);

  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="3"][data-made="true"]', 20);
  await clickCaptureCourtAt(page, 0.06, 0.21);
  await page.locator('#shotDetailsCapture [data-shot-detail-field="pressure"][data-value="open"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="phase"][data-value="half_court"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="contexts"][data-value="second_chance"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="creation"][data-value="cut"]').click();
  await page.locator('#closeShotLocation').click();

  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="2"][data-made="false"]', 30);
  await page.locator('#closeShotLocation').click();

  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="2"][data-made="true"]', 40);
  await page.locator('#shotDetailsCapture [data-shot-detail-field="pressure"][data-value="contested"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="phase"][data-value="transition"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="creation"][data-value="drive"]').click();
  await page.locator('#closeShotLocation').click();
  await addTeamEvent(page, '[data-event-type="assist"]', 50);
  await expect(page.locator('.event-list-item')).toHaveCount(4);

  await page.locator('#openEventFilters').click();
  await expect(page.locator('#shotFilterDetails')).not.toHaveAttribute('open', '');
  await page.locator('#shotFilterDetails summary').click();
  await page.locator('input[name="filterShotZone"][value="left_corner_three"]').check();
  await page.locator('input[name="filterShotPressure"][value="open"]').check();
  await page.locator('input[name="filterShotPhase"][value="half_court"]').check();
  await page.locator('input[name="filterShotContext"][value="second_chance"]').check();
  await page.locator('input[name="filterShotCreation"][value="cut"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-time')).toHaveText('0:20.0');
  await expect(page.locator('#eventFilterCount')).toHaveText('5');

  await page.locator('#openEventFilters').click();
  await expect(page.locator('#shotFilterDetails')).toHaveAttribute('open', '');
  await expect(page.locator('#shotFilterSelectionCount')).toHaveText('5 selected');
  await page.locator('#clearEventFilters').click();
  await expect(page.locator('#shotFilterDetails')).not.toHaveAttribute('open', '');
  await page.locator('#shotFilterDetails summary').click();
  await page.locator('input[name="filterShotPressure"][value="__untagged__"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-time')).toHaveText('0:30.0');

  await page.locator('#openEventFilters').click();
  await page.locator('#clearEventFilters').click();
  await page.locator('#shotFilterDetails summary').click();
  await page.locator('input[name="filterShotZone"][value="__untagged__"]').check();
  await page.locator('input[name="filterShotPressure"][value="contested"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-time')).toHaveText('0:40.0');
  await expect(page.locator('#eventFilterCount')).toHaveText('2');
});

test('shot-location mismatch confirmation can keep or change the recorded value', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="2"][data-made="true"]');
  await page.locator('#closeShotLocation').click();

  await page.locator('[data-action="edit-event"]').click();
  await clickEditCourtAt(page, 0.02, 0.21);
  page.once('dialog', dialog => {
    expect(dialog.message()).toContain('Change the event to 3PT');
    dialog.dismiss();
  });
  await page.locator('#eventEditForm button[type="submit"]').click();
  await expect(page.locator('#eventEditDialog')).not.toHaveAttribute('open', '');

  let shot = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(shot.shotValue).toBe(2);
  expect(shot.shotDetails.location.x).toBeCloseTo(0.02, 2);

  await page.locator('[data-action="edit-event"]').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#eventEditForm button[type="submit"]').click();
  await expect(page.locator('#eventEditDialog')).not.toHaveAttribute('open', '');

  shot = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(shot.shotValue).toBe(3);
  await expect(page.locator('.event-description')).toContainText('made 3PT');
});

test('changing an enriched field goal requires confirmation before discarding details', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="2"][data-made="true"]');
  await page.locator('#shotDetailsCapture [data-shot-detail-field="pressure"][data-value="open"]').click();
  await expect.poll(async () => {
    const shot = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return shot.shotDetails?.pressure;
  }).toBe('open');
  await page.locator('#closeShotLocation').click();

  await page.locator('[data-action="edit-event"]').click();
  await page.locator('#editEventType').selectOption('rebound');
  await page.locator('#editReboundKind').selectOption('defensive');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#eventEditForm button[type="submit"]').click();
  await expect(page.locator('#eventEditDialog')).toHaveAttribute('open', '');
  expect((await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0].type).toBe('shot');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#eventEditForm button[type="submit"]').click();
  await expect(page.locator('#eventEditDialog')).not.toHaveAttribute('open', '');
  const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event).toMatchObject({ type: 'rebound', reboundKind: 'defensive' });
  expect(event).not.toHaveProperty('shotDetails');
});

test('shot-detail correction remains contained in the edit dialog on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="3"][data-made="false"]');
  await page.locator('#closeShotLocation').click();
  await page.locator('[data-action="edit-event"]').click();

  const boxes = await page.locator('#eventEditDialog, #editShotDetails .shot-court-svg').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right };
    })
  );
  expect(boxes[1].left).toBeGreaterThanOrEqual(boxes[0].left);
  expect(boxes[1].right).toBeLessThanOrEqual(boxes[0].right);
  const overflow = await page.locator('#editShotDetails').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test('shot-detail badges wrap within mobile timeline rows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="shot"][data-shot-value="3"][data-made="true"]');
  await page.locator('#shotDetailsCapture [data-shot-detail-field="pressure"][data-value="heavily_contested"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="phase"][data-value="transition"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="contexts"][data-value="second_chance"]').click();
  await page.locator('#shotDetailsCapture [data-shot-detail-field="creation"][data-value="catch_and_shoot"]').click();
  await page.locator('#closeShotLocation').click();

  await expect(page.locator('.event-detail-badge')).toHaveText([
    'Heavily contested',
    'Transition',
    'Second chance',
    'Catch-and-shoot'
  ]);
  const overflow = await page.locator('.event-list-item').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
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

test('timeline ordering toggles between latest and earliest events first', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]', 20);
  await addTeamEvent(page, '[data-event-type="assist"]', 40);

  await expect(page.locator('.event-time')).toHaveText(['0:40.0', '0:20.0']);
  await expect(page.locator('#eventOrderDescription')).toHaveText('Latest first.');
  await expect(page.locator('#toggleEventOrder')).toHaveAttribute('aria-label', 'Show earliest events first');

  await page.locator('#toggleEventOrder').click();
  await expect(page.locator('.event-time')).toHaveText(['0:20.0', '0:40.0']);
  await expect(page.locator('#eventOrderDescription')).toHaveText('Earliest first.');
  await expect(page.locator('#toggleEventOrder')).toHaveAttribute('aria-label', 'Show latest events first');

  await page.locator('#toggleEventOrder').click();
  await expect(page.locator('.event-time')).toHaveText(['0:40.0', '0:20.0']);
  await expect(page.locator('#eventOrderDescription')).toHaveText('Latest first.');
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

test('coach comments can be added, edited, displayed as quotes, and removed', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]');

  await page.locator('[data-action="comment-event"]').click();
  await page.locator('#coachCommentText').fill('Excellent help defense.');
  await page.locator('#coachCommentForm button[type="submit"]').click();

  const comment = page.locator('.coach-comment');
  await expect(comment).toBeVisible();
  await expect(comment).toHaveText('Excellent help defense.');
  await expect(page.locator('[data-action="comment-event"]')).toHaveAttribute('aria-label', 'Edit coach comment');

  await page.locator('[data-action="comment-event"]').click();
  await page.locator('#coachCommentText').fill('Excellent help defense and recovery.');
  await page.locator('#coachCommentForm button[type="submit"]').click();
  await expect(comment).toHaveText('Excellent help defense and recovery.');

  let event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event.coachComment).toBe('Excellent help defense and recovery.');

  await page.locator('[data-action="comment-event"]').click();
  await page.locator('#removeCoachComment').click();
  await expect(comment).toBeHidden();
  await expect(page.locator('[data-action="comment-event"]')).toHaveAttribute('aria-label', 'Add coach comment');

  event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event).not.toHaveProperty('coachComment');
});

test('timeline filters combine side, type, player, and coach comment selections', async ({ page }) => {
  await openReview(page);
  const playerId = await addTeamEvent(page, '[data-event-type="steal"]', 20);

  await page.locator('[data-action="comment-event"]').click();
  await page.locator('#coachCommentText').fill('Strong defensive read.');
  await page.locator('#coachCommentForm button[type="submit"]').click();

  await page.locator('[data-event-side="opponent"]').click();
  await page.locator('[data-event-type="turnover"]').click();
  await page.locator('#openNote').click();
  await page.locator('#noteText').fill('Review transition spacing');
  await page.locator('#noteForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(3);

  await page.locator('#openEventFilters').click();
  await page.locator('input[name="filterSide"][value="team"]').check();
  await page.locator('input[name="filterType"][value="steal"]').check();
  await page.locator(`input[name="filterPlayer"][value="${playerId}"]`).check();
  await page.locator('input[name="filterComment"][value="with"]').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();

  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-description')).toContainText('steal');
  await expect(page.locator('#openEventFilters')).toHaveAttribute('aria-label', 'Filter timeline, 4 active');
  await expect(page.locator('#eventFilterCount')).toHaveText('4');
  await expect(page.locator('#copyFilteredReviewLink')).toBeHidden();
  await expect(page.locator('#activeEventFilters .filter-chip-label')).toHaveText([
    'Our team',
    'Steal',
    'Player 1',
    'With comment'
  ]);
  await page.locator('.filter-chip[data-filter-group="types"][data-filter-value="steal"]').click();
  await expect(page.locator('#eventFilterCount')).toHaveText('3');
  await expect(page.locator('#activeEventFilters .filter-chip-label', { hasText: 'Steal' })).toHaveCount(0);

  await page.locator('#openEventFilters').click();
  await page.locator('#clearEventFilters').click();
  await expect(page.locator('#eventFilterDialog')).toHaveAttribute('open', '');
  await expect(page.locator('.event-list-item')).toHaveCount(3);
  await expect(page.locator('#eventFilterCount')).toBeHidden();
  await page.locator('#cancelEventFilters').click();
});

test('timeline can filter coach comments that mention the whole team', async ({ page }) => {
  await openReview(page);
  await addTeamEvent(page, '[data-event-type="steal"]', 20);
  await page.locator('[data-action="comment-event"]').click();
  await page.locator('#coachCommentText').fill('@team Review our defensive spacing.');
  await page.locator('#coachCommentForm button[type="submit"]').click();

  await addTeamEvent(page, '[data-event-type="assist"]', 30);
  await page.locator('.event-list-item').filter({ hasText: 'assist' })
    .locator('[data-action="comment-event"]').click();
  await page.locator('#coachCommentText').fill('Good pass.');
  await page.locator('#coachCommentForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(2);

  await page.locator('#openEventFilters').click();
  await page.locator('#filterTeamMention').check();
  await page.locator('#eventFilterForm button[type="submit"]').click();

  await expect(page.locator('.event-list-item')).toHaveCount(1);
  await expect(page.locator('.event-description')).toContainText('steal');
  await expect(page.locator('.coach-comment')).toHaveText('@team Review our defensive spacing.');
  await expect(page.locator('#openEventFilters')).toHaveAttribute('aria-label', 'Filter timeline, 1 active');
});
