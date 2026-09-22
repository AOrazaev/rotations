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

test('Generate rotation produces one timeline column per time block', async ({ page }) => {
  await page.locator('#generate').click();
  await expect(page.locator('#rotationCard')).toBeVisible();
  await expect(page.locator('#timelineView')).toBeVisible();

  const blockMinutes = Number(await page.locator('#blockMinutes').inputValue());
  const expectedBlocks = Math.ceil(40 / blockMinutes);
  // One header cell per block, plus the leading empty corner cell.
  await expect(page.locator('.timeline-header-cell')).toHaveCount(expectedBlocks + 1);

  const presentCount = await page.evaluate(() => state.players.filter(p => p.present).length);
  await expect(page.locator('#minutesGrid .minute-card')).toHaveCount(presentCount);
});

test('A generated rotation and its seed survive a reload', async ({ page }) => {
  await page.locator('#generate').click();
  await page.locator('#regenerateRotation').click();
  const seed = await page.locator('#regenerateSeed').inputValue();
  const gridBefore = await page.locator('#timelineGrid').innerHTML();

  await page.reload();

  await expect(page.locator('#rotationCard')).toBeVisible();
  await expect(page.locator('#timelineView')).toBeVisible();
  await expect(page.locator('#regenerateSeed')).toHaveValue(seed);
  const gridAfter = await page.locator('#timelineGrid').innerHTML();
  expect(gridAfter).toBe(gridBefore);
});

test('a corrupted saved rotation (a player duplicated across lineup/bench in one block) is dropped instead of rendered as-is', async ({ page }) => {
  // Regression test for a real corrupted-localStorage report: one block's
  // "blocks" snapshot had the same player id in both lineup and bench while
  // another player was missing entirely (the shared-array-reference bug -
  // now fixed in buildRotation - used to let a swap in one block silently
  // mutate another block sharing the same lineup). restoreRotation() must
  // detect this and fall back to a freshly-built rotation rather than
  // trusting/rendering the broken snapshot.
  await page.locator('#generate').click();
  const corrupted = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('basketball-rotation-planner-v1'));
    const players = saved.rotation.players;
    // Duplicate players[0] into block 0's bench and drop players[-1] (the
    // last bench player) to simulate the exact corruption pattern seen.
    const block0 = saved.rotation.blocks[0];
    const droppedId = block0.bench[block0.bench.length - 1];
    block0.bench = block0.bench.slice(0, -1).concat(players[0].id);
    localStorage.setItem('basketball-rotation-planner-v1', JSON.stringify(saved));
    return { droppedId, dupId: players[0].id };
  });

  await page.reload();

  await expect(page.locator('#rotationCard')).toBeVisible();
  await expect(page.locator('#timelineView')).toBeVisible();
  // The app must still produce a fully valid rotation (every present player
  // accounted for exactly once per block) rather than perpetuating the
  // corrupted snapshot.
  const isValid = await page.evaluate(() => {
    const presentCount = state.players.filter(p => p.present).length;
    return lastRotation.result.every(b => {
      const ids = [...b.lineup, ...b.bench].map(p => p.id);
      return ids.length === presentCount && new Set(ids).size === presentCount;
    });
  });
  expect(isValid).toBe(true);
});

test('Regenerate assigns a random seed and still produces a full, valid rotation', async ({ page }) => {
  await page.locator('#generate').click();
  await expect(page.locator('#regenerateSeed')).toHaveValue('');

  await page.locator('#regenerateRotation').click();
  const seed = await page.locator('#regenerateSeed').inputValue();
  expect(Number(seed)).toBeGreaterThan(0);

  const blockMinutes = Number(await page.locator('#blockMinutes').inputValue());
  const expectedBlocks = Math.ceil(40 / blockMinutes);
  await expect(page.locator('.timeline-header-cell')).toHaveCount(expectedBlocks + 1);
});


