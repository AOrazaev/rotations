const { test, expect } = require('@playwright/test');

async function installSharedTestEnvironment(page, { delayPlayer = false } = {}) {
  await page.addInitScript(({ delayPlayer }) => {
    window.__statsFakePlayer = {
      current: 0,
      calls: [],
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; this.calls.push(['seek', seconds]); },
      play() { this.calls.push(['play']); },
      pause() { this.calls.push(['pause']); },
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = delayPlayer
      ? () => new Promise(resolve => {
        window.__resolveStatsFakePlayer = () => resolve(window.__statsFakePlayer);
      })
      : async () => window.__statsFakePlayer;
    window.__sharedIndexedDbWrites = 0;
    window.__sharedClipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => { window.__sharedClipboardWrites.push(text); }
      }
    });
    for (const method of ['add', 'put', 'delete', 'clear']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        window.__sharedIndexedDbWrites += 1;
        return original.apply(this, args);
      };
    }
  }, { delayPlayer });
}

test('shared route parser accepts safe names and rejects paths or file extensions', async ({ page }) => {
  await page.goto('/stats/');
  const result = await page.evaluate(async () => {
    const { buildSharedReviewUrl, parseStatsRoute } = await import('/stats/js/review-route.js');
    return {
      valid: parseStatsRoute('?mode=shared&game=game-20260927'),
      missing: parseStatsRoute('?mode=shared'),
      traversal: parseStatsRoute('?mode=shared&game=..%2Fsecret'),
      extension: parseStatsRoute('?mode=shared&game=game.json'),
      whitespace: parseStatsRoute('?mode=shared&game=%20game'),
      filtered: parseStatsRoute(
        '?mode=shared&game=game-20260927&tl-player=p1&tl-player=p2'
        + '&tl-type=shot&tl-type=invalid&tl-pressure=open&tl-comment=with'
      ),
      built: buildSharedReviewUrl('game-20260927', '/rotations/stats/'),
      builtFiltered: buildSharedReviewUrl('game-20260927', '/rotations/stats/', {
        players: ['p1'],
        types: ['shot'],
        shotPressures: ['open'],
        comment: 'with'
      })
    };
  });

  expect(result).toEqual({
    valid: { mode: 'shared', status: 'ready', snapshotName: 'game-20260927' },
    missing: { mode: 'shared', status: 'missing-game', snapshotName: null },
    traversal: { mode: 'shared', status: 'invalid-game', snapshotName: null },
    extension: { mode: 'shared', status: 'invalid-game', snapshotName: null },
    whitespace: { mode: 'shared', status: 'invalid-game', snapshotName: null },
    filtered: {
      mode: 'shared',
      status: 'ready',
      snapshotName: 'game-20260927',
      timelineFilters: {
        types: ['shot'],
        shotPressures: ['open'],
        players: ['p1', 'p2'],
        comment: 'with'
      }
    },
    built: '/rotations/stats/?mode=shared&game=game-20260927',
    builtFiltered: '/rotations/stats/?mode=shared&game=game-20260927'
      + '&tl-type=shot&tl-pressure=open&tl-player=p1&tl-comment=with'
  });
});

test('published game opens as a reload-safe zero-write shared Review link', async ({ page, request }) => {
  await installSharedTestEnvironment(page);
  const publishedResponse = await request.get('/games/game-20260927.json');
  expect(publishedResponse.ok()).toBe(true);
  const publishedBackup = await publishedResponse.json();

  await page.goto('/stats/?mode=shared&game=game-20260927&ignored=value');
  await page.evaluate(() => window.__statsApp.ready);

  expect(new URL(page.url()).search).toBe('?mode=shared&game=game-20260927');
  await expect(page.locator('#reviewModeLabel')).toHaveText('Shared read-only review');
  await expect(page.locator('#reviewModeTitle')).toHaveText(publishedBackup.game.title);
  await expect(page.locator('#reviewModeOpponent')).toHaveText(`vs ${publishedBackup.game.opponentName}`);
  await expect(page.locator('.event-list-item')).toHaveCount(publishedBackup.game.events.length);
  await expect(page.locator('#gamePanel, #eventEntryPanel, #eventEditDialog, #coachCommentDialog')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    reviewMode: window.__statsApp.reviewMode,
    sharedMode: window.__statsApp.sharedMode,
    setup: Boolean(window.__statsApp.setupController),
    event: Boolean(window.__statsApp.eventController),
    review: Boolean(window.__statsApp.reviewController),
    writes: window.__sharedIndexedDbWrites
  }))).toEqual({
    reviewMode: true,
    sharedMode: true,
    setup: false,
    event: false,
    review: true,
    writes: 0
  });

  const firstEvent = publishedBackup.game.events
    .slice()
    .sort((a, b) => a.videoSeconds - b.videoSeconds || a.sequence - b.sequence)[0];
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator(`.event-list-item[data-event-id="${firstEvent.id}"] .event-time`).click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', Math.max(0, firstEvent.videoSeconds - 3)],
    ['play']
  ]);

  await page.locator('[data-review-section="shots"]').click();
  await expect(page.locator('#shotReportSummary')).toBeVisible();
  await page.locator('#shotReportScope').selectOption('opponent');
  await page.locator('#shotReportResult').selectOption('missed');
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);

  await page.reload();
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewModeTitle')).toHaveText(publishedBackup.game.title);
  await expect(page.locator('.event-list-item')).toHaveCount(publishedBackup.game.events.length);
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);
});

