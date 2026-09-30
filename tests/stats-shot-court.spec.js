const { test, expect } = require('@playwright/test');

async function openShotEntry(page, { width = 1280, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 42.4,
      getCurrentSeconds() { return this.current; },
      seekTo() {},
      play() {},
      pause() {},
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
  }, `basketball-stats-shot-court-${Date.now()}-${Math.random()}`);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await page.locator('#gameTitle').fill('Shot court test');
  await page.locator('#opponentName').fill('Falcons');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#eventLockMessage')).toBeHidden();
  await page.locator('#currentLineup .player-select-button').first().click();
}

async function recordShot(page, { value = 3, made = true } = {}) {
  await page.locator(
    `[data-event-type="shot"][data-shot-value="${value}"][data-made="${made}"]`
  ).click();
  if (value === 1) return;
  await expect(page.locator('#shotLocationPanel')).toBeVisible();
}

async function clickCourtAt(page, x, y) {
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

test('field goals save immediately before optional court interaction', async ({ page }) => {
  await openShotEntry(page);
  await recordShot(page, { value: 3, made: true });

  const initialEvent = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(initialEvent).toMatchObject({ shotValue: 3, made: true });
  expect(initialEvent).not.toHaveProperty('shotDetails');
  await expect(page.locator('#shotLocationDescription')).toContainText('Made 3PT saved at 0:42.4');
  await expect(page.locator('#shotDetailsCapture .shot-court-status')).toContainText('No location selected');

  await clickCourtAt(page, 0.06, 0.21);
  await expect(page.locator('#shotDetailsCapture .shot-court-status')).toContainText('Left corner 3');
  await expect.poll(async () => {
    const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return event.shotDetails?.location;
  }).toMatchObject({ x: expect.closeTo(0.06, 2), y: expect.closeTo(0.21, 2) });

  const storedEvent = await page.evaluate(async () => (await window.__statsApp.store.listGames())[0].events[0]);
  expect(storedEvent.shotDetails.location.x).toBeCloseTo(0.06, 2);
  expect(storedEvent.shotDetails.location.y).toBeCloseTo(0.21, 2);

  page.once('dialog', dialog => dialog.accept());
  await clickCourtAt(page, 0.5, 0.5);
  await expect(page.locator('#shotDetailsCapture .shot-court-status')).toContainText('Long midrange');
  await expect.poll(async () => {
    const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return event.shotDetails?.location;
  }).toMatchObject({ x: expect.closeTo(0.5, 2), y: expect.closeTo(0.5, 2) });
  expect((await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0].shotValue).toBe(2);
});

test('court marker supports keyboard placement, movement, and clearing', async ({ page }) => {
  await openShotEntry(page);
  await recordShot(page, { value: 2, made: false });

  const court = page.locator('#shotDetailsCapture .shot-court-svg');
  await court.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#shotDetailsCapture .shot-court-marker')).toBeVisible();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowUp');

  await expect.poll(async () => {
    const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return event.shotDetails?.location;
  }).toEqual({ x: 0.55, y: 0.49 });

  await page.keyboard.press('Delete');
  await expect(page.locator('#shotDetailsCapture .shot-court-marker')).toBeHidden();
  await expect.poll(async () => {
    const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return event.shotDetails;
  }).toBeUndefined();
});

test('clear and done preserve a saved event while controlling the optional panel', async ({ page }) => {
  await openShotEntry(page);
  await recordShot(page, { value: 2 });
  page.once('dialog', dialog => dialog.dismiss());
  await clickCourtAt(page, 0.02, 0.21);
  await expect(page.locator('#shotDetailsCapture .shot-court-status')).toContainText('3PT area; recorded as 2PT');
  const clearLocation = page.locator('[data-shot-details-action="clear-location"]').first();
  await expect(clearLocation).toBeEnabled();

  await clearLocation.click();
  await expect.poll(async () => {
    const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return event.shotDetails;
  }).toBeUndefined();

  await page.locator('#closeShotLocation').click();
  await expect(page.locator('#shotLocationPanel')).toBeHidden();
  expect((await page.evaluate(() => window.__statsApp.eventController.getGame())).events).toHaveLength(1);
});

test('structured details save independently and can be cleared together', async ({ page }) => {
  await openShotEntry(page);
  await recordShot(page);

  await page.locator('[data-shot-detail-field="pressure"][data-value="lightly_contested"]').first().click();
  await page.locator('[data-shot-detail-field="phase"][data-value="transition"]').first().click();
  await page.locator('[data-shot-detail-field="contexts"][data-value="second_chance"]').first().click();
  await page.locator('[data-shot-detail-field="creation"][data-value="cut"]').first().click();

  await expect.poll(async () => {
    const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return event.shotDetails;
  }).toEqual({
    pressure: 'lightly_contested',
    phase: 'transition',
    contexts: ['second_chance'],
    creation: 'cut'
  });

  await page.locator('[data-shot-details-action="clear-details"]').first().click();
  await expect.poll(async () => {
    const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
    return event.shotDetails;
  }).toBeUndefined();
});

test('free throws and later non-shot events do not leave the map open', async ({ page }) => {
  await openShotEntry(page);
  await recordShot(page, { value: 1 });
  await expect(page.locator('#shotLocationPanel')).toBeHidden();

  await recordShot(page, { value: 2 });
  await page.locator('[data-event-type="assist"]').click();
  await expect(page.locator('#shotLocationPanel')).toBeHidden();
  expect((await page.evaluate(() => window.__statsApp.eventController.getGame())).events).toHaveLength(3);
});

test('location save failures restore the persisted marker state and show an error', async ({ page }) => {
  await openShotEntry(page);
  await recordShot(page);
  await page.evaluate(() => {
    window.__statsOriginalSaveGame = window.__statsApp.store.saveGame;
    window.__statsApp.store.saveGame = async () => {
      throw new Error('Simulated location storage failure.');
    };
  });

  await clickCourtAt(page, 0.06, 0.21);
  await expect(page.locator('#eventError')).toContainText('Simulated location storage failure');
  await expect(page.locator('#shotDetailsCapture .shot-court-marker')).toBeHidden();
  const event = (await page.evaluate(() => window.__statsApp.eventController.getGame())).events[0];
  expect(event).not.toHaveProperty('shotDetails');
});

test('mobile court stays within the event-entry panel without horizontal overflow', async ({ page }) => {
  await openShotEntry(page, { width: 390, height: 844 });
  await recordShot(page);

  const boxes = await page.locator('#eventEntryPanel, #shotDetailsCapture .shot-court-svg').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    })
  );
  expect(boxes[1].left).toBeGreaterThanOrEqual(boxes[0].left);
  expect(boxes[1].right).toBeLessThanOrEqual(boxes[0].right);
  const mapOverflow = await page.locator('#shotLocationPanel').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(mapOverflow.scrollWidth).toBeLessThanOrEqual(mapOverflow.clientWidth);
});
