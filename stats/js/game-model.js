export const GAME_SCHEMA_VERSION = 1;

export const STAT_EVENT_TYPES = new Set([
  'shot',
  'rebound',
  'assist',
  'steal',
  'block',
  'turnover',
  'foul'
]);

export class GameValidationError extends Error {
  constructor(issues) {
    super(`Game data is invalid: ${issues.join(' ')}`);
    this.name = 'GameValidationError';
    this.issues = issues;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasFiveValidPlayers(lineupIds, playerIds) {
  return Array.isArray(lineupIds)
    && lineupIds.length === 5
    && new Set(lineupIds).size === 5
    && lineupIds.every(id => playerIds.has(id));
}

function sameLineup(actual, expected) {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

export function orderGameEvents(events) {
  return [...events].sort((a, b) => a.videoSeconds - b.videoSeconds || a.sequence - b.sequence);
}

export function collectGameValidationIssues(game) {
  const issues = [];
  if (!game || typeof game !== 'object' || Array.isArray(game)) {
    return ['Game must be an object.'];
  }
  if (game.schemaVersion !== GAME_SCHEMA_VERSION) {
    issues.push(`Unsupported schema version: ${game.schemaVersion}.`);
  }
  if (!isNonEmptyString(game.id)) issues.push('Game ID is required.');
  if (!isNonEmptyString(game.title)) issues.push('Game title is required.');

  const videoStart = Number(game.video?.startSeconds);
  const videoEnd = game.video?.endSeconds == null ? null : Number(game.video.endSeconds);
  if (game.video?.provider !== 'youtube') issues.push('Video provider must be YouTube.');
  if (!isNonEmptyString(game.video?.videoId)) issues.push('YouTube video ID is required.');
  if (!Number.isFinite(videoStart) || videoStart < 0) issues.push('Video start must be a non-negative number.');
  if (videoEnd !== null && (!Number.isFinite(videoEnd) || videoEnd < videoStart)) {
    issues.push('Video end must not be before video start.');
  }

  const players = Array.isArray(game.players) ? game.players : [];
  if (players.length < 5) issues.push('At least five players are required.');
  const playerIds = new Set();
  for (const player of players) {
    if (!isNonEmptyString(player?.id)) {
      issues.push('Every player requires an ID.');
      continue;
    }
    if (playerIds.has(player.id)) issues.push(`Duplicate player ID: ${player.id}.`);
    playerIds.add(player.id);
    if (!isNonEmptyString(player.name)) issues.push(`Player ${player.id} requires a name.`);
  }

  if (!hasFiveValidPlayers(game.startingLineupIds, playerIds)) {
    issues.push('Starting lineup must contain five unique game players.');
  }

  const events = Array.isArray(game.events) ? game.events : [];
  if (!Array.isArray(game.events)) issues.push('Events must be an array.');
  const eventIds = new Set();
  const sequences = new Set();
  for (const event of events) {
    if (!isNonEmptyString(event?.id)) {
      issues.push('Every event requires an ID.');
    } else if (eventIds.has(event.id)) {
      issues.push(`Duplicate event ID: ${event.id}.`);
    } else {
      eventIds.add(event.id);
    }
    if (!Number.isInteger(event?.sequence) || event.sequence < 1) {
      issues.push(`Event ${event?.id || '(unknown)'} requires a positive integer sequence.`);
    } else if (sequences.has(event.sequence)) {
      issues.push(`Duplicate event sequence: ${event.sequence}.`);
    } else {
      sequences.add(event.sequence);
    }
  }

  let currentLineup = Array.isArray(game.startingLineupIds) ? [...game.startingLineupIds] : [];
  for (const event of orderGameEvents(events)) {
    const label = `Event ${event.id || '(unknown)'}`;
    const eventSeconds = Number(event.videoSeconds);
    if (!Number.isFinite(eventSeconds) || eventSeconds < videoStart || (videoEnd !== null && eventSeconds > videoEnd)) {
      issues.push(`${label} timestamp is outside the tracked video interval.`);
    }
    if (!hasFiveValidPlayers(event.lineupIds, playerIds)) {
      issues.push(`${label} lineup must contain five unique game players.`);
    }
    if (!['team', 'opponent', 'system'].includes(event.side)) {
      issues.push(`${label} has an invalid side.`);
    }
    if (!['shot', 'rebound', 'assist', 'steal', 'block', 'turnover', 'foul', 'substitution', 'note'].includes(event.type)) {
      issues.push(`${label} has an invalid type.`);
    }

    if (STAT_EVENT_TYPES.has(event.type)) {
      if (!['team', 'opponent'].includes(event.side)) {
        issues.push(`${label} statistical event must belong to the team or opponent.`);
      }
      if (event.side === 'team' && !playerIds.has(event.playerId)) {
        issues.push(`${label} team statistic requires a valid player.`);
      }
      if (event.side === 'opponent' && event.playerId !== null) {
        issues.push(`${label} opponent statistic cannot identify an individual player.`);
      }
    }
    if (event.type === 'shot') {
      if (![1, 2, 3].includes(event.shotValue) || typeof event.made !== 'boolean') {
        issues.push(`${label} shot requires a value of 1, 2, or 3 and a made flag.`);
      }
    }
    if (event.type === 'rebound' && !['offensive', 'defensive'].includes(event.reboundKind)) {
      issues.push(`${label} rebound must be offensive or defensive.`);
    }
    if (event.type === 'note' && (event.side !== 'system' || !isNonEmptyString(event.note))) {
      issues.push(`${label} note must be a non-empty system event.`);
    }

    if (event.type === 'substitution') {
      if (event.side !== 'team' || event.playerId !== null) {
        issues.push(`${label} substitution must be a team event without a primary player.`);
      }
      if (!currentLineup.includes(event.playerOutId)) {
        issues.push(`${label} outgoing player is not on court.`);
      }
      if (!playerIds.has(event.playerInId) || currentLineup.includes(event.playerInId)) {
        issues.push(`${label} incoming player must be a bench player.`);
      }
      if (currentLineup.includes(event.playerOutId) && playerIds.has(event.playerInId) && !currentLineup.includes(event.playerInId)) {
        currentLineup = currentLineup.map(id => id === event.playerOutId ? event.playerInId : id);
      }
    }

    if (hasFiveValidPlayers(event.lineupIds, playerIds) && !sameLineup(event.lineupIds, currentLineup)) {
      issues.push(`${label} lineup snapshot does not match the derived active lineup.`);
    }
  }

  for (const event of events) {
    if (event.relatedEventId != null && (!eventIds.has(event.relatedEventId) || event.relatedEventId === event.id)) {
      issues.push(`Event ${event.id || '(unknown)'} has an invalid related event.`);
    }
  }

  return issues;
}

export function validateGame(game) {
  const issues = collectGameValidationIssues(game);
  if (issues.length) throw new GameValidationError(issues);
  return game;
}