test('shared timeline filters survive reload, update the URL, and copy as a link', async ({ page, request }) => {
  await installSharedTestEnvironment(page);
  const publishedBackup = await request.get('/games/game-20260927.json').then(response => response.json());
  const playerShot = publishedBackup.game.events.find(event =>
    event.type === 'shot' && event.side === 'team' && event.playerId
  );
  expect(playerShot).toBeTruthy();
  const player = publishedBackup.game.players.find(item => item.id === playerShot.playerId);
  const expectedPlayerShots = publishedBackup.game.events.filter(event =>
    event.type === 'shot'
    && (
      event.playerId === player.id
      || event.playerInId === player.id
      || event.playerOutId === player.id
      || Boolean(
        player.number
        && [...String(event.coachComment || '').matchAll(/@([A-Za-z0-9]+)/g)]
          .some(match => match[1].toLowerCase() === String(player.number).toLowerCase())
      )
    )
  );
  const allShots = publishedBackup.game.events.filter(event => event.type === 'shot');
  const playerLabel = player.number ? `#${player.number} ${player.name}` : player.name;

  await page.goto(
    `/stats/?mode=shared&game=game-20260927`
    + `&tl-player=${encodeURIComponent(player.id)}&tl-player=missing-player`
    + '&tl-type=shot&tl-type=invalid&ignored=value'
  );
  await page.evaluate(() => window.__statsApp.ready);

  await expect(page.locator('.event-list-item')).toHaveCount(expectedPlayerShots.length);
  await expect(page.locator('#activeEventFilters .filter-chip-label')).toHaveText([
    'Shot',
    playerLabel
  ]);
  let url = new URL(page.url());
  expect(url.searchParams.getAll('tl-player')).toEqual([player.id]);
  expect(url.searchParams.getAll('tl-type')).toEqual(['shot']);
  expect(url.searchParams.has('ignored')).toBe(false);

  await page.reload();
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('.event-list-item')).toHaveCount(expectedPlayerShots.length);

  await page.locator('.filter-chip[data-filter-group="players"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(allShots.length);
  expect(new URL(page.url()).searchParams.has('tl-player')).toBe(false);

  await page.locator('#openEventFilters').click();
  await page.locator(`input[name="filterPlayer"][value="${player.id}"]`).check();
  await page.locator('#eventFilterForm button[type="submit"]').click();
  await expect(page.locator('.event-list-item')).toHaveCount(expectedPlayerShots.length);
  url = new URL(page.url());
  expect(url.searchParams.getAll('tl-player')).toEqual([player.id]);

  await page.locator('#copyFilteredReviewLink').click();
  await expect(page.locator('#copyFilteredReviewStatus')).toHaveText('Filtered link copied.');
  expect(await page.evaluate(() => window.__sharedClipboardWrites)).toEqual([page.url()]);
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);
});

