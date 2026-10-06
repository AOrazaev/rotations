const { test, expect } = require('@playwright/test');

async function openLayout(page) {
  const databaseName = `basketball-stats-layout-${Date.now()}-${Math.random()}`;
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
  }, databaseName);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.setupController.ready);
}

async function saveGame(page) {
  await page.locator('#gameTitle').fill('Layout game');
  await page.locator('#gameVideoUrl').fill('https://youtu.be/M7lc1UVf-VE');
  await page.locator('#saveGame').click();
  await expect(page.locator('#gamesStatus')).toContainText('Saved Layout game');
  await expect(page.locator('#eventEntryPanel')).toBeVisible();
  await expect(page.locator('#eventLogPanel')).toBeVisible();
}

test('desktop uses games, video and event timeline columns', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openLayout(page);
  await expect(page.locator('#eventLogPanel')).toBeHidden();
  await page.locator('#addSetupPlayer').click();
  await page.locator('.setup-name').last().fill('Bench Player');
  await saveGame(page);
  await page.evaluate(() => scrollTo(0, 0));

  const boxes = await page.locator('.game-panel, .center-panel, .capture-panel').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width };
    })
  );
  expect(boxes).toHaveLength(3);
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[1].x).toBeLessThan(boxes[2].x);
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(2);
  expect(Math.abs(boxes[1].y - boxes[2].y)).toBeLessThan(2);

  const workspaceBoxes = await page.locator('.video-card, .event-entry-card').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width };
    })
  );
  expect(workspaceBoxes[0].x).toBeLessThan(workspaceBoxes[1].x);
  expect(workspaceBoxes[0].width).toBeGreaterThan(workspaceBoxes[1].width);
  expect(workspaceBoxes[0].width).toBeGreaterThanOrEqual(600);
  expect(workspaceBoxes[1].x - (workspaceBoxes[0].x + workspaceBoxes[0].width)).toBeLessThanOrEqual(10);

  await expect(page.locator('#trackerVideoScore')).toBeVisible();
  await expect(page.locator('#trackerVideoScore')).toContainText('Our team');
  expect(await page.locator('#eventEntryPanel #teamScore').count()).toBe(0);
  const scorePosition = await page.locator('#playerFrame, #trackerVideoScore').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect())
  );
  expect(scorePosition[1].top).toBeGreaterThanOrEqual(scorePosition[0].bottom);

  const benchDetails = page.locator('#benchPlayersDetails');
  await expect(benchDetails).not.toHaveAttribute('open', '');
  await expect(page.locator('#benchPlayerCount')).toHaveText('1');
  await expect(page.locator('#benchPlayers')).toBeHidden();
  await benchDetails.locator('summary').click();
  await expect(page.locator('#benchPlayers')).toBeVisible();

  const reviewBoxes = await page.locator('#reviewShell, .capture-panel').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().width)
  );
  expect(reviewBoxes[1] / reviewBoxes[0]).toBeGreaterThan(0.25);
  expect(reviewBoxes[1] / reviewBoxes[0]).toBeLessThan(0.35);

  const shotPairs = await page.locator('.shot-button-pair').evaluateAll(elements =>
    elements.map(element => [...element.querySelectorAll('button')].map(button => {
      const box = button.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }))
  );
  expect(shotPairs).toHaveLength(3);
  expect(shotPairs.every(pair => Math.abs(pair[0].x - pair[1].x) < 2 && pair[0].y < pair[1].y)).toBe(true);
  expect(shotPairs[0][0].x).toBeLessThan(shotPairs[1][0].x);
  expect(shotPairs[1][0].x).toBeLessThan(shotPairs[2][0].x);

  const expandedVideoWidth = workspaceBoxes[0].width;
  await page.locator('#hideGamePanel').click();
  await expect(page.locator('#gamePanel')).toBeHidden();
  await expect(page.locator('#showGamePanel')).toBeVisible();
  await expect(page.locator('#showGamePanel')).toBeFocused();
  const collapsedVideoWidth = await page.locator('.video-card').evaluate(element => element.getBoundingClientRect().width);
  expect(collapsedVideoWidth).toBeGreaterThan(expandedVideoWidth);

  await page.locator('#showGamePanel').click();
  await expect(page.locator('#gamePanel')).toBeVisible();
  await expect(page.locator('#hideGamePanel')).toBeFocused();

  await page.locator('#decreaseVideoSize').click();
  await expect(page.locator('#videoSizeValue')).toHaveText('65%');
  const resizeHandle = await page.locator('#videoResizeHandle').boundingBox();
  await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y + resizeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeHandle.x - 140, resizeHandle.y + resizeHandle.height / 2, { steps: 5 });
  await page.mouse.up();
  const persistedVideoSize = Number((await page.locator('#videoResizeHandle').getAttribute('aria-valuenow')));
  expect(persistedVideoSize).toBeLessThan(65);
  expect(persistedVideoSize).toBeGreaterThanOrEqual(55);
  const resizedVideoWidth = await page.locator('.video-card').evaluate(element => element.getBoundingClientRect().width);
  expect(resizedVideoWidth).toBeLessThan(expandedVideoWidth);
  expect(resizedVideoWidth).toBeGreaterThanOrEqual(expandedVideoWidth * 0.6);

  await page.reload();
  await page.evaluate(() => window.__statsApp.setupController.ready);
  await expect(page.locator('#videoResizeHandle')).toHaveAttribute('aria-valuenow', String(persistedVideoSize));
  await expect(page.locator('#videoSizeValue')).toHaveText(`${persistedVideoSize}%`);
});

test('game editor collapses and reopens for a new game', async ({ page }) => {
  await openLayout(page);
  const editor = page.locator('#gameEditorDetails');
  await expect(editor).toHaveAttribute('open', '');
  await editor.locator('summary').click();
  await expect(editor).not.toHaveAttribute('open', '');
  await page.locator('#newStandaloneGame').click();
  await expect(editor).toHaveAttribute('open', '');
});

test('hidden games panel stays collapsed after reload', async ({ page }) => {
  await openLayout(page);
  await page.locator('#hideGamePanel').click();
  await page.reload();
  await page.evaluate(() => window.__statsApp.setupController.ready);

  await expect(page.locator('#gamePanel')).toBeHidden();
  await expect(page.locator('#showGamePanel')).toBeVisible();
  await expect(page.locator('#showGamePanel')).toHaveAttribute('aria-expanded', 'false');
});

test('mobile stacks games, center workflow and event timeline in order', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await openLayout(page);
  await saveGame(page);

  const positions = await page.locator('.game-panel, .center-panel, .capture-panel').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().y)
  );
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);

  const workspacePositions = await page.locator('.video-card, .event-entry-card').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().y)
  );
  expect(workspacePositions[0]).toBeLessThan(workspacePositions[1]);
});
