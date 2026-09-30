const { test, expect } = require('@playwright/test');

async function openReview(page, width = 1440) {
  const databaseName = `basketball-stats-review-layout-${Date.now()}-${Math.random()}`;
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(name => {
    window.__STATS_DATABASE_NAME__ = name;
    window.__statsFakePlayer = {
      current: 0,
      playing: false,
      calls: [],
      getCurrentSeconds() { return this.current; },
      seekTo(seconds) { this.current = seconds; this.calls.push(['seek', seconds]); },
      play() { this.playing = true; this.calls.push(['play']); },
      isPlaying() { return this.playing; },
      pause() { this.playing = false; this.calls.push(['pause']); },
      destroy() {}
    };
    window.__STATS_PLAYER_FACTORY__ = async () => window.__statsFakePlayer;
  }, databaseName);
  await page.goto('/stats/');
  await page.evaluate(() => window.__statsApp.ready);
  const game = await page.evaluate(async () => {
    const fixture = await fetch('/stats/docs/fixtures/review-view-game-v1.json').then(response => response.json());
    await window.__statsApp.store.saveGame(fixture);
    return fixture;
  });
  await page.goto(`/stats/?mode=review&game=${encodeURIComponent(game.id)}`);
  await page.evaluate(() => window.__statsApp.ready);
  return game;
}

test('Review view uses video-first section navigation', async ({ page }) => {
  const game = await openReview(page);

  await expect(page.locator('#statsHero')).toBeHidden();
  await expect(page.locator('#reviewModeTitle')).toHaveText(game.title);
  await expect(page.locator('#reviewModeScore')).toHaveText('5–3');
  await expect(page.locator('#reviewNavigation')).toBeVisible();
  await expect(page.locator('#reviewNavigation')).toHaveAttribute('aria-label', 'Review reports');
  await expect(page.locator('[data-review-section]')).toHaveText([
    'Team', 'Players', 'Lineups', 'Feedback'
  ]);
  await expect(page.locator('[data-review-section="team"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#eventLogPanel')).toBeVisible();
  await expect(page.locator('#reportCard')).toBeVisible();
  await expect(page.locator('#teamReportSection')).toBeVisible();
  await expect(page.locator('#eventOrderDescription')).toHaveText('Earliest first.');
  await expect(page.locator('#toggleEventOrder')).toHaveAttribute('aria-label', 'Show latest events first');
  expect(await page.locator('.event-list-item').evaluateAll(items =>
    items.map(item => item.dataset.eventId)
  )).toEqual(game.events.map(event => event.id));
  await expect(page.locator('.event-list-item[data-event-id="e1"] .event-description'))
    .toHaveText('Alex made 2PT - 2:0');
  await expect(page.locator('.event-list-item[data-event-id="e4"] .event-description'))
    .toHaveText('Opponent made 2PT - 2:2');
  await expect(page.locator('.event-list-item[data-event-id="e5"] .event-description'))
    .toHaveText('Casey missed 3PT');
  await expect(page.locator('.event-list-item[data-event-id="e8"] .event-description'))
    .toHaveText('Flynn made 3PT - 5:2');
  await expect(page.locator('#eventLogPanel .section-head p')).toContainText('Play recorded events');

  const videoAndTimeline = await page.locator('.video-card, #eventLogPanel').evaluateAll(elements =>
    elements.map(element => {
      const box = element.getBoundingClientRect();
      return { y: box.y, width: box.width };
    })
  );
  expect(Math.abs(videoAndTimeline[0].y - videoAndTimeline[1].y)).toBeLessThan(2);
  expect(videoAndTimeline[0].width).toBeGreaterThan(videoAndTimeline[1].width);
  expect(await page.locator('.capture-panel').evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
  expect(await page.locator('#eventList').evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  const headerTop = await page.locator('#eventLogPanel .section-head').evaluate(element =>
    element.getBoundingClientRect().top
  );
  await page.locator('#eventList').evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await page.locator('#eventList').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#eventLogPanel .section-head').evaluate(element =>
    element.getBoundingClientRect().top
  )).toBeCloseTo(headerTop, 1);
  await expect(page.locator('#videoResizeHandle')).toBeVisible();
  await page.locator('#decreaseVideoSize').click();
  await expect(page.locator('#videoSizeValue')).toHaveText('65%');
  const resizedWidths = await page.locator('.video-card, #eventLogPanel').evaluateAll(elements =>
    elements.map(element => element.getBoundingClientRect().width)
  );
  expect(resizedWidths[0]).toBeLessThan(videoAndTimeline[0].width);
  expect(resizedWidths[1]).toBeGreaterThan(videoAndTimeline[1].width);

  await page.locator('[data-review-section="players"]').click();
  await expect(page.locator('#eventLogPanel')).toBeVisible();
  await expect(page.locator('#playerReportSection')).toBeVisible();
  await expect(page.locator('#teamReportSection')).toBeHidden();
  await expect(page.locator('#reportSourceSection')).toBeVisible();

  await page.locator('[data-review-section="lineups"]').click();
  await expect(page.locator('#lineupReportSection')).toBeVisible();
  await expect(page.locator('#playerReportSection')).toBeHidden();

  await page.locator('[data-review-section="feedback"]').click();
  await expect(page.locator('#feedbackReportSection')).toBeVisible();
  await expect(page.locator('#reportSourceSection')).toBeHidden();
});

