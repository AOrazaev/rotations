// End-to-end tests that drive the real UI (clicks, form fills, dialogs)
// rather than calling internal functions directly. Complements logic.spec.js.
const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Playwright gives every test a fresh, isolated browser context, so
  // localStorage already starts empty here - no explicit clearing needed.
  // (An addInitScript-based clear would also re-run on any page.reload()
  // within a test, wiping state the test just saved.)
  await page.goto('/');
});

test('roster starts in compact chip mode; Edit details reveals the full form fields', async ({ page }) => {
  await expect(page.locator('#rosterCompactTab')).toHaveClass(/active/);
  await expect(page.locator('#rosterEditTab')).not.toHaveClass(/active/);
  await expect(page.locator('.player-row').first().locator('.jersey')).toBeHidden();
  await expect(page.locator('.player-row').first().locator('.name')).toBeHidden();

  await page.locator('#rosterEditTab').click();
  await expect(page.locator('#rosterEditTab')).toHaveClass(/active/);
  await expect(page.locator('.player-row').first().locator('.jersey')).toBeVisible();
  await expect(page.locator('.player-row').first().locator('.name')).toBeVisible();
});

test('the compact/edit choice persists across a reload', async ({ page }) => {
  await page.locator('#rosterEditTab').click();
  await page.reload();
  await expect(page.locator('#rosterEditTab')).toHaveClass(/active/);
});

test('clicking a compact chip toggles that player\'s availability', async ({ page }) => {
  const chip = page.locator('.player-row').nth(2);
  await expect(chip).not.toHaveClass(/chip-off/);
  await chip.click();
  await expect(chip).toHaveClass(/chip-off/);
  await chip.click();
  await expect(chip).not.toHaveClass(/chip-off/);
});

test('Add player appends a new editable roster row', async ({ page }) => {
  await page.locator('#rosterEditTab').click();
  const before = await page.locator('.player-row').count();
  await page.locator('#addPlayer').click();
  await expect(page.locator('.player-row')).toHaveCount(before + 1);
  await expect(page.locator('.player-row').last().locator('.name')).toHaveValue('New player');
});

test('Delete removes a roster row', async ({ page }) => {
  await page.locator('#rosterEditTab').click();
  const before = await page.locator('.player-row').count();
  await page.locator('.player-row').first().locator('.delete').click();
  await expect(page.locator('.player-row')).toHaveCount(before - 1);
});

test('Generate rotation produces one lineup row per time block and switches to the Timeline view', async ({ page }) => {
  await page.locator('#generate').click();
  await expect(page.locator('#rotationCard')).toBeVisible();
  await expect(page.locator('#timelineView')).toBeVisible();
  await expect(page.locator('#tableView')).toBeHidden();
  await expect(page.locator('#tabTimeline')).toHaveClass(/active/);

  const blockMinutes = Number(await page.locator('#blockMinutes').inputValue());
  const expectedBlocks = Math.ceil(40 / blockMinutes);
  // Rows without the "sub-row" class are the actual lineup rows (one per block).
  await expect(page.locator('#rotationBody tr:not(.sub-row)')).toHaveCount(expectedBlocks);

  const presentCount = await page.evaluate(() => state.players.filter(p => p.present).length);
  await expect(page.locator('#minutesGrid .minute-card')).toHaveCount(presentCount);
});

test('Table tab shows the table and hides the timeline', async ({ page }) => {
  await page.locator('#generate').click();
  await page.locator('#tabTable').click();
  await expect(page.locator('#tableView')).toBeVisible();
  await expect(page.locator('#timelineView')).toBeHidden();
  await expect(page.locator('#tabTable')).toHaveClass(/active/);
});

test('Regenerate assigns a random seed and still produces a full, valid rotation', async ({ page }) => {
  await page.locator('#generate').click();
  await expect(page.locator('#regenerateSeed')).toHaveValue('');

  await page.locator('#regenerateRotation').click();
  const seed = await page.locator('#regenerateSeed').inputValue();
  expect(Number(seed)).toBeGreaterThan(0);

  const blockMinutes = Number(await page.locator('#blockMinutes').inputValue());
  const expectedBlocks = Math.ceil(40 / blockMinutes);
  await expect(page.locator('#rotationBody tr:not(.sub-row)')).toHaveCount(expectedBlocks);
});

test('Re-entering a previous seed reproduces the same rotation', async ({ page }) => {
  await page.locator('#generate').click();
  await page.locator('#regenerateRotation').click();
  const seed = await page.locator('#regenerateSeed').inputValue();
  const firstLineup = await page.locator('#rotationBody').innerHTML();

  await page.locator('#regenerateRotation').click(); // scramble it
  await expect(page.locator('#rotationBody')).not.toHaveText(''); // sanity: still rendered

  await page.locator('#regenerateSeed').fill(seed);
  // The seed input commits on blur (native "change" event) — tabbing away
  // mirrors typing a seed and moving on, same as a user would do.
  await page.locator('#regenerateSeed').press('Tab');
  await expect(page.locator('#regenerateSeed')).toHaveValue(seed);
  const reproducedLineup = await page.locator('#rotationBody').innerHTML();
  expect(reproducedLineup).toBe(firstLineup);
});

test('An infeasible minimum-minutes setup surfaces an alert instead of failing silently', async ({ page }) => {
  await page.locator('#rosterEditTab').click();
  const rows = page.locator('.player-row');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    await rows.nth(i).locator('.min-minutes').fill('40');
  }

  let alertMessage = '';
  page.once('dialog', async dialog => {
    alertMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator('#generate').click();
  await expect.poll(() => alertMessage).toContain('minimum minutes');
  // No rotation should have been rendered since generation failed.
  await expect(page.locator('#rotationCard')).toBeHidden();
});

test('Reset app restores the default roster and settings', async ({ page }) => {
  await page.locator('#rosterEditTab').click();
  await page.locator('#addPlayer').click();
  const before = await page.locator('.player-row').count();

  const [dialog] = await Promise.all([
    page.waitForEvent('dialog'),
    page.locator('#resetApp').click(),
  ]);
  await dialog.accept();

  await expect(page.locator('.player-row')).toHaveCount(before - 1);
  await expect(page.locator('#rosterCompactTab')).toHaveClass(/active/);
  await expect(page.locator('#blockMinutes')).toHaveValue('4');
});