test('shared player filters include jersey mentions without including team mentions', async ({ page, request }) => {
  await installSharedTestEnvironment(page);
  const publishedBackup = await request.get('/games/game-20260927.json').then(response => response.json());
  const player = publishedBackup.game.players.find(item => item.number === '13');
  expect(player).toBeTruthy();

  const mentions = event => [...String(event.coachComment || '').matchAll(/@([A-Za-z0-9]+)/g)]
    .map(match => match[1].toLowerCase());
  const directlyInvolvesPlayer = event => [
    event.playerId,
    event.playerInId,
    event.playerOutId
  ].includes(player.id);
  const expectedEventIds = publishedBackup.game.events
    .filter(event =>
      directlyInvolvesPlayer(event)
      || mentions(event).includes(String(player.number).toLowerCase())
    )
    .map(event => event.id);
  const mentionedOnlyEvent = publishedBackup.game.events.find(event =>
    !directlyInvolvesPlayer(event)
    && mentions(event).includes(String(player.number).toLowerCase())
  );
  const teamOnlyEventIds = publishedBackup.game.events
    .filter(event =>
      !directlyInvolvesPlayer(event)
      && !mentions(event).includes(String(player.number).toLowerCase())
      && mentions(event).includes('team')
    )
    .map(event => event.id);
  expect(mentionedOnlyEvent).toBeTruthy();
  expect(teamOnlyEventIds.length).toBeGreaterThan(0);

  await page.goto(
    `/stats/?mode=shared&game=game-20260927&tl-player=${encodeURIComponent(player.id)}`
  );
  await page.evaluate(() => window.__statsApp.ready);

  const visibleEventIds = await page.locator('.event-list-item').evaluateAll(items =>
    items.map(item => item.dataset.eventId)
  );
  expect([...visibleEventIds].sort()).toEqual([...expectedEventIds].sort());
  expect(visibleEventIds).toContain(mentionedOnlyEvent.id);
  expect(visibleEventIds.some(eventId => teamOnlyEventIds.includes(eventId))).toBe(false);
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);
});

