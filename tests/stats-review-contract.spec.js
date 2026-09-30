const { test, expect } = require('@playwright/test');

test('review fixture is valid and preserves the representative report', async ({ page }) => {
  await page.goto('/stats/');
  const result = await page.evaluate(async () => {
    const [game, expected] = await Promise.all([
      fetch('/stats/docs/fixtures/review-view-game-v1.json').then(response => response.json()),
      fetch('/stats/docs/fixtures/representative-game-v1.expected.json').then(response => response.json())
    ]);
    const [{ normalizeGame }, { buildGameReport }] = await Promise.all([
      import('/stats/js/game-model.js'),
      import('/stats/js/event-reducer.js')
    ]);
    const normalizedGame = normalizeGame(game);
    return {
      report: buildGameReport(normalizedGame),
      expected,
      comments: Object.fromEntries(
        normalizedGame.events
          .filter(event => event.coachComment)
          .map(event => [event.id, event.coachComment])
      ),
      substitution: normalizedGame.events.find(event => event.type === 'substitution')
    };
  });

  expect(result.report).toEqual(result.expected);
  expect(result.comments).toEqual({
    e1: 'Attack the space decisively.',
    e4: '@2 Close out earlier.',
    e6: '@team Sprint back together.',
    e7: 'Communicate the substitution matchup.'
  });
  expect(result.substitution).toMatchObject({
    id: 'e7',
    playerOutId: 'p5',
    playerInId: 'p6'
  });
});
