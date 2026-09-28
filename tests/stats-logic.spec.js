const { test, expect } = require('@playwright/test');

async function loadFixture(page) {
  return page.evaluate(async () => {
    const [game, expected] = await Promise.all([
      fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json()),
      fetch('/stats/docs/fixtures/representative-game-v1.expected.json').then(response => response.json())
    ]);
    return { game, expected };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/stats/');
});

test('representative game produces the exact hand-calculated report', async ({ page }) => {
  const { game, expected } = await loadFixture(page);
  const report = await page.evaluate(async gameData => {
    const { buildGameReport } = await import('/stats/js/event-reducer.js');
    return buildGameReport(gameData);
  }, game);
  expect(report).toEqual(expected);
});

test('analysis exposes deterministic ordering, active lineup, progression, and source events', async ({ page }) => {
  const { game } = await loadFixture(page);
  const analysis = await page.evaluate(async gameData => {
    const { buildGameAnalysis } = await import('/stats/js/event-reducer.js');
    return buildGameAnalysis(gameData);
  }, game);

  expect(analysis.orderedEventIds).toEqual([
    'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7',
    'e8', 'e9', 'e10', 'e11', 'e12', 'e13', 'e14'
  ]);
  expect(analysis.activeLineupIds).toEqual(['p1', 'p2', 'p3', 'p4', 'p6']);
  expect(analysis.scoreProgression).toEqual([
    { eventId: 'e1', videoSeconds: 110, team: 2, opponent: 0 },
    { eventId: 'e4', videoSeconds: 125, team: 2, opponent: 2 },
    { eventId: 'e8', videoSeconds: 150, team: 5, opponent: 2 },
    { eventId: 'e12', videoSeconds: 180, team: 5, opponent: 3 }
  ]);
  expect(analysis.traceability.teamComparison.opponent.fieldGoals).toEqual(['e2', 'e4']);
  expect(analysis.traceability.players.p1.points).toEqual(['e1']);
  expect(analysis.traceability.players.p1.plusMinus).toEqual(['e1', 'e4', 'e8', 'e12']);
  expect(analysis.traceability.participationIntervals).toEqual([
    {
      lineupKey: 'p1|p2|p3|p4|p5',
      playerIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
      startSeconds: 100,
      endSeconds: 140,
      boundaryEventId: 'e7'
    },
    {
      lineupKey: 'p1|p2|p3|p4|p6',
      playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'],
      startSeconds: 140,
      endSeconds: 200,
      boundaryEventId: null
    }
  ]);
});

test('opponent misses count as attempts without changing score or plus/minus', async ({ page }) => {
  const { game } = await loadFixture(page);
  game.events = game.events.filter(event => event.id === 'e2');
  game.events[0].lineupIds = [...game.startingLineupIds];
  const report = await page.evaluate(async gameData => {
    const { buildGameReport } = await import('/stats/js/event-reducer.js');
    return buildGameReport(gameData);
  }, game);

  expect(report.score).toEqual({ team: 0, opponent: 0 });
  expect(report.teamComparison.opponent.fieldGoals).toEqual({ made: 0, attempted: 1, percentage: 0 });
  expect(report.teamComparison.opponent.threePoint).toEqual({ made: 0, attempted: 1, percentage: 0 });
  expect(Object.values(report.players).every(player => player.plusMinus === 0)).toBe(true);
});

test('editing or deleting events deterministically recalculates derived statistics', async ({ page }) => {
  const { game } = await loadFixture(page);
  const results = await page.evaluate(async gameData => {
    const { buildGameReport } = await import('/stats/js/event-reducer.js');
    const edited = structuredClone(gameData);
    edited.events.find(event => event.id === 'e5').made = true;
    const deleted = structuredClone(gameData);
    deleted.events = deleted.events.filter(event => !['e8', 'e9'].includes(event.id));
    return {
      edited: buildGameReport(edited),
      deleted: buildGameReport(deleted)
    };
  }, game);

  expect(results.edited.score.team).toBe(8);
  expect(results.edited.players.p3.points).toBe(3);
  expect(results.edited.teamComparison.team.threePoint).toEqual({ made: 2, attempted: 2, percentage: 100 });
  expect(results.deleted.score.team).toBe(2);
  expect(results.deleted.players.p6.points).toBe(0);
  expect(results.deleted.players.p1.assists).toBe(0);
  expect(results.deleted.lineups[1].pointsFor).toBe(0);
});

test('open-ended recordings use the latest event as a provisional duration boundary', async ({ page }) => {
  const { game } = await loadFixture(page);
  game.video.endSeconds = null;
  const analysis = await page.evaluate(async gameData => {
    const { buildGameAnalysis } = await import('/stats/js/event-reducer.js');
    return buildGameAnalysis(gameData);
  }, game);

  expect(analysis.durationIsProvisional).toBe(true);
  expect(analysis.reportEndSeconds).toBe(195);
  expect(analysis.report.players.p6.videoSeconds).toBe(55);
});

test('validation rejects duplicate identities and sequences', async ({ page }) => {
  const { game } = await loadFixture(page);
  game.players[1].id = game.players[0].id;
  game.events[1].id = game.events[0].id;
  game.events[1].sequence = game.events[0].sequence;

  const issues = await page.evaluate(async gameData => {
    const { collectGameValidationIssues } = await import('/stats/js/game-model.js');
    return collectGameValidationIssues(gameData);
  }, game);

  expect(issues).toContain('Duplicate player ID: p1.');
  expect(issues).toContain('Duplicate event ID: e1.');
  expect(issues).toContain('Duplicate event sequence: 1.');
});

test('validation rejects invalid lineup snapshots and substitutions', async ({ page }) => {
  const { game } = await loadFixture(page);
  const substitution = game.events.find(event => event.id === 'e7');
  substitution.playerOutId = 'p6';
  substitution.playerInId = 'p1';
  substitution.lineupIds = ['p1', 'p2', 'p3', 'p4', 'p6'];

  const issues = await page.evaluate(async gameData => {
    const { collectGameValidationIssues } = await import('/stats/js/game-model.js');
    return collectGameValidationIssues(gameData);
  }, game);

  expect(issues).toContain('Event e7 outgoing player is not on court.');
  expect(issues).toContain('Event e7 incoming player must be a bench player.');
  expect(issues.some(issue => issue.includes('lineup snapshot does not match'))).toBe(true);
});

test('same-timestamp substitution ordering follows sequence numbers', async ({ page }) => {
  const { game } = await loadFixture(page);
  const substitution = game.events.find(event => event.id === 'e7');
  const shot = game.events.find(event => event.id === 'e8');
  substitution.videoSeconds = 150;
  shot.videoSeconds = 150;
  substitution.sequence = 8;
  shot.sequence = 7;
  shot.lineupIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
  game.events.find(event => event.id === 'e9').lineupIds = ['p1', 'p2', 'p3', 'p4', 'p6'];

  const result = await page.evaluate(async gameData => {
    const { buildGameAnalysis } = await import('/stats/js/event-reducer.js');
    const analysis = buildGameAnalysis(gameData);
    return {
      order: analysis.orderedEventIds.slice(6, 9),
      p5PlusMinus: analysis.report.players.p5.plusMinus,
      p6PlusMinus: analysis.report.players.p6.plusMinus
    };
  }, game);

  expect(result.order).toEqual(['e8', 'e7', 'e9']);
  expect(result.p5PlusMinus).toBe(3);
  expect(result.p6PlusMinus).toBe(-1);
});
