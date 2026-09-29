import {
  orderGameEvents,
  validateGame
} from './game-model.js';

const COUNT_EVENT_FIELDS = {
  assist: 'assists',
  steal: 'steals',
  block: 'blocks',
  turnover: 'turnovers',
  foul: 'fouls'
};

function emptyShootingLine() {
  return { made: 0, attempted: 0, percentage: null };
}

function emptySideTotals() {
  return {
    fieldGoals: emptyShootingLine(),
    twoPoint: emptyShootingLine(),
    threePoint: emptyShootingLine(),
    freeThrows: emptyShootingLine(),
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0
  };
}

function emptyPlayerStats() {
  return {
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointMade: 0,
    threePointAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    efficiency: 0,
    trueShootingPercentage: null,
    plusMinus: 0,
    videoSeconds: 0
  };
}

function emptyTraceFields() {
  return {
    points: [],
    fieldGoals: [],
    twoPoint: [],
    threePoint: [],
    freeThrows: [],
    offensiveRebounds: [],
    defensiveRebounds: [],
    assists: [],
    steals: [],
    blocks: [],
    turnovers: [],
    fouls: [],
    efficiency: [],
    trueShootingPercentage: [],
    plusMinus: []
  };
}

function shotBucket(value) {
  if (value === 1) return 'freeThrows';
  if (value === 2) return 'twoPoint';
  return 'threePoint';
}

function finishPercentage(line) {
  line.percentage = line.attempted ? Number((line.made * 100 / line.attempted).toFixed(4)) : null;
}

function lineupKey(playerIds) {
  return [...playerIds].sort().join('|');
}

function getLineupRecord(lineupRecords, lineupIds) {
  const key = lineupKey(lineupIds);
  if (!lineupRecords.has(key)) {
    lineupRecords.set(key, {
      playerIds: [...lineupIds],
      pointsFor: 0,
      pointsAgainst: 0,
      plusMinus: 0,
      videoSeconds: 0
    });
  }
  return { key, record: lineupRecords.get(key) };
}

