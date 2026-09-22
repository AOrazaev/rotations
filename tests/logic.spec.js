// Tests for the pure/algorithmic pieces of app.js: the rotation builder,
// its hard minute-limit enforcement, and the small formatting helpers.
//
// app.js is a classic (non-module) script, so its top-level function
// declarations (buildRotation, createSeededRng, computeSubs, escapeHtml,
// etc.) are ordinary globals in the page - exactly like typing their name
// into the DevTools console. page.evaluate() runs in that same page
// context, so we can call them directly without any refactor of app.js.
const { test, expect } = require('@playwright/test');

/** Builds a roster of `n` synthetic players with varied positions/skill. */
function makePlayers(n) {
  const roles = ['G', 'F', 'C'];
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    positions: [roles[i % 3], roles[(i + 1) % 3]],
    skill: 40 + ((i * 7) % 55),
    minMinutes: null,
    maxMinutes: null,
  }));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('combinations() enumerates every 5-player lineup exactly once', async ({ page }) => {
  const result = await page.evaluate(() => combinations([1, 2, 3, 4, 5, 6], 5));
  expect(result).toHaveLength(6); // C(6,5) = 6
  expect(result[0]).toEqual([1, 2, 3, 4, 5]);
  const asStrings = new Set(result.map(c => c.join(',')));
  expect(asStrings.size).toBe(6); // no duplicates
});