test('single-player shared links open a personalized navigable feedback view', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await installSharedTestEnvironment(page);
  const publishedBackup = await request.get('/games/game-20260927.json').then(response => response.json());
  const game = publishedBackup.game;
  const player = game.players.find(item => item.number === '13');
  const mentions = event => [...String(event.coachComment || '').matchAll(/@([A-Za-z0-9]+)/g)]
    .map(match => match[1].toLowerCase());
  const directlyInvolvesPlayer = event => [
    event.playerId,
    event.playerInId,
    event.playerOutId
  ].includes(player.id);
  const feedbackEvents = game.events
    .filter(event =>
      String(event.coachComment || '').trim()
      && (
        directlyInvolvesPlayer(event)
        || mentions(event).includes(String(player.number).toLowerCase())
      )
    )
    .sort((a, b) => a.videoSeconds - b.videoSeconds || a.sequence - b.sequence);
  const mentionedOnlyEvent = feedbackEvents.find(event => !directlyInvolvesPlayer(event));
  const playerShots = game.events.filter(event =>
    event.side === 'team'
    && event.type === 'shot'
    && [2, 3].includes(event.shotValue)
    && event.playerId === player.id
  );
  const plottedPlayerShots = playerShots.filter(event => event.shotDetails?.location);
  expect(feedbackEvents.length).toBeGreaterThan(1);
  expect(mentionedOnlyEvent).toBeTruthy();

  await page.goto(
    `/stats/?mode=shared&game=game-20260927`
    + `&tl-player=${encodeURIComponent(player.id)}&tl-comment=with`
  );
  await page.evaluate(() => window.__statsApp.ready);

  await expect(page.locator('#reviewModeHeader')).toBeHidden();
  await expect(page.locator('#videoCardTitle')).toHaveText(
    `Feedback for #${player.number} ${player.name} · vs ${game.opponentName}`
  );
  await expect(page.locator('#viewFullGameReview')).toHaveAttribute(
    'href',
    '/stats/?mode=shared&game=game-20260927'
  );
  await expect(page.locator('#viewFullGameReview')).toBeVisible();
  await expect(page.locator('#reviewModeHeader .nav-link', { hasText: 'Exit review' })).toBeHidden();
  await expect(page.locator('#eventLogPanel')).toBeHidden();
  await expect(page.locator('#reviewNavigation')).toBeHidden();
  await expect(page.locator('#reportCard')).toBeHidden();
  await expect(page.locator('#playVideo')).toBeHidden();
  await expect(page.locator('#pauseVideo')).toBeHidden();
  await expect(page.locator('#videoStatus')).toBeHidden();
  await expect(page.locator('#videoCurrentPosition')).toBeHidden();
  await expect(page.locator('#videoResizeHandle')).toBeHidden();
  await expect(page.locator('.video-size-actions')).toBeHidden();
  await expect(page.locator('#sharedFeedbackPanel')).toBeVisible();
  await expect(page.locator('#sharedFeedbackMomentPosition')).toHaveText(`1 of ${feedbackEvents.length}`);
  await expect(page.locator('#sharedFeedbackEventTime')).toHaveText(/\d+:\d{2}\.\d/);
  await expect(page.locator('#sharedFeedbackComment')).toHaveText(feedbackEvents[0].coachComment);
  await expect(page.locator('#focusedPlayerReportCard')).toBeVisible();
  await expect(page.locator('#focusedPlayerReportTitle')).toHaveText(
    `#${player.number} ${player.name} stats`
  );
  const expectedPlayerStats = await page.evaluate(async playerId => {
    const gameBackup = await fetch('/games/game-20260927.json').then(response => response.json());
    const { buildGameAnalysis } = await import('/stats/js/event-reducer.js');
    return buildGameAnalysis(gameBackup.game).report.players[playerId];
  }, player.id);
  await expect(page.locator('#focusedPlayerStats [data-player-stat="points"] dd'))
    .toHaveText(String(expectedPlayerStats.points));
  await expect(page.locator('#focusedPlayerShotSummary'))
    .toContainText(`${playerShots.filter(event => event.made).length}/${playerShots.length} FG`);
  await expect(page.locator('#focusedPlayerShotChartPlot .shot-chart-marker'))
    .toHaveCount(plottedPlayerShots.length);
  await expect.poll(() => page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', Math.max(0, feedbackEvents[0].videoSeconds - 5)],
    ['pause']
  ]);
  expect(await page.evaluate(() => window.__statsFakePlayer.current)).toBe(
    Math.max(0, feedbackEvents[0].videoSeconds - 5)
  );
  const focusedLayout = await page.evaluate(() => Object.fromEntries(
    Object.entries({
      panel: '#sharedFeedbackPanel',
      video: '#playerFrame',
      fullGame: '#viewFullGameReview',
      playerReport: '#focusedPlayerReportCard',
      videoCard: '.video-card',
      shell: '#reviewShell',
      column: '.center-panel'
    }).map(([key, selector]) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return [key, { top: box.top, bottom: box.bottom, left: box.left, width: box.width }];
    })
  ));
  expect(focusedLayout.panel.bottom).toBeLessThanOrEqual(focusedLayout.video.top);
  expect(focusedLayout.fullGame.top).toBeGreaterThanOrEqual(focusedLayout.video.bottom);
  expect(focusedLayout.playerReport.top).toBeGreaterThanOrEqual(focusedLayout.videoCard.bottom);
  const shellCenter = focusedLayout.shell.left + focusedLayout.shell.width / 2;
  const columnCenter = focusedLayout.column.left + focusedLayout.column.width / 2;
  expect(Math.abs(shellCenter - columnCenter)).toBeLessThan(2);

  const mentionedOnlyIndex = feedbackEvents.findIndex(event => event.id === mentionedOnlyEvent.id);
  expect(mentionedOnlyIndex).toBeGreaterThan(0);
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#nextSharedFeedbackMoment').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', Math.max(0, feedbackEvents[1].videoSeconds - 5)],
    ['pause']
  ]);
  await expect(page.locator('#sharedFeedbackMomentPosition')).toHaveText(`2 of ${feedbackEvents.length}`);
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#previousSharedFeedbackMoment').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', Math.max(0, feedbackEvents[0].videoSeconds - 5)],
    ['pause']
  ]);
  await expect(page.locator('#sharedFeedbackMomentPosition')).toHaveText(`1 of ${feedbackEvents.length}`);

  for (let index = 0; index < mentionedOnlyIndex; index += 1) {
    await page.locator('#nextSharedFeedbackMoment').click();
  }
  await expect(page.locator('#sharedFeedbackReason')).toHaveText(`Mentioned @${player.number}`);
  await expect(page.locator('#sharedFeedbackComment')).toHaveText(mentionedOnlyEvent.coachComment);
  const feedbackCardLayout = await page.locator('#sharedFeedbackMomentCard').evaluate(card => {
    const cardBox = card.getBoundingClientRect();
    const commentBox = card.querySelector('#sharedFeedbackComment').getBoundingClientRect();
    const eventBox = card.querySelector('.shared-feedback-event-row').getBoundingClientRect();
    const metadataBox = card.querySelector('.shared-feedback-metadata').getBoundingClientRect();
    const commentStyle = getComputedStyle(card.querySelector('#sharedFeedbackComment'));
    const eventStyle = getComputedStyle(card.querySelector('#sharedFeedbackEventDescription'));
    const metadataStyle = getComputedStyle(card.querySelector('.shared-feedback-metadata'));
    return {
      columns: getComputedStyle(card).gridTemplateColumns.split(' ').length,
      cardWidth: cardBox.width,
      commentWidth: commentBox.width,
      commentTop: commentBox.top,
      eventTop: eventBox.top,
      metadataTop: metadataBox.top,
      commentFontSize: Number.parseFloat(commentStyle.fontSize),
      eventFontSize: Number.parseFloat(eventStyle.fontSize),
      metadataFontSize: Number.parseFloat(metadataStyle.fontSize)
    };
  });
  expect(feedbackCardLayout.columns).toBe(1);
  expect(feedbackCardLayout.commentWidth).toBeGreaterThan(feedbackCardLayout.cardWidth * 0.9);
  expect(feedbackCardLayout.commentTop).toBeLessThan(feedbackCardLayout.eventTop);
  expect(feedbackCardLayout.eventTop).toBeLessThan(feedbackCardLayout.metadataTop);
  expect(feedbackCardLayout.commentFontSize).toBeGreaterThan(feedbackCardLayout.eventFontSize);
  expect(feedbackCardLayout.eventFontSize).toBeGreaterThan(feedbackCardLayout.metadataFontSize);

  await expect(page.locator('#replaySharedFeedbackMoment')).toHaveCount(0);
  await expect(page.locator('#playSharedFeedbackLeadIn')).toHaveText('▶ Play moment');
  await page.evaluate(() => {
    window.__statsFakePlayer.calls = [];
    window.__fullscreenRequests = 0;
    window.__fullscreenElement = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => window.__fullscreenElement
    });
    document.querySelector('#playerFrame').requestFullscreen = function () {
      window.__fullscreenRequests += 1;
      window.__fullscreenElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });
  await page.locator('#playSharedFeedbackLeadIn').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', Math.max(0, mentionedOnlyEvent.videoSeconds - 5)],
    ['play']
  ]);
  expect(await page.evaluate(() => window.__fullscreenRequests)).toBe(0);

  await page.locator('#viewFullGameReview').click();
  await page.waitForURL('**/stats/?mode=shared&game=game-20260927');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewModeLabel')).toHaveText('Shared read-only review');
  await expect(page.locator('#reviewModeTitle')).toHaveText(game.title);
  await expect(page.locator('#reviewModeHeader')).toBeVisible();
  await expect(page.locator('#videoCardTitle')).toHaveText('Recording');
  await expect(page.locator('#sharedPlayerFeedbackSummary')).toBeHidden();
  await expect(page.locator('#sharedFeedbackPanel')).toBeHidden();
  await expect(page.locator('#focusedPlayerReportCard')).toBeHidden();
  await expect(page.locator('#eventLogPanel')).toBeVisible();
  await expect(page.locator('#reviewNavigation')).toBeVisible();
  await expect(page.locator('#playVideo')).toBeVisible();
  await expect(page.locator('#pauseVideo')).toBeVisible();
  await expect(page.locator('#videoStatus')).toBeVisible();
  await expect(page.locator('#videoCurrentPosition')).toBeVisible();
  await expect(page.locator('#videoResizeHandle')).toBeVisible();
  await expect(page.locator('.video-size-actions')).toBeVisible();
});