export function buildGameAnalysis(game) {
  validateGame(game);
  const orderedEvents = orderGameEvents(game.events);
  const score = { team: 0, opponent: 0 };
  const teamComparison = { team: emptySideTotals(), opponent: emptySideTotals() };
  const players = Object.fromEntries(game.players.map(player => [player.id, emptyPlayerStats()]));
  const lineupRecords = new Map();
  const traceability = {
    score: { team: [], opponent: [] },
    teamComparison: {
      team: emptyTraceFields(),
      opponent: emptyTraceFields()
    },
    players: Object.fromEntries(game.players.map(player => [player.id, emptyTraceFields()])),
    lineups: {},
    participationIntervals: []
  };
  const scoreProgression = [];

  for (const event of orderedEvents) {
    const side = event.side;
    if (event.type === 'shot') {
      const bucket = shotBucket(event.shotValue);
      const totals = teamComparison[side];
      totals[bucket].attempted++;
      traceability.teamComparison[side][bucket].push(event.id);
      if (event.shotValue !== 1) {
        totals.fieldGoals.attempted++;
        traceability.teamComparison[side].fieldGoals.push(event.id);
      }

      if (event.made) {
        totals[bucket].made++;
        if (event.shotValue !== 1) totals.fieldGoals.made++;
        score[side] += event.shotValue;
        traceability.score[side].push(event.id);
        traceability.teamComparison[side].points.push(event.id);

        const delta = side === 'team' ? event.shotValue : -event.shotValue;
        for (const playerId of event.lineupIds) {
          players[playerId].plusMinus += delta;
          traceability.players[playerId].plusMinus.push(event.id);
        }
        const { key, record } = getLineupRecord(lineupRecords, event.lineupIds);
        if (side === 'team') record.pointsFor += event.shotValue;
        else record.pointsAgainst += event.shotValue;
        record.plusMinus += delta;
        if (!traceability.lineups[key]) traceability.lineups[key] = emptyTraceFields();
        traceability.lineups[key].plusMinus.push(event.id);

        scoreProgression.push({
          eventId: event.id,
          videoSeconds: event.videoSeconds,
          team: score.team,
          opponent: score.opponent
        });
      }

      if (side === 'team') {
        const player = players[event.playerId];
        const playerTrace = traceability.players[event.playerId];
        player.points += event.made ? event.shotValue : 0;
        playerTrace[bucket].push(event.id);
        if (event.made) playerTrace.points.push(event.id);
        if (event.shotValue !== 1) {
          player.fieldGoalsAttempted++;
          player.fieldGoalsMade += event.made ? 1 : 0;
          playerTrace.fieldGoals.push(event.id);
        }
        if (event.shotValue === 3) {
          player.threePointAttempted++;
          player.threePointMade += event.made ? 1 : 0;
        }
        if (event.shotValue === 1) {
          player.freeThrowsAttempted++;
          player.freeThrowsMade += event.made ? 1 : 0;
        }
      }
    } else if (event.type === 'rebound') {
      const field = event.reboundKind === 'offensive' ? 'offensiveRebounds' : 'defensiveRebounds';
      teamComparison[side][field]++;
      traceability.teamComparison[side][field].push(event.id);
      if (side === 'team') {
        players[event.playerId][field]++;
        traceability.players[event.playerId][field].push(event.id);
      }
    } else if (COUNT_EVENT_FIELDS[event.type]) {
      const field = COUNT_EVENT_FIELDS[event.type];
      teamComparison[side][field]++;
      traceability.teamComparison[side][field].push(event.id);
      if (side === 'team') {
        players[event.playerId][field]++;
        traceability.players[event.playerId][field].push(event.id);
      }
    }
  }

  for (const side of Object.values(teamComparison)) {
    finishPercentage(side.fieldGoals);
    finishPercentage(side.twoPoint);
    finishPercentage(side.threePoint);
    finishPercentage(side.freeThrows);
  }

  for (const [playerId, player] of Object.entries(players)) {
    const missedFieldGoals = player.fieldGoalsAttempted - player.fieldGoalsMade;
    const missedFreeThrows = player.freeThrowsAttempted - player.freeThrowsMade;
    player.efficiency = player.points
      + player.offensiveRebounds
      + player.defensiveRebounds
      + player.assists
      + player.steals
      + player.blocks
      - missedFieldGoals
      - missedFreeThrows
      - player.turnovers;
    const trueShootingAttempts = player.fieldGoalsAttempted + 0.44 * player.freeThrowsAttempted;
    player.trueShootingPercentage = trueShootingAttempts
      ? Number((player.points * 100 / (2 * trueShootingAttempts)).toFixed(4))
      : null;

    const playerTrace = traceability.players[playerId];
    const efficiencyEventIds = new Set([
      ...playerTrace.fieldGoals,
      ...playerTrace.freeThrows,
      ...playerTrace.offensiveRebounds,
      ...playerTrace.defensiveRebounds,
      ...playerTrace.assists,
      ...playerTrace.steals,
      ...playerTrace.blocks,
      ...playerTrace.turnovers
    ]);
    const shootingEventIds = new Set([...playerTrace.fieldGoals, ...playerTrace.freeThrows]);
    playerTrace.efficiency = orderedEvents
      .filter(event => efficiencyEventIds.has(event.id))
      .map(event => event.id);
    playerTrace.trueShootingPercentage = orderedEvents
      .filter(event => shootingEventIds.has(event.id))
      .map(event => event.id);
  }

  let currentLineup = [...game.startingLineupIds];
  let intervalStart = game.video.startSeconds;
  const reportEnd = game.video.endSeconds ?? Math.max(
    game.video.startSeconds,
    ...orderedEvents.map(event => event.videoSeconds)
  );

  function addParticipationInterval(endSeconds, boundaryEventId = null) {
    const duration = endSeconds - intervalStart;
    const { key, record } = getLineupRecord(lineupRecords, currentLineup);
    record.videoSeconds += duration;
    for (const playerId of currentLineup) players[playerId].videoSeconds += duration;
    traceability.participationIntervals.push({
      lineupKey: key,
      playerIds: [...currentLineup],
      startSeconds: intervalStart,
      endSeconds,
      boundaryEventId
    });
  }

  for (const event of orderedEvents) {
    if (event.type !== 'substitution') continue;
    addParticipationInterval(event.videoSeconds, event.id);
    currentLineup = [...event.lineupIds];
    intervalStart = event.videoSeconds;
  }
  addParticipationInterval(reportEnd);

  const report = {
    score,
    teamComparison,
    players,
    lineups: [...lineupRecords.values()]
  };

  return {
    report,
    traceability,
    scoreProgression,
    activeLineupIds: currentLineup,
    orderedEventIds: orderedEvents.map(event => event.id),
    durationIsProvisional: game.video.endSeconds == null,
    reportEndSeconds: reportEnd
  };
}

export function buildGameReport(game) {
  return buildGameAnalysis(game).report;
}