test('Re-entering a previous seed reproduces the same rotation', async ({ page }) => {
  await page.locator('#generate').click();
  await page.locator('#regenerateRotation').click();
  const seed = await page.locator('#regenerateSeed').inputValue();
  const firstLineup = await page.locator('#timelineGrid').innerHTML();

  await page.locator('#regenerateRotation').click(); // scramble it
  await expect(page.locator('#timelineGrid')).not.toHaveText(''); // sanity: still rendered

  await page.locator('#regenerateSeed').fill(seed);
  // The seed input commits on blur (native "change" event) — tabbing away
  // mirrors typing a seed and moving on, same as a user would do.
  await page.locator('#regenerateSeed').press('Tab');
  await expect(page.locator('#regenerateSeed')).toHaveValue(seed);
  const reproducedLineup = await page.locator('#timelineGrid').innerHTML();
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

  // confirm() blocks the page's JS thread until the dialog is dismissed, so
  // the click() promise won't resolve until we accept it here - accept must
  // happen as soon as the dialog appears, not after awaiting the click.
  await Promise.all([
    page.waitForEvent('dialog').then((dialog) => dialog.accept()),
    page.locator('#resetApp').click(),
  ]);

  await expect(page.locator('.player-row')).toHaveCount(before - 1);
  await expect(page.locator('#rosterCompactTab')).toHaveClass(/active/);
  await expect(page.locator('#blockMinutes')).toHaveValue('4');
});

test('a manual swap can be undone and redone', async ({ page }) => {
  await page.locator('#generate').click();
  await page.locator('#swapMode').click();

  const onCell = page.locator('.timeline-cell[data-block="0"][data-status="on"]').first();
  const offCell = page.locator('.timeline-cell[data-block="0"][data-status="off"]').first();
  const onId = await onCell.getAttribute('data-player');
  const offId = await offCell.getAttribute('data-player');

  await expect(page.locator('#undoSwap')).toBeDisabled();
  await expect(page.locator('#redoSwap')).toBeDisabled();

  await onCell.click();
  await offCell.click();

  await expect(page.locator(`.timeline-cell[data-block="0"][data-player="${offId}"]`)).toHaveAttribute('data-status', 'on');
  await expect(page.locator(`.timeline-cell[data-block="0"][data-player="${onId}"]`)).toHaveAttribute('data-status', 'off');
  await expect(page.locator('#undoSwap')).toBeEnabled();
  await expect(page.locator('#redoSwap')).toBeDisabled();

  await page.locator('#undoSwap').click();
  await expect(page.locator(`.timeline-cell[data-block="0"][data-player="${onId}"]`)).toHaveAttribute('data-status', 'on');
  await expect(page.locator(`.timeline-cell[data-block="0"][data-player="${offId}"]`)).toHaveAttribute('data-status', 'off');
  await expect(page.locator('#undoSwap')).toBeDisabled();
  await expect(page.locator('#redoSwap')).toBeEnabled();

  await page.locator('#redoSwap').click();
  await expect(page.locator(`.timeline-cell[data-block="0"][data-player="${offId}"]`)).toHaveAttribute('data-status', 'on');
  await expect(page.locator(`.timeline-cell[data-block="0"][data-player="${onId}"]`)).toHaveAttribute('data-status', 'off');
  await expect(page.locator('#undoSwap')).toBeEnabled();
  await expect(page.locator('#redoSwap')).toBeDisabled();
});

test('generating a new rotation clears swap undo/redo history', async ({ page }) => {
  await page.locator('#generate').click();
  await page.locator('#swapMode').click();
  await page.locator('.timeline-cell[data-block="0"][data-status="on"]').first().click();
  await page.locator('.timeline-cell[data-block="0"][data-status="off"]').first().click();
  await expect(page.locator('#undoSwap')).toBeEnabled();

  await page.locator('#regenerateRotation').click();
  await expect(page.locator('#undoSwap')).toBeDisabled();
  await expect(page.locator('#redoSwap')).toBeDisabled();
});

test('swap undo/redo history does not persist across a reload', async ({ page }) => {
  await page.locator('#generate').click();
  await page.locator('#swapMode').click();
  await page.locator('.timeline-cell[data-block="0"][data-status="on"]').first().click();
  await page.locator('.timeline-cell[data-block="0"][data-status="off"]').first().click();
  await expect(page.locator('#undoSwap')).toBeEnabled();

  await page.reload();

  await expect(page.locator('#undoSwap')).toBeDisabled();
  await expect(page.locator('#redoSwap')).toBeDisabled();
});
