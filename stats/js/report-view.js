import { describeEvent } from './event-list.js';
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
      renderFeedback();
      renderLineups(playersById);
      renderProgression();
      renderSources();
    }
  };
}
