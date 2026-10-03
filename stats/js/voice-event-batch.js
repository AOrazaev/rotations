import {
  getLineupAtEventPosition,
  rebuildLineupSnapshots,
  validateGame
} from './game-model.js';

function mutationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertExpectedGame(game, expectedGameId, expectedGameUpdatedAt) {
  if (!game || game.id !== expectedGameId || game.updatedAt !== expectedGameUpdatedAt) {
    throw mutationError(
      'voice_game_changed',
      'The game changed after this proposal was created. Retry processing before adding it.'
    );
  }
}

function buildGameEvent(proposal, {
  id,
  sequence,
  videoSeconds,
  lineupIds,
  timestamp
}) {
  const event = {
    id,
    sequence,
    videoSeconds,
    side: proposal.side,
    type: proposal.type,
    playerId: proposal.side === 'team' ? proposal.playerId : null,
    relatedEventId: null,
    lineupIds: [...lineupIds],
    createdAt: timestamp,
    updatedAt: null
  };
  if (proposal.type === 'shot') {
    event.shotValue = proposal.shotValue;
    event.made = proposal.made;
    if (proposal.shotDetails !== undefined) {
      event.shotDetails = structuredClone(proposal.shotDetails);
    }
  } else if (proposal.type === 'rebound') {
    event.reboundKind = proposal.reboundKind;
  }
  return event;
}

export function appendVoiceEventBatch(game, {
  expectedGameId,
  expectedGameUpdatedAt,
  capturedSeconds,
  proposalEvents,
  now = () => new Date().toISOString(),
  randomUUID = () => crypto.randomUUID()
}) {
  assertExpectedGame(game, expectedGameId, expectedGameUpdatedAt);
  if (!Number.isFinite(capturedSeconds) || capturedSeconds < 0) {
    throw mutationError('voice_invalid_timestamp', 'The proposal timestamp is invalid.');
  }
  if (!Array.isArray(proposalEvents) || !proposalEvents.length) {
    throw mutationError('voice_empty_proposal', 'Add at least one event before confirming.');
  }

  const next = structuredClone(game);
  const timestamp = now();
  const lineupIds = getLineupAtEventPosition(next, capturedSeconds);
  const lineupSet = new Set(lineupIds);
  const firstSequence = Math.max(0, ...next.events.map(event => event.sequence)) + 1;
  const eventIds = [];

  proposalEvents.forEach((proposal, index) => {
    if (proposal.side === 'team' && !lineupSet.has(proposal.playerId)) {
      throw mutationError(
        'voice_player_not_on_court',
        `Proposal event ${index + 1} references a player who is not on court at this timestamp.`
      );
    }
    const id = randomUUID();
    eventIds.push(id);
    next.events.push(buildGameEvent(proposal, {
      id,
      sequence: firstSequence + index,
      videoSeconds: capturedSeconds,
      lineupIds,
      timestamp
    }));
  });

  next.updatedAt = timestamp;
  const rebuilt = rebuildLineupSnapshots(next);
  validateGame(rebuilt);
  return { game: rebuilt, eventIds };
}

export function removeLatestVoiceEventBatch(game, {
  expectedGameId,
  eventIds,
  now = () => new Date().toISOString()
}) {
  if (!game || game.id !== expectedGameId) {
    throw mutationError(
      'voice_game_changed',
      'The active game changed, so this voice batch cannot be undone here.'
    );
  }
  if (!Array.isArray(eventIds) || !eventIds.length) {
    throw mutationError('voice_batch_missing', 'The voice batch is no longer available to undo.');
  }

  const batchIds = new Set(eventIds);
  const orderedBySequence = [...game.events].sort((a, b) => a.sequence - b.sequence);
  const latestIds = orderedBySequence.slice(-eventIds.length).map(event => event.id);
  if (latestIds.length !== eventIds.length
    || latestIds.some((eventId, index) => eventId !== eventIds[index])) {
    throw mutationError(
      'voice_batch_not_latest',
      'Another event was added after this voice batch, so it can no longer be undone as one mutation.'
    );
  }

  const next = structuredClone(game);
  next.events = next.events.filter(event => !batchIds.has(event.id));
  next.updatedAt = now();
  const rebuilt = rebuildLineupSnapshots(next);
  validateGame(rebuilt);
  return rebuilt;
}
