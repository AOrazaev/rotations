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
  await expect(page.locator('#eventLogPanel')).toBeVisible();
}

test('desktop uses games, video and event timeline columns', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await openLayout(page);
  await expect(page.locator('#eventLogPanel')).toBeHidden();
  await saveGame(page);
  await page.evaluate(() => scrollTo(0, 0));

  const boxes = await page.locator('.game-panel, .center-panel, .event-log-panel').evaluateAll(elements =>
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
  expect(Math.abs(workspaceBoxes[0].y - workspaceBoxes[1].y)).toBeLessThan(2);
  expect(workspaceBoxes.every(box => box.width >= 280)).toBe(true);
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

test('mobile stacks games, center workflow and event timeline in order', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await openLayout(page);
  await saveGame(page);

  const positions = await page.locator('.game-panel, .center-panel, .event-log-panel').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().y)
  );
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);

  const workspacePositions = await page.locator('.video-card, .event-entry-card').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().y)
  );
  expect(workspacePositions[0]).toBeLessThan(workspacePositions[1]);
});