test('createSeededRng() is deterministic for a given seed', async ({ page }) => {
  const { seqA, seqB, seqC } = await page.evaluate(() => {
    const draw = rng => Array.from({ length: 5 }, () => rng());
    return {
      seqA: draw(createSeededRng(42)),
      seqB: draw(createSeededRng(42)),
      seqC: draw(createSeededRng(43)),
    };
  });
  expect(seqA).toEqual(seqB);
  expect(seqA).not.toEqual(seqC);
  for (const v of seqA) {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test('buildRotation() fills every block with exactly 5 players and conserves total minutes', async ({ page }) => {
  const players = makePlayers(8);
  const blockMinutes = 4;
  const output = await page.evaluate(
    ({ players, blockMinutes }) => buildRotation(players, blockMinutes, 50),
    { players, blockMinutes }
  );

  const expectedBlocks = Math.ceil(40 / blockMinutes);
  expect(output.blocks).toBe(expectedBlocks);
  expect(output.result).toHaveLength(expectedBlocks);
  for (const block of output.result) {
    expect(block.lineup).toHaveLength(5);
    expect(block.bench).toHaveLength(players.length - 5);
  }

  const totalMinutes = Object.values(output.minutes).reduce((a, b) => a + b, 0);
  expect(totalMinutes).toBe(expectedBlocks * 5 * blockMinutes);
});

test('buildRotation() throws when fewer than 5 players are available', async ({ page }) => {
  const players = makePlayers(4);
  const message = await page.evaluate(players => {
    try { buildRotation(players, 4, 50); return null; }
    catch (e) { return e.message; }
  }, players);
  expect(message).toMatch(/at least 5/i);
});

test('buildRotation() guarantees a hard minimum-minutes floor', async ({ page }) => {
  const players = makePlayers(6);
  players[0].minMinutes = 40; // full 40-minute game, must never sit
  const blockMinutes = 10; // 4 blocks total
  const output = await page.evaluate(
    ({ players, blockMinutes }) => buildRotation(players, blockMinutes, 50),
    { players, blockMinutes }
  );
  expect(output.minutes.p0).toBe(40);
});

test('buildRotation() guarantees a hard maximum-minutes ceiling', async ({ page }) => {
  const players = makePlayers(6);
  players[0].maxMinutes = 10; // capped to a single 10-minute block
  const blockMinutes = 10;
  const output = await page.evaluate(
    ({ players, blockMinutes }) => buildRotation(players, blockMinutes, 50),
    { players, blockMinutes }
  );
  expect(output.minutes.p0).toBeLessThanOrEqual(10);
});

test('buildRotation() rejects a per-player minimum greater than that player\'s maximum', async ({ page }) => {
  const players = makePlayers(6);
  players[0].minMinutes = 20;
  players[0].maxMinutes = 10;
  const message = await page.evaluate(players => {
    try { buildRotation(players, 4, 50); return null; }
    catch (e) { return e.message; }
  }, players);
  expect(message).toMatch(/can't exceed/i);
});

test('buildRotation() rejects infeasible totals (minimums exceeding available playing time)', async ({ page }) => {
  const players = makePlayers(6);
  players.forEach(p => { p.minMinutes = 40; });
  const message = await page.evaluate(players => {
    try { buildRotation(players, 4, 50); return null; }
    catch (e) { return e.message; }
  }, players);
  expect(message).toMatch(/minimum minutes/i);
});

test('buildRotation() rejects infeasible totals (maximums leaving too little playing time)', async ({ page }) => {
  const players = makePlayers(6);
  players.forEach(p => { p.maxMinutes = 4; }); // 6 * 4 = 24 min-equivalent < 40 needed
  const message = await page.evaluate(players => {
    try { buildRotation(players, 4, 50); return null; }
    catch (e) { return e.message; }
  }, players);
  expect(message).toMatch(/maximum minute limits/i);
});

test("a manual swap in one block doesn't corrupt another block with the identical lineup", async ({ page }) => {
  // Regression test: buildRotation() used to push the winning combo array
  // by reference into `result`. When the identical 5-player lineup won in
  // two different blocks, both blocks ended up pointing at the exact same
  // array - mutating one via a manual swap silently corrupted the other
  // (a player would end up duplicated in one block and missing in another).
  // Forcing player 5's maxMinutes to 0 guarantees every block's only
  // eligible combo is exactly players 0-4, so blocks 0 and 1 are certain
  // to share the same winning lineup.
  const players = makePlayers(6);
  players[5].maxMinutes = 0;
  const result = await page.evaluate(players => {
    const rotation = buildRotation(players, 20, 50); // 40/20 = 2 blocks
    const sameArrayBeforeSwap = rotation.result[0].lineup === rotation.result[1].lineup;
    const swapped = applySwap(rotation, 0, players[0].id, players[5].id);
    return {
      sameArrayBeforeSwap,
      swapped,
      block0: rotation.result[0].lineup.map(p => p.id),
      block1: rotation.result[1].lineup.map(p => p.id),
    };
  }, players);
  expect(result.sameArrayBeforeSwap).toBe(false); // buildRotation() must clone, not alias
  expect(result.swapped).toBe(true);
  expect(result.block0).toEqual([players[5].id, players[1].id, players[2].id, players[3].id, players[4].id]);
  // Block 1 must be untouched by the swap applied to block 0.
  expect(result.block1).toEqual(players.slice(0, 5).map(p => p.id));
});

test('computeSubs() identifies who subs out and who subs in between two blocks', async ({ page }) => {
  const result = await page.evaluate(() => {
    const [a, b, c, d, e, f] = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id }));
    const prevBlock = { lineup: [a, b, c, d, e] };
    const currBlock = { lineup: [a, b, c, d, f] };
    const { out, inn } = computeSubs(prevBlock, currBlock);
    return { out: out.map(p => p.id), inn: inn.map(p => p.id) };
  });
  expect(result.out).toEqual(['e']);
  expect(result.inn).toEqual(['f']);
});

test('intensityLabel() reflects the rotation-style thresholds', async ({ page }) => {
  const labels = await page.evaluate(() => [0, 10, 11, 39, 40, 50, 60, 61, 89, 90, 100].map(intensityLabel));
  expect(labels).toEqual([
    'Equal minutes',
    'Equal minutes',
    'Mostly equal (11%)',
    'Mostly equal (39%)',
    'Balanced (40%)',
    'Balanced (50%)',
    'Balanced (60%)',
    'Mostly competitive (61%)',
    'Mostly competitive (89%)',
    'Competitive',
    'Competitive',
  ]);
});

test('escapeHtml() escapes all HTML-sensitive characters', async ({ page }) => {
  const result = await page.evaluate(() => escapeHtml(`<b>Al & "Bob's" Team</b>`));
  expect(result).toBe('&lt;b&gt;Al &amp; &quot;Bob&#39;s&quot; Team&lt;/b&gt;');
});

test('player label helpers format jersey numbers per view (badge / superscript / plain)', async ({ page }) => {
  const results = await page.evaluate(() => {
    const withNumber = { name: 'Dmytro', number: '13' };
    const withoutNumber = { name: 'Nikita', number: '' };
    return {
      plainWith: playerLabel(withNumber),
      plainWithout: playerLabel(withoutNumber),
      htmlWith: playerLabelHtml(withNumber),
      supHtmlWith: playerLabelSupHtml(withNumber),
      supTextWith: playerLabelSupText(withNumber),
      supTextWithout: playerLabelSupText(withoutNumber),
    };
  });
  expect(results.plainWith).toBe('#13 Dmytro');
  expect(results.plainWithout).toBe('Nikita');
  expect(results.htmlWith).toBe('<span class="jersey-badge">13</span>Dmytro');
  expect(results.supHtmlWith).toBe('Dmytro<sup class="jersey-sup">13</sup>');
  expect(results.supTextWith).toBe('Dmytro¹³');
  expect(results.supTextWithout).toBe('Nikita');
});