test('focused feedback controls wait for the recording player to initialize', async ({ page }) => {
  await installSharedTestEnvironment(page, { delayPlayer: true });
  await page.goto(
    '/stats/?mode=shared&game=game-20260927'
    + '&tl-player=b919d79b-4d8e-4505-a70b-8a4e139cd660&tl-comment=with'
  );
  await page.evaluate(() => window.__statsApp.ready);

  await expect(page.locator('#previousSharedFeedbackMoment')).toBeDisabled();
  await expect(page.locator('#nextSharedFeedbackMoment')).toBeDisabled();
  await expect(page.locator('#playSharedFeedbackLeadIn')).toBeDisabled();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([]);

  await page.evaluate(() => window.__resolveStatsFakePlayer());

  await expect(page.locator('#nextSharedFeedbackMoment')).toBeEnabled();
  await expect(page.locator('#playSharedFeedbackLeadIn')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__statsFakePlayer.calls.length)).toBe(2);
  const initialCalls = await page.evaluate(() => window.__statsFakePlayer.calls);
  expect(initialCalls[0][0]).toBe('seek');
  expect(initialCalls[1]).toEqual(['pause']);
});

test('single-player shared feedback replaces the mobile timeline sheet', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await installSharedTestEnvironment(page);
  await page.goto(
    '/stats/?mode=shared&game=game-20260927'
    + '&tl-player=b919d79b-4d8e-4505-a70b-8a4e139cd660&tl-comment=with'
  );
  await page.evaluate(() => window.__statsApp.ready);

  await expect(page.locator('#eventLogPanel')).toBeHidden();
  await expect(page.locator('#sharedFeedbackPanel')).toBeVisible();
  await expect(page.locator('#sharedFeedbackComment')).toBeVisible();
  await expect(page.locator('#focusedPlayerReportCard')).toBeVisible();
  const playerReportLayout = await page.evaluate(() => {
    const card = document.querySelector('#focusedPlayerReportCard').getBoundingClientRect();
    const chart = document.querySelector('#focusedPlayerShotChart').getBoundingClientRect();
    return {
      cardWidth: card.width,
      chartWidth: chart.width,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth
    };
  });
  expect(playerReportLayout.chartWidth).toBeLessThanOrEqual(playerReportLayout.cardWidth);
  expect(playerReportLayout.pageWidth).toBeLessThanOrEqual(playerReportLayout.viewportWidth);
  await expect(page.locator('#playFocusedFeedbackVideo')).toBeVisible();
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('#playFocusedFeedbackVideo').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['play']
  ]);
  await expect(page.locator('#playFocusedFeedbackVideo')).toBeHidden();
  await page.evaluate(() => {
    window.__statsFakePlayer.calls = [];
    window.__fullscreenRequests = 0;
    document.querySelector('#playerFrame').requestFullscreen = () => {
      window.__fullscreenRequests += 1;
      return Promise.resolve();
    };
  });
  await page.locator('#playSharedFeedbackLeadIn').click();
  const playback = await page.evaluate(() => ({
    fullscreenRequests: window.__fullscreenRequests,
    playerCalls: window.__statsFakePlayer.calls
  }));
  expect(playback.fullscreenRequests).toBe(1);
  expect(playback.playerCalls).toHaveLength(2);
  expect(playback.playerCalls[0][0]).toBe('seek');
  expect(playback.playerCalls[1]).toEqual(['play']);

  await page.evaluate(() => {
    window.__fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  expect(await page.evaluate(() => window.__statsFakePlayer.calls.at(-1))).toEqual(['pause']);
  await expect(page.locator('#playFocusedFeedbackVideo')).toBeVisible();

  await page.setViewportSize({ width: 900, height: 600 });
  await page.evaluate(() => {
    window.__statsFakePlayer.calls = [];
    window.__fullscreenRequests = 0;
  });
  await page.locator('#playSharedFeedbackLeadIn').click();
  expect(await page.evaluate(() => window.__fullscreenRequests)).toBe(1);
});