test('wide Review view uses more screen width while keeping reports readable', async ({ page }) => {
  await openReview(page, 1920);

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('#reviewShell').getBoundingClientRect();
    const report = document.querySelector('#reportCard').getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      stage: { x: stage.x, width: stage.width },
      report: { x: report.x, width: report.width }
    };
  });

  expect(geometry.stage.width).toBeGreaterThanOrEqual(1759);
  expect(geometry.stage.x).toBeLessThanOrEqual(85);
  expect(geometry.viewport - geometry.stage.x - geometry.stage.width).toBeLessThanOrEqual(85);
  expect(geometry.report.width).toBeGreaterThanOrEqual(1479);
  expect(geometry.report.width).toBeLessThan(geometry.stage.width);
});

test('Review navigation supports arrow keys and video shortcuts ignore selectors', async ({ page }) => {
  await openReview(page);

  const teamTab = page.locator('[data-review-section="team"]');
  await teamTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-review-section="players"]')).toBeFocused();
  await expect(page.locator('[data-review-section="players"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.locator('[data-review-section="feedback"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(teamTab).toBeFocused();

  await page.locator('[data-review-section="feedback"]').click();
  await page.locator('#feedbackPlayer').focus();
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([]);
});

test('Review timeline and report playback use a three-second pre-roll', async ({ page }) => {
  await openReview(page);
  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });

  await page.locator('.event-list-item[data-event-id="e1"] .event-time').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 107],
    ['play']
  ]);

  await page.evaluate(() => { window.__statsFakePlayer.calls = []; });
  await page.locator('[data-review-section="team"]').click();
  await page.locator('#teamComparisonBody tr[data-side="team"] [data-metric="fieldGoals"] button').click();
  await page.locator('#reportSourceList li[data-event-id="e8"] [data-report-event-id]').click();
  expect(await page.evaluate(() => window.__statsFakePlayer.calls)).toEqual([
    ['seek', 147]
  ]);
});

test('Review timeline follows playback and yields to manual scrolling', async ({ page }) => {
  await openReview(page);
  await page.evaluate(() => {
    window.__timelineScrolls = [];
    const panel = document.querySelector('#eventList');
    panel.scrollTo = options => window.__timelineScrolls.push(options);
    window.__statsFakePlayer.playing = true;
    window.__statsFakePlayer.current = 109;
  });

  await expect(page.locator('#eventList [aria-current="true"]')).toHaveCount(0);
  await page.evaluate(() => { window.__statsFakePlayer.current = 110; });
  await expect(page.locator('.event-list-item[data-event-id="e1"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.event-list-item[data-event-id="e1"]')).toHaveClass(/current-event/);
  await expect.poll(() => page.evaluate(() => window.__timelineScrolls.length)).toBeGreaterThan(0);

  await page.evaluate(() => { window.__statsFakePlayer.current = 150; });
  await expect(page.locator('.event-list-item[data-event-id="e9"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.event-list-item[data-event-id="e8"]')).not.toHaveAttribute('aria-current', 'true');

  const scrollCount = await page.evaluate(() => window.__timelineScrolls.length);
  await page.locator('#eventList').dispatchEvent('wheel');
  await expect(page.locator('#followTimelinePlayback')).toBeVisible();
  await page.evaluate(() => { window.__statsFakePlayer.current = 170; });
  await expect(page.locator('.event-list-item[data-event-id="e11"]')).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => page.evaluate(() => window.__timelineScrolls.length)).toBe(scrollCount);

  await page.locator('#followTimelinePlayback').click();
  await expect(page.locator('#followTimelinePlayback')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__timelineScrolls.length)).toBeGreaterThan(scrollCount);
});

for (const width of [1024, 600]) {
  test(`Review layout avoids page overflow at ${width}px`, async ({ page }) => {
    await openReview(page, width);
    await expect(page.locator('#reviewModeHeader')).toBeVisible();
    await expect(page.locator('#reviewNavigation')).toBeVisible();
    if (width > 760) {
      const stage = await page.locator('.video-card, #eventLogPanel').evaluateAll(elements =>
        elements.map(element => element.getBoundingClientRect().y)
      );
      expect(Math.abs(stage[0] - stage[1])).toBeLessThan(2);
    } else {
      await expect(page.locator('#videoResizeHandle')).toBeHidden();
      const stage = await page.locator('.video-card, #eventLogPanel').evaluateAll(elements =>
        elements.map(element => element.getBoundingClientRect().y)
      );
      expect(stage[0]).toBeLessThan(stage[1]);
      await page.evaluate(() => {
        window.__mobileFollowCalls = [];
        document.querySelector('[data-event-id="e11"]').scrollIntoView = options => {
          window.__mobileFollowCalls.push(options);
        };
        window.__statsFakePlayer.playing = true;
        window.__statsFakePlayer.current = 170;
      });
      await expect(page.locator('.event-list-item[data-event-id="e11"]')).toHaveAttribute('aria-current', 'true');
      await expect.poll(() => page.evaluate(() => window.__mobileFollowCalls.length)).toBeGreaterThan(0);
    }
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);

    await page.locator('[data-review-section="players"]').click();
    const tableWrap = page.locator('#playerReportSection .report-table-wrap');
    await expect(tableWrap).toBeVisible();
    const overflow = await tableWrap.evaluate(element => ({
      client: element.clientWidth,
      scroll: element.scrollWidth
    }));
    expect(overflow.scroll).toBeGreaterThanOrEqual(overflow.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
