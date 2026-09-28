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

function addCell(row, content, className = '') {
  const cell = row.insertCell();
  cell.className = className;
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = String(content);
  return cell;
}

export function createReportController({
  documentObject = document,
  videoController
}) {
  const reportCard = documentObject.querySelector('#reportCard');
  const finalScore = documentObject.querySelector('#reportFinalScore');
  const comparisonBody = documentObject.querySelector('#teamComparisonBody');
  const playerBody = documentObject.querySelector('#playerReportBody');
  const lineupBody = documentObject.querySelector('#lineupReportBody');
  const progression = documentObject.querySelector('#scoreProgression');
  const emptyProgression = documentObject.querySelector('#emptyScoreProgression');
  const sourceTitle = documentObject.querySelector('#reportSourceTitle');
  const sourceList = documentObject.querySelector('#reportSourceList');
  const sourceEmpty = documentObject.querySelector('#reportSourceEmpty');
  const reportError = documentObject.querySelector('#reportError');

  let game = null;
  let analysis = null;

  function setError(message = '') {
    reportError.textContent = message;
    reportError.classList.toggle('hidden', !message);
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
    comparisonBody.innerHTML = '';
    for (const [key, label] of COMPARISON_METRICS) {
      const row = comparisonBody.insertRow();
      row.dataset.metric = key;
      const heading = documentObject.createElement('th');
      heading.scope = 'row';
      heading.textContent = label;
      row.appendChild(heading);
      for (const side of ['team', 'opponent']) {
        const value = analysis.report.teamComparison[side][key];
        const display = typeof value === 'object' ? formatShooting(value) : value;
        addCell(
          row,
          sourceValue(display, analysis.traceability.teamComparison[side][key], `${side}-report-value`)
        );
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
    emptyProgression.classList.toggle('hidden', analysis.scoreProgression.length > 0);
    for (const point of analysis.scoreProgression) {
      const item = documentObject.createElement('li');
      item.dataset.eventId = point.eventId;
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = 'link-button';
      button.dataset.reportEventId = point.eventId;
      button.textContent = formatVideoTime(point.videoSeconds);
      const score = documentObject.createElement('strong');
      score.textContent = `${point.team}–${point.opponent}`;
      item.append(button, score);
      progression.appendChild(item);
    }
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
      videoController.seekTo(event.videoSeconds);
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
      renderLineups(playersById);
      renderProgression();
      renderSources();
    }
  };
}
