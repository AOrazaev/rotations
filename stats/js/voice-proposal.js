import {
  getLineupAtEventPosition,
  STAT_EVENT_TYPES
} from './game-model.js';

const EVENT_TYPES = [...STAT_EVENT_TYPES, 'timeout'];
const EVENT_TYPE_SET = new Set(EVENT_TYPES);

export function buildVoiceCommandContext(
  game,
  capturedSeconds,
  requestId,
  audioChannelPreference = 'auto'
) {
  if (!game) throw new Error('Open a game before recording a voice command.');
  if (!Number.isFinite(capturedSeconds) || capturedSeconds < 0) {
    throw new Error('The recording timestamp is invalid.');
  }
  return {
    protocolVersion: 1,
    requestId,
    capturedSeconds,
    language: 'en',
    sideHint: null,
    audioChannelPreference,
    roster: game.players.map(player => ({
      id: player.id,
      jersey: player.number,
      name: player.name
    })),
    currentLineupIds: getLineupAtEventPosition(game, capturedSeconds),
    allowedEventTypes: EVENT_TYPES
  };
}

export function validateVoiceCommandResponse(payload, {
  requestId,
  game
}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The companion response must be an object.');
  }
  if (payload.protocolVersion !== 1) {
    throw new Error('The companion returned an unsupported protocol version.');
  }
  if (payload.requestId !== requestId) {
    throw new Error('The companion response does not match the active request.');
  }
  if (typeof payload.transcript !== 'string') {
    throw new Error('The companion response is missing its transcript.');
  }
  if (!Array.isArray(payload.events) || payload.events.length > 20) {
    throw new Error('The companion response contains an invalid event list.');
  }
  if (!Array.isArray(payload.warnings)
    || payload.warnings.some(warning => typeof warning !== 'string')) {
    throw new Error('The companion response contains invalid warnings.');
  }

  const playerIds = new Set(game.players.map(player => player.id));
  const events = payload.events.map((event, index) => {
    const label = `Proposal event ${index + 1}`;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`${label} must be an object.`);
    }
    if (!['team', 'opponent'].includes(event.side)) {
      throw new Error(`${label} has an invalid side.`);
    }
    if (!EVENT_TYPE_SET.has(event.type)) {
      throw new Error(`${label} has an unsupported event type.`);
    }
    if (event.type === 'timeout' && event.playerId !== null) {
      throw new Error(`${label} timeout must be team-level.`);
    }
    if (event.side === 'team'
      && event.type !== 'timeout'
      && !playerIds.has(event.playerId)) {
      throw new Error(`${label} does not reference a current game player.`);
    }
    if (event.side === 'opponent' && event.playerId !== null) {
      throw new Error(`${label} opponent statistics must be team-level.`);
    }
    if (event.type === 'shot') {
      if (![1, 2, 3].includes(event.shotValue)
        || typeof event.made !== 'boolean') {
        throw new Error(`${label} has invalid shot details.`);
      }
    }
    if (event.type === 'rebound'
      && !['offensive', 'defensive'].includes(event.reboundKind)) {
      throw new Error(`${label} has an invalid rebound type.`);
    }
    if (typeof event.confidence !== 'number'
      || event.confidence < 0
      || event.confidence > 1) {
      throw new Error(`${label} has invalid confidence.`);
    }
    return structuredClone(event);
  });

  return {
    ...structuredClone(payload),
    events
  };
}

export function editableEventTypes() {
  return [...EVENT_TYPES];
}
