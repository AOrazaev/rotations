import { describeEvent } from './event-list.js';
import { createShotCourtDiagram } from './shot-court.js';
import {
  SHOT_REPORT_ANY,
  SHOT_REPORT_DIMENSIONS,
  buildShotReport,
  getShotReportPeriods
} from './shot-report.js';
import { formatVideoTime } from './youtube-player.js';

const COMPARISON_METRICS = [
  ['fieldGoals', 'FG'],
  ['twoPoint', '2PT'],
  ['threePoint', '3PT'],
  ['freeThrows', 'FT'],
  ['offensiveRebounds', 'Offensive rebounds'],
  ['defensiveRebounds', 'Defensive rebounds'],
  ['assists', 'Assists'],
  ['steals', 'Steals'],
  ['blocks', 'Blocks'],
  ['turnovers', 'Turnovers'],
  ['fouls', 'Fouls']
];
const FEEDBACK_PREVIEW_SECONDS = 3;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SCORE_CHART = {
  width: 600,
  height: 180,
  left: 38,
  right: 14,
  top: 14,
  bottom: 28
};

function lineupKey(playerIds) {
  return [...playerIds].sort().join('|');
}

function formatShooting(line) {
  const percentage = line.percentage == null
    ? '—'
    : `${Number(line.percentage.toFixed(1))}%`;
  return `${line.made}/${line.attempted} (${percentage})`;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function formatPercentage(value) {
  return value == null ? '—' : `${Number(value.toFixed(1))}%`;
}

function addCell(row, content, className = '') {
  const cell = row.insertCell();
  cell.className = className;
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = String(content);
  return cell;
}

export function createReportController({
  documentObject = document,
  videoController,
  previewSeconds = 0,
  playerReview = false
}) {
  const reportCard = documentObject.querySelector('#reportCard');
  const finalScore = documentObject.querySelector('#reportFinalScore');
  const comparisonHead = documentObject.querySelector('#teamComparisonHead');
  const comparisonBody = documentObject.querySelector('#teamComparisonBody');
  const playerBody = documentObject.querySelector('#playerReportBody');
  const lineupBody = documentObject.querySelector('#lineupReportBody');
  const progression = documentObject.querySelector('#scoreProgression');
  const emptyProgression = documentObject.querySelector('#emptyScoreProgression');
  const shotReportSection = documentObject.querySelector('#shotReportSection');
  const shotReportScope = documentObject.querySelector('#shotReportScope');
  const shotReportPeriod = documentObject.querySelector('#shotReportPeriod');
  const shotReportResult = documentObject.querySelector('#shotReportResult');
  const shotReportPressure = documentObject.querySelector('#shotReportPressure');
  const shotReportPhase = documentObject.querySelector('#shotReportPhase');
  const shotReportContext = documentObject.querySelector('#shotReportContext');
  const shotReportCreation = documentObject.querySelector('#shotReportCreation');
  const clearShotReportFilters = documentObject.querySelector('#clearShotReportFilters');
  const shotReportSummary = documentObject.querySelector('#shotReportSummary');
  const shotChart = documentObject.querySelector('#shotChart');
  const shotChartPlot = documentObject.querySelector('#shotChartPlot');
  const emptyShotChart = documentObject.querySelector('#emptyShotChart');
  const shotZonePlot = documentObject.querySelector('#shotZonePlot');
  const shotZoneNoLocation = documentObject.querySelector('#shotZoneNoLocation');
  const shotSplitReports = documentObject.querySelector('#shotSplitReports');
  const sourceTitle = documentObject.querySelector('#reportSourceTitle');
  const sourceList = documentObject.querySelector('#reportSourceList');
  const sourceEmpty = documentObject.querySelector('#reportSourceEmpty');
  const reportError = documentObject.querySelector('#reportError');
  const feedbackPlayer = documentObject.querySelector('#feedbackPlayer');
  const feedbackSummary = documentObject.querySelector('#feedbackPlayerSummary');
  const feedbackNavigation = documentObject.querySelector('#feedbackMomentNavigation');
  const previousFeedbackButton = documentObject.querySelector('#previousFeedbackMoment');
  const nextFeedbackButton = documentObject.querySelector('#nextFeedbackMoment');
  const feedbackPosition = documentObject.querySelector('#feedbackMomentPosition');
  const feedbackList = documentObject.querySelector('#playerFeedbackList');
  const emptyFeedback = documentObject.querySelector('#emptyPlayerFeedback');
  const copyFeedbackButton = documentObject.querySelector('#copyPlayerFeedback');
  const copyYouTubeFeedbackButton = documentObject.querySelector('#copyYouTubeFeedback');
  const feedbackStatus = documentObject.querySelector('#playerFeedbackStatus');

  let game = null;
  let analysis = null;
  let selectedFeedbackPlayerId = null;
  let activeFeedbackEventId = null;
  let shotZoneRenderSequence = 0;

  function shotReportFilters() {
    return {
      scope: shotReportScope.value || 'team',
      period: shotReportPeriod.value || SHOT_REPORT_ANY,
      result: shotReportResult.value || SHOT_REPORT_ANY,
      pressure: shotReportPressure.value || SHOT_REPORT_ANY,
      phase: shotReportPhase.value || SHOT_REPORT_ANY,
      context: shotReportContext.value || SHOT_REPORT_ANY,
      creation: shotReportCreation.value || SHOT_REPORT_ANY
    };
  }

  function renderShotScopeOptions() {
    const previous = shotReportScope.value;
    shotReportScope.innerHTML = '';
    for (const [value, label] of [
      ['team', 'Our team'],
      ['opponent', game.opponentName?.trim() || 'Opponent'],
      ...game.players.map(player => [
        `player:${player.id}`,
        player.number ? `#${player.number} ${player.name}` : player.name
      ])
    ]) {
      const option = documentObject.createElement('option');
      option.value = value;
      option.textContent = label;
      shotReportScope.appendChild(option);
    }

    shotReportScope.value = [...shotReportScope.options].some(option => option.value === previous)
      ? previous
      : 'team';
  }

  function renderShotPeriodOptions() {
    const previous = shotReportPeriod.value;
    shotReportPeriod.innerHTML = '';
    const all = documentObject.createElement('option');
    all.value = SHOT_REPORT_ANY;
    all.textContent = 'All periods';
    shotReportPeriod.appendChild(all);
    for (const period of getShotReportPeriods(game)) {
      const option = documentObject.createElement('option');
      option.value = period.value;
      option.textContent = period.label;
      shotReportPeriod.appendChild(option);
    }
    shotReportPeriod.value = [...shotReportPeriod.options].some(option => option.value === previous)
      ? previous
      : SHOT_REPORT_ANY;
  }

  function setError(message = '') {
    reportError.textContent = message;
    reportError.classList.toggle('hidden', !message);
  }

  function setFeedbackStatus(message = '', isError = false) {
    feedbackStatus.textContent = message;
    feedbackStatus.classList.toggle('error', isError);
  }

  function commentMentionsPlayer(comment, player) {
    const mentions = [...String(comment || '').matchAll(/@([A-Za-z0-9]+)/g)]
      .map(match => match[1].toLowerCase());
    return mentions.includes('team')
      || Boolean(player.number && mentions.includes(String(player.number).toLowerCase()));
  }

  function feedbackEvents(player) {
    return analysis.orderedEventIds
      .map(eventId => game.events.find(event => event.id === eventId))
      .filter(event => event
        && String(event.coachComment || '').trim()
        && (
          event.playerId === player.id
          || event.playerInId === player.id
          || event.playerOutId === player.id
          || commentMentionsPlayer(event.coachComment, player)
        ));
  }

  function feedbackSeconds(event) {
    return Math.max(0, event.videoSeconds - FEEDBACK_PREVIEW_SECONDS);
  }

  function feedbackUrl(event) {
    return `https://youtu.be/${encodeURIComponent(game.video.videoId)}?t=${Math.floor(feedbackSeconds(event))}`;
  }

  function formatYouTubeTimestamp(seconds) {
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = String(totalSeconds % 60).padStart(2, '0');
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${remainingSeconds}`
      : `${minutes}:${remainingSeconds}`;
  }

  function renderFeedbackSummary(player) {
    feedbackSummary.innerHTML = '';
    feedbackSummary.classList.toggle('hidden', !playerReview || !player);
    if (!playerReview || !player) return;
    const stats = analysis.report.players[player.id];
    const metrics = [
      ['points', 'Points', stats.points],
      ['fieldGoals', 'FG', `${stats.fieldGoalsMade}/${stats.fieldGoalsAttempted}`],
      ['threePoint', '3PT', `${stats.threePointMade}/${stats.threePointAttempted}`],
      ['freeThrows', 'FT', `${stats.freeThrowsMade}/${stats.freeThrowsAttempted}`],
      ['rebounds', 'Rebounds', stats.offensiveRebounds + stats.defensiveRebounds],
      ['assists', 'Assists', stats.assists],
      ['steals', 'Steals', stats.steals],
      ['blocks', 'Blocks', stats.blocks],
      ['turnovers', 'Turnovers', stats.turnovers],
      ['plusMinus', '+/-', signed(stats.plusMinus)],
      ['efficiency', 'EFF', stats.efficiency],
      ['trueShooting', 'TS%', formatPercentage(stats.trueShootingPercentage)],
      ['videoTime', 'Video time', formatVideoTime(stats.videoSeconds)]
    ];
    for (const [key, label, value] of metrics) {
      const item = documentObject.createElement('div');
      item.className = 'player-review-stat';
      item.dataset.playerStat = key;
      const term = documentObject.createElement('dt');
      term.textContent = label;
      const description = documentObject.createElement('dd');
      description.textContent = value;
      item.append(term, description);
      feedbackSummary.appendChild(item);
    }
  }

  function updateFeedbackMoment(events, { seek = false } = {}) {
    const index = events.findIndex(event => event.id === activeFeedbackEventId);
    for (const item of feedbackList.querySelectorAll('[data-event-id]')) {
      const active = playerReview && item.dataset.eventId === activeFeedbackEventId;
      item.classList.toggle('current-feedback', active);
      if (active) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
    feedbackNavigation.classList.toggle('hidden', !playerReview || index < 0);
    feedbackPosition.textContent = index < 0 ? 'No feedback moments' : `${index + 1} of ${events.length}`;
    previousFeedbackButton.disabled = index <= 0;
    nextFeedbackButton.disabled = index < 0 || index >= events.length - 1;
    if (!seek || index < 0) return;
    try {
      videoController.seekTo(feedbackSeconds(events[index]));
      videoController.play();
      setFeedbackStatus();
      feedbackList.querySelector(`[data-event-id="${CSS.escape(activeFeedbackEventId)}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (error) {
      setFeedbackStatus(error.message || 'Could not play the feedback moment.', true);
    }
  }

  function moveFeedbackMoment(offset) {
    const player = game.players.find(item => item.id === feedbackPlayer.value);
    const events = player ? feedbackEvents(player) : [];
    const currentIndex = events.findIndex(event => event.id === activeFeedbackEventId);
    const nextIndex = Math.min(events.length - 1, Math.max(0, currentIndex + offset));
    if (nextIndex < 0 || nextIndex === currentIndex) return;
    activeFeedbackEventId = events[nextIndex].id;
    updateFeedbackMoment(events, { seek: true });
  }

  function renderFeedback() {
    const previousPlayerId = feedbackPlayer.value;
    feedbackPlayer.innerHTML = '';
    for (const player of game.players) {
      const option = documentObject.createElement('option');
      option.value = player.id;
      option.textContent = player.number ? `#${player.number} ${player.name}` : player.name;
      feedbackPlayer.appendChild(option);
    }
    if (game.players.some(player => player.id === previousPlayerId)) {
      feedbackPlayer.value = previousPlayerId;
    }

    feedbackList.innerHTML = '';
    setFeedbackStatus();
    const player = game.players.find(item => item.id === feedbackPlayer.value);
    const playersById = Object.fromEntries(game.players.map(player => [player.id, player]));
    const events = player ? feedbackEvents(player) : [];
    const playerChanged = player?.id !== selectedFeedbackPlayerId;
    selectedFeedbackPlayerId = player?.id || null;
    if (playerChanged || !events.some(event => event.id === activeFeedbackEventId)) {
      activeFeedbackEventId = events[0]?.id || null;
    }
    renderFeedbackSummary(player);
    emptyFeedback.classList.toggle('hidden', events.length > 0);
    copyFeedbackButton.disabled = events.length === 0;
    copyYouTubeFeedbackButton.disabled = events.length === 0;
    for (const event of events) {
      const item = documentObject.createElement('li');
      item.className = 'player-feedback-item';
      item.dataset.eventId = event.id;
      const include = documentObject.createElement('input');
      include.type = 'checkbox';
      include.checked = true;
      include.className = 'feedback-event-select';
      include.setAttribute('aria-label', `Include ${describeEvent(event, playersById)}`);
      const content = documentObject.createElement('div');
      content.className = 'player-feedback-content';
      const heading = documentObject.createElement('div');
      heading.className = 'player-feedback-heading';
      const link = documentObject.createElement('a');
      link.href = feedbackUrl(event);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = formatVideoTime(feedbackSeconds(event));
      const description = documentObject.createElement('strong');
      description.textContent = describeEvent(event, playersById);
      heading.append(link, description);
      const comment = documentObject.createElement('blockquote');
      comment.className = 'player-feedback-comment';
      comment.textContent = event.coachComment.trim();
      content.append(heading, comment);
      item.append(include, content);
      feedbackList.appendChild(item);
    }
    updateFeedbackMoment(events);
  }

  function selectedFeedback() {
    const player = game.players.find(item => item.id === feedbackPlayer.value);
    if (!player) return null;
    const playersById = Object.fromEntries(game.players.map(item => [item.id, item]));
    const includedIds = new Set(
      [...feedbackList.querySelectorAll('.feedback-event-select:checked')]
        .map(input => input.closest('[data-event-id]').dataset.eventId)
    );
    return {
      player,
      playersById,
      events: feedbackEvents(player).filter(event => includedIds.has(event.id))
    };
  }

  function feedbackHeading(player) {
    const opponent = game.opponentName ? ` vs ${game.opponentName}` : '';
    return `${player.name} — ${game.title}${opponent}`;
  }

  function telegramFeedbackText() {
    const selection = selectedFeedback();
    if (!selection) return '';
    const entries = selection.events
      .map(event => [
        `▶ ${formatVideoTime(feedbackSeconds(event))} — ${describeEvent(event, selection.playersById)}`,
        `“${event.coachComment.trim()}”`,
        feedbackUrl(event)
      ].join('\n'));
    return entries.length
      ? `${feedbackHeading(selection.player)}\n\n${entries.join('\n\n')}`
      : '';
  }

  function youtubeFeedbackText() {
    const selection = selectedFeedback();
    if (!selection) return '';
    const entries = selection.events.map(event => [
      `${formatYouTubeTimestamp(feedbackSeconds(event))} — ${describeEvent(event, selection.playersById)}`,
      event.coachComment.trim()
    ].join('\n'));
    return entries.length
      ? `${feedbackHeading(selection.player)}\n\n${entries.join('\n\n')}`
      : '';
  }

  async function copyFeedback(text, successMessage) {
    if (!text) {
      setFeedbackStatus('Select at least one feedback moment.', true);
      return;
    }
    try {
      const clipboard = documentObject.defaultView?.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await clipboard.writeText(text);
      setFeedbackStatus(successMessage);
    } catch (error) {
      setFeedbackStatus(error.message || 'Could not copy player feedback.', true);
    }
  }

  function sourceValue(value, eventIds, className = '') {
    if (!eventIds?.length) {
      const span = documentObject.createElement('span');
      span.className = className;
      span.textContent = value;
      return span;
    }
    const button = documentObject.createElement('button');
    button.type = 'button';
    button.className = `report-value-link ${className}`.trim();
    button.dataset.sourceEventIds = eventIds.join(',');
    button.textContent = value;
    return button;
  }

  function renderComparison() {
    comparisonHead.innerHTML = '';
    comparisonBody.innerHTML = '';
    const headingRow = comparisonHead.insertRow();
    const sideHeading = documentObject.createElement('th');
    sideHeading.scope = 'col';
    sideHeading.textContent = 'Team';
    headingRow.appendChild(sideHeading);
    for (const [key, label] of COMPARISON_METRICS) {
      const heading = documentObject.createElement('th');
      heading.scope = 'col';
      heading.dataset.metric = key;
      heading.textContent = label;
      headingRow.appendChild(heading);
    }

    for (const [side, label] of [['team', 'Our team'], ['opponent', 'Opponent']]) {
      const row = comparisonBody.insertRow();
      row.dataset.side = side;
      const heading = documentObject.createElement('th');
      heading.scope = 'row';
      heading.textContent = label;
      row.appendChild(heading);
      for (const [key] of COMPARISON_METRICS) {
        const value = analysis.report.teamComparison[side][key];
        const display = typeof value === 'object' ? formatShooting(value) : value;
        const cell = addCell(
          row,
          sourceValue(display, analysis.traceability.teamComparison[side][key], `${side}-report-value`)
        );
        cell.dataset.metric = key;
      }
    }
  }

  function renderPlayers(playersById) {
    playerBody.innerHTML = '';
    for (const player of game.players) {
      const stats = analysis.report.players[player.id];
      const trace = analysis.traceability.players[player.id];
      const row = playerBody.insertRow();
      row.dataset.playerId = player.id;
      const heading = documentObject.createElement('th');
      heading.scope = 'row';
      heading.textContent = playersById[player.id].number
        ? `#${playersById[player.id].number} ${playersById[player.id].name}`
        : playersById[player.id].name;
      row.appendChild(heading);
      addCell(row, sourceValue(stats.points, trace.points, 'player-points'));
      addCell(row, sourceValue(`${stats.fieldGoalsMade}/${stats.fieldGoalsAttempted}`, trace.fieldGoals, 'player-field-goals'));
      addCell(row, sourceValue(`${stats.threePointMade}/${stats.threePointAttempted}`, trace.threePoint, 'player-three-point'));
      addCell(row, sourceValue(`${stats.freeThrowsMade}/${stats.freeThrowsAttempted}`, trace.freeThrows, 'player-free-throws'));
      for (const [field, className] of [
        ['offensiveRebounds', 'player-offensive-rebounds'],
        ['defensiveRebounds', 'player-defensive-rebounds'],
        ['assists', 'player-assists'],
        ['steals', 'player-steals'],
        ['blocks', 'player-blocks'],
        ['turnovers', 'player-turnovers'],
        ['fouls', 'player-fouls']
      ]) {
        addCell(row, sourceValue(stats[field], trace[field], className));
      }
      addCell(row, sourceValue(signed(stats.plusMinus), trace.plusMinus, 'player-plus-minus'));
      addCell(row, sourceValue(stats.efficiency, trace.efficiency, 'player-efficiency'));
      addCell(row, sourceValue(
        formatPercentage(stats.trueShootingPercentage),
        trace.trueShootingPercentage,
        'player-true-shooting'
      ));
      addCell(row, formatVideoTime(stats.videoSeconds), 'player-video-time');
    }
  }

  function renderLineups(playersById) {
    lineupBody.innerHTML = '';
    for (const lineup of analysis.report.lineups) {
      const key = lineupKey(lineup.playerIds);
      const trace = analysis.traceability.lineups[key]?.plusMinus || [];
      const row = lineupBody.insertRow();
      row.dataset.lineupKey = key;
      const heading = documentObject.createElement('th');
      heading.scope = 'row';
      heading.textContent = lineup.playerIds.map(id => playersById[id]?.name || id).join(', ');
      row.appendChild(heading);
      addCell(row, sourceValue(lineup.pointsFor, trace, 'lineup-points-for'));
      addCell(row, sourceValue(lineup.pointsAgainst, trace, 'lineup-points-against'));
      addCell(row, sourceValue(signed(lineup.plusMinus), trace, 'lineup-plus-minus'));
      addCell(row, formatVideoTime(lineup.videoSeconds), 'lineup-video-time');
    }
  }

  function renderProgression() {
    progression.innerHTML = '';
    const points = analysis.scoreProgression;
    emptyProgression.classList.toggle('hidden', points.length > 0);
    progression.classList.toggle('hidden', points.length === 0);
    if (!points.length) return;

    const opponentName = game.opponentName?.trim() || 'Opponent';
    const legend = documentObject.createElement('div');
    legend.className = 'score-chart-legend';
    for (const [className, label] of [['team', 'Our team'], ['opponent', opponentName]]) {
      const item = documentObject.createElement('span');
      item.className = className;
      item.textContent = label;
      legend.appendChild(item);
    }

    const plot = documentObject.createElement('div');
    plot.className = 'score-chart-plot';
    const svg = documentObject.createElementNS(SVG_NAMESPACE, 'svg');
    svg.classList.add('score-chart-svg');
    svg.setAttribute('viewBox', `0 0 ${SCORE_CHART.width} ${SCORE_CHART.height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `Score progression: Our team ${analysis.report.score.team}, ${opponentName} ${analysis.report.score.opponent}, ${points.length} scoring events.`
    );

    const startSeconds = Number(game.video.startSeconds) || 0;
    const endSeconds = Math.max(
      startSeconds + 1,
      Number(game.video.endSeconds) || analysis.reportEndSeconds || points.at(-1).videoSeconds
    );
    const maxScore = Math.max(1, ...points.flatMap(point => [point.team, point.opponent]));
    const plotWidth = SCORE_CHART.width - SCORE_CHART.left - SCORE_CHART.right;
    const plotHeight = SCORE_CHART.height - SCORE_CHART.top - SCORE_CHART.bottom;
    const x = seconds => SCORE_CHART.left
      + ((Math.min(endSeconds, Math.max(startSeconds, seconds)) - startSeconds)
        / (endSeconds - startSeconds)) * plotWidth;
    const y = score => SCORE_CHART.top + plotHeight - (score / maxScore) * plotHeight;

    const tickStep = maxScore <= 10 ? 1 : Math.ceil(maxScore / 5);
    const ticks = new Set([0, maxScore]);
    for (let value = tickStep; value < maxScore; value += tickStep) ticks.add(value);
    for (const value of [...ticks].sort((a, b) => a - b)) {
      const line = documentObject.createElementNS(SVG_NAMESPACE, 'line');
      line.classList.add('score-chart-grid');
      line.setAttribute('x1', SCORE_CHART.left);
      line.setAttribute('x2', SCORE_CHART.width - SCORE_CHART.right);
      line.setAttribute('y1', y(value));
      line.setAttribute('y2', y(value));
      const label = documentObject.createElementNS(SVG_NAMESPACE, 'text');
      label.classList.add('score-chart-axis-label');
      label.setAttribute('x', SCORE_CHART.left - 7);
      label.setAttribute('y', y(value) + 4);
      label.setAttribute('text-anchor', 'end');
      label.textContent = value;
      svg.append(line, label);
    }

    for (const [seconds, anchor] of [[startSeconds, 'start'], [endSeconds, 'end']]) {
      const label = documentObject.createElementNS(SVG_NAMESPACE, 'text');
      label.classList.add('score-chart-axis-label');
      label.setAttribute('x', x(seconds));
      label.setAttribute('y', SCORE_CHART.height - 6);
      label.setAttribute('text-anchor', anchor);
      label.textContent = formatVideoTime(seconds);
      svg.appendChild(label);
    }

    const eventsById = Object.fromEntries(game.events.map(event => [event.id, event]));
    const periodEnds = analysis.orderedEventIds
      .map(eventId => eventsById[eventId])
      .filter(event => event?.type === 'period_end');
    for (const event of periodEnds) {
      const eventX = x(event.videoSeconds);
      const line = documentObject.createElementNS(SVG_NAMESPACE, 'line');
      line.classList.add('score-chart-period-line');
      line.dataset.eventId = event.id;
      line.setAttribute('x1', eventX);
      line.setAttribute('x2', eventX);
      line.setAttribute('y1', SCORE_CHART.top);
      line.setAttribute('y2', SCORE_CHART.top + plotHeight);
      const title = documentObject.createElementNS(SVG_NAMESPACE, 'title');
      title.textContent = `${event.periodLabel || 'Period end'} at ${formatVideoTime(event.videoSeconds)}`;
      line.appendChild(title);

      const label = documentObject.createElementNS(SVG_NAMESPACE, 'text');
      label.classList.add('score-chart-period-label');
      label.setAttribute('x', eventX + (eventX > SCORE_CHART.width - 100 ? -4 : 4));
      label.setAttribute('y', SCORE_CHART.top + 11);
      label.setAttribute('text-anchor', eventX > SCORE_CHART.width - 100 ? 'end' : 'start');
      label.textContent = event.periodLabel || 'Period end';
      svg.append(line, label);
    }

    for (const side of ['team', 'opponent']) {
      let pathData = `M ${x(startSeconds)} ${y(0)}`;
      for (const point of points) {
        pathData += ` H ${x(point.videoSeconds)} V ${y(point[side])}`;
      }
      pathData += ` H ${x(endSeconds)}`;
      const path = documentObject.createElementNS(SVG_NAMESPACE, 'path');
      path.classList.add('score-chart-line', side);
      path.dataset.side = side;
      path.setAttribute('d', pathData);
      svg.appendChild(path);
    }

    let previousTeam = 0;
    for (const point of points) {
      const scoringSide = point.team !== previousTeam ? 'team' : 'opponent';
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = `score-chart-point ${scoringSide}`;
      button.dataset.eventId = point.eventId;
      button.dataset.reportEventId = point.eventId;
      button.style.left = `${(x(point.videoSeconds) / SCORE_CHART.width) * 100}%`;
      button.style.top = `${(y(point[scoringSide]) / SCORE_CHART.height) * 100}%`;
      const label = `${formatVideoTime(point.videoSeconds)}, Our team ${point.team}, ${opponentName} ${point.opponent}`;
      button.setAttribute('aria-label', label);
      button.title = label;
      plot.appendChild(button);
      previousTeam = point.team;
    }
    plot.prepend(svg);
    progression.append(legend, plot);
  }

  function markerOffset(index, count) {
    if (count <= 1) return { x: 0, y: 0 };
    const angle = (Math.PI * 2 * index / count) - Math.PI / 2;
    const radius = Math.min(13, 6 + count);
    return {
      x: Number((Math.cos(angle) * radius).toFixed(2)),
      y: Number((Math.sin(angle) * radius).toFixed(2))
    };
  }

  function renderShotChart(report, playersById) {
    shotChartPlot.innerHTML = '';
    const court = createShotCourtDiagram(documentObject, {
      class: 'shot-chart-court',
      'aria-hidden': 'true',
      focusable: 'false'
    });
    shotChartPlot.appendChild(court);
    const locationGroups = new Map();
    for (const event of report.plottedEvents) {
      const { x, y } = event.shotDetails.location;
      const key = `${x.toFixed(4)}:${y.toFixed(4)}`;
      if (!locationGroups.has(key)) locationGroups.set(key, []);
      locationGroups.get(key).push(event);
    }
    for (const events of locationGroups.values()) {
      events.forEach((event, index) => {
        const offset = markerOffset(index, events.length);
        const button = documentObject.createElement('button');
        button.type = 'button';
        button.className = `shot-chart-marker ${event.made ? 'made' : 'missed'}`;
        button.dataset.eventId = event.id;
        button.dataset.reportEventId = event.id;
        button.style.left = `${event.shotDetails.location.x * 100}%`;
        button.style.top = `${event.shotDetails.location.y * 100}%`;
        button.style.setProperty('--shot-offset-x', `${offset.x}px`);
        button.style.setProperty('--shot-offset-y', `${offset.y}px`);
        const label = `${formatVideoTime(event.videoSeconds)}, ${describeEvent(event, playersById)}`;
        button.setAttribute('aria-label', label);
        button.title = label;
        shotChartPlot.appendChild(button);
      });
    }
    shotChart.classList.toggle('hidden', report.plottedEvents.length === 0);
    emptyShotChart.classList.toggle('hidden', report.plottedEvents.length > 0);
  }

  function createSvgElement(name, attributes = {}) {
    const element = documentObject.createElementNS(SVG_NAMESPACE, name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    return element;
  }

  function zoneEfficiencyClass(row) {
    if (!row?.attempted) return 'empty';
    if (row.pointsPerAttempt < 0.8) return 'low';
    if (row.pointsPerAttempt < 1.1) return 'medium';
    return 'high';
  }

  function zoneLabel(row) {
    if (!row?.attempted) return '0/0 · —';
    return `${row.made}/${row.attempted} · ${formatPercentage(row.percentage)}`;
  }

  function renderShotZones(report) {
    shotZonePlot.innerHTML = '';
    shotZoneNoLocation.innerHTML = '';
    const court = createShotCourtDiagram(documentObject, {
      class: 'shot-chart-court',
      'aria-hidden': 'true',
      focusable: 'false'
    });
    const rows = new Map(report.dimensions.zone.map(row => [row.key, row]));
    const maskId = `shotZoneArcMask${++shotZoneRenderSequence}`;
    const defs = createSvgElement('defs');
    const mask = createSvgElement('mask', { id: maskId });
    mask.append(
      createSvgElement('rect', { x: 0, y: 140, width: 500, height: 330, fill: 'white' }),
      createSvgElement('circle', { cx: 250, cy: 52.5, r: 237.5, fill: 'black' })
    );
    defs.appendChild(mask);
    const regions = createSvgElement('g', { class: 'shot-zone-regions' });
    const regionDefinitions = [
      ['above_break_three_left', 'rect', { x: 0, y: 140, width: 200, height: 330, mask: `url(#${maskId})` }],
      ['above_break_three_center', 'rect', { x: 200, y: 140, width: 100, height: 330, mask: `url(#${maskId})` }],
      ['above_break_three_right', 'rect', { x: 300, y: 140, width: 200, height: 330, mask: `url(#${maskId})` }],
      ['long_midrange', 'circle', { cx: 250, cy: 52.5, r: 237.5 }],
      ['short_midrange', 'circle', { cx: 250, cy: 52.5, r: 150 }],
      ['paint_non_restricted', 'rect', { x: 170, y: 0, width: 160, height: 190 }],
      ['restricted_area', 'circle', { cx: 250, cy: 52.5, r: 40 }],
      ['left_corner_three', 'rect', { x: 0, y: 0, width: 30, height: 140 }],
      ['right_corner_three', 'rect', { x: 470, y: 0, width: 30, height: 140 }]
    ];
    for (const [key, shape, attributes] of regionDefinitions) {
      const row = rows.get(key);
      const region = createSvgElement(shape, {
        ...attributes,
        class: `shot-zone-region ${zoneEfficiencyClass(row)}`,
        'data-shot-zone-region': key,
        style: `--zone-opacity:${Math.min(0.72, 0.24 + (row?.attempted || 0) * 0.08)}`
      });
      regions.appendChild(region);
    }
    court.prepend(defs);
    court.insertBefore(regions, court.children[2]);
    shotZonePlot.appendChild(court);

    const labelPositions = {
      restricted_area: [50, 12],
      paint_non_restricted: [50, 30],
      short_midrange: [28, 35],
      long_midrange: [72, 49],
      left_corner_three: [8, 19],
      right_corner_three: [92, 19],
      above_break_three_left: [18, 72],
      above_break_three_center: [50, 84],
      above_break_three_right: [82, 72]
    };
    for (const [key, [left, top]] of Object.entries(labelPositions)) {
      const row = rows.get(key);
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = `shot-zone-label ${zoneEfficiencyClass(row)}`;
      button.dataset.shotZone = key;
      if (row?.eventIds.length) button.dataset.sourceEventIds = row.eventIds.join(',');
      button.disabled = !row?.attempted;
      button.style.left = `${left}%`;
      button.style.top = `${top}%`;
      const name = SHOT_REPORT_DIMENSIONS[0].labels[key];
      button.innerHTML = `<strong>${name}</strong><span>${zoneLabel(row)}</span>`;
      button.setAttribute(
        'aria-label',
        row?.attempted
          ? `${name}: ${row.made} made of ${row.attempted}, ${formatPercentage(row.percentage)}, ${row.pointsPerAttempt.toFixed(2)} points per attempt. Show source plays.`
          : `${name}: no attempts.`
      );
      shotZonePlot.appendChild(button);
    }

    const noLocation = rows.get('__untagged__');
    const noLocationButton = documentObject.createElement('button');
    noLocationButton.type = 'button';
    noLocationButton.className = 'secondary small';
    noLocationButton.disabled = !noLocation?.attempted;
    if (noLocation?.eventIds.length) {
      noLocationButton.dataset.sourceEventIds = noLocation.eventIds.join(',');
    }
    noLocationButton.textContent = `No location: ${zoneLabel(noLocation)}`;
    shotZoneNoLocation.appendChild(noLocationButton);
  }

  function renderShotSplits(report) {
    shotSplitReports.innerHTML = '';
    for (const dimension of SHOT_REPORT_DIMENSIONS.filter(item => item.key !== 'zone')) {
      const section = documentObject.createElement('section');
      section.className = 'shot-split-section';
      section.dataset.shotDimension = dimension.key;
      const heading = documentObject.createElement('h4');
      heading.textContent = dimension.label;
      const wrap = documentObject.createElement('div');
      wrap.className = 'report-table-wrap';
      const table = documentObject.createElement('table');
      table.className = 'report-table shot-split-table';
      const head = table.createTHead().insertRow();
      for (const label of [dimension.label, 'Made', 'Attempts', 'FG%', 'PPA']) {
        const cell = documentObject.createElement('th');
        cell.scope = 'col';
        cell.textContent = label;
        head.appendChild(cell);
      }
      const body = table.createTBody();
      for (const rowData of report.dimensions[dimension.key]) {
        const row = body.insertRow();
        row.dataset.shotBucket = rowData.key;
        const label = documentObject.createElement('th');
        label.scope = 'row';
        label.textContent = rowData.label;
        row.appendChild(label);
        addCell(row, rowData.made);
        addCell(row, sourceValue(rowData.attempted, rowData.eventIds, 'shot-split-source'));
        addCell(row, formatPercentage(rowData.percentage));
        addCell(row, rowData.pointsPerAttempt == null ? '—' : rowData.pointsPerAttempt.toFixed(2));
      }
      wrap.appendChild(table);
      section.append(heading, wrap);
      shotSplitReports.appendChild(section);
    }
  }

  function renderShots() {
    const playersById = Object.fromEntries(game.players.map(player => [player.id, player]));
    const report = buildShotReport(game, shotReportFilters());
    const percentage = formatPercentage(report.percentage);
    const missingLocations = report.attempted - report.plottedEvents.length;
    shotReportSummary.textContent = `${report.made}/${report.attempted} FG (${percentage}) · `
      + `${report.pointsPerAttempt == null ? '—' : report.pointsPerAttempt.toFixed(2)} points per attempt · `
      + `${report.plottedEvents.length} plotted · ${missingLocations} without location`;
    renderShotChart(report, playersById);
    renderShotZones(report);
    renderShotSplits(report);
  }

  function renderSources(eventIds = []) {
    sourceList.innerHTML = '';
    const byId = Object.fromEntries(game.events.map(event => [event.id, event]));
    const playersById = Object.fromEntries(game.players.map(player => [player.id, player]));
    const events = eventIds.map(id => byId[id]).filter(Boolean);
    sourceEmpty.classList.toggle('hidden', events.length > 0);
    sourceTitle.textContent = events.length ? `${events.length} source play${events.length === 1 ? '' : 's'}` : 'Source plays';
    for (const event of events) {
      const item = documentObject.createElement('li');
      item.dataset.eventId = event.id;
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = 'link-button';
      button.dataset.reportEventId = event.id;
      button.textContent = formatVideoTime(event.videoSeconds);
      const description = documentObject.createElement('span');
      description.textContent = describeEvent(event, playersById);
      item.append(button, description);
      sourceList.appendChild(item);
    }
  }

  function seekToEvent(eventId) {
    const event = game.events.find(item => item.id === eventId);
    if (!event) return;
    try {
      videoController.seekTo(Math.max(0, event.videoSeconds - previewSeconds));
      setError();
    } catch (error) {
      setError(error.message || 'Could not navigate to the source play.');
    }
  }

  reportCard.addEventListener('click', event => {
    const value = event.target.closest('[data-source-event-ids]');
    if (value) {
      renderSources(value.dataset.sourceEventIds.split(',').filter(Boolean));
      return;
    }
    const eventLink = event.target.closest('[data-report-event-id]');
    if (eventLink) seekToEvent(eventLink.dataset.reportEventId);
  });
  shotReportSection.addEventListener('change', renderShots);
  clearShotReportFilters.addEventListener('click', () => {
    shotReportResult.value = SHOT_REPORT_ANY;
    shotReportPeriod.value = SHOT_REPORT_ANY;
    shotReportPressure.value = SHOT_REPORT_ANY;
    shotReportPhase.value = SHOT_REPORT_ANY;
    shotReportContext.value = SHOT_REPORT_ANY;
    shotReportCreation.value = SHOT_REPORT_ANY;
    renderShots();
  });
  feedbackPlayer.addEventListener('change', renderFeedback);
  previousFeedbackButton.addEventListener('click', () => moveFeedbackMoment(-1));
  nextFeedbackButton.addEventListener('click', () => moveFeedbackMoment(1));
  feedbackList.addEventListener('change', () => {
    const hasSelection = Boolean(feedbackList.querySelector('.feedback-event-select:checked'));
    copyFeedbackButton.disabled = !hasSelection;
    copyYouTubeFeedbackButton.disabled = !hasSelection;
    setFeedbackStatus();
  });
  copyFeedbackButton.addEventListener('click', () => {
    copyFeedback(telegramFeedbackText(), 'Copied player feedback for Telegram.');
  });
  copyYouTubeFeedbackButton.addEventListener('click', () => {
    copyFeedback(youtubeFeedbackText(), 'Copied timestamp comment for YouTube.');
  });

  return {
    render(nextGame, nextAnalysis) {
      game = nextGame;
      analysis = nextAnalysis;
      reportCard.classList.toggle('hidden', !game);
      setError();
      if (!game || !analysis) return;
      const playersById = Object.fromEntries(game.players.map(player => [player.id, player]));
      finalScore.textContent = `${analysis.report.score.team}–${analysis.report.score.opponent}`;
      renderComparison();
      renderPlayers(playersById);
      renderShotScopeOptions();
      renderShotPeriodOptions();
      renderShots();
      renderFeedback();
      renderLineups(playersById);
      renderProgression();
      renderSources();
    }
  };
}