test('shared routes show explicit missing, unsafe, unavailable, and invalid backup errors', async ({ page }) => {
  await installSharedTestEnvironment(page);

  await page.goto('/stats/?mode=shared');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Select a shared game');
  await expect(page.locator('#reviewRouteMessage')).toContainText('does not identify a published game');

  await page.goto('/stats/?mode=shared&game=..%2Fsecret');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Invalid shared review link');

  await page.goto('/stats/?mode=shared&game=missing-game');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Shared game not found');
  await expect(page.locator('#reviewRouteMessage')).toContainText('file was not found');

  await page.route('**/games/malformed.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{not json'
  }));
  await page.goto('/stats/?mode=shared&game=malformed');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Shared game cannot be reviewed');
  await expect(page.locator('#reviewRouteMessage')).toContainText('not valid JSON');

  await page.route('**/games/wrong-app.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      backupVersion: 1,
      application: 'another-application',
      exportedAt: '2026-09-30T00:00:00.000Z',
      game: {}
    })
  }));
  await page.goto('/stats/?mode=shared&game=wrong-app');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteTitle')).toHaveText('Shared game cannot be reviewed');
  await expect(page.locator('#reviewRouteMessage')).toContainText('not created by Basketball Stats');

  await page.route('**/games/unavailable.json', route => route.abort('failed'));
  await page.goto('/stats/?mode=shared&game=unavailable');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteMessage')).toContainText('could not be downloaded');

  await page.route('**/games/oversized.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: 'x'.repeat(1024 * 1024 + 1)
  }));
  await page.goto('/stats/?mode=shared&game=oversized');
  await page.evaluate(() => window.__statsApp.ready);
  await expect(page.locator('#reviewRouteMessage')).toContainText('too large');
  expect(await page.evaluate(() => window.__sharedIndexedDbWrites)).toBe(0);
});
