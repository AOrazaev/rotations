import {
  getLineupAtEventPosition,
  STAT_EVENT_TYPES
} from './game-model.js';
import {
  validateVoiceResponse
} from '../../voice-companion/web/voice-response.js';

const EVENT_TYPES = [...STAT_EVENT_TYPES, 'timeout', 'substitution'];

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
  const validated = validateVoiceResponse(payload, {
    requestId,
    allowedEventTypes: EVENT_TYPES
  });

  const playerIds = new Set(game.players.map(player => player.id));
  const events = validated.events.map((event, index) => {
    const label = `Proposal event ${index + 1}`;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`${label} must be an object.`);
    }
    if (event.side === 'team'
      && !['timeout', 'substitution'].includes(event.type)
      && !playerIds.has(event.playerId)) {
      throw new Error(`${label} does not reference a current game player.`);
    }
    if (event.side === 'opponent' && event.playerId !== null) {
      throw new Error(`${label} opponent statistics must be team-level.`);
    }
    if (event.type === 'substitution') {
      if (event.side !== 'team'
        || !playerIds.has(event.playerInId)
        || !playerIds.has(event.playerOutId)
        || event.playerInId === event.playerOutId) {
        throw new Error(`${label} has invalid substitution players.`);
      }
    }
    return structuredClone(event);
  });
  if (events.some(event => event.type === 'substitution') && events.length !== 1) {
    throw new Error('A voice substitution must be confirmed as its own command.');
  }

  return {
    ...validated,
    events
  };
}

export function editableEventTypes() {
  return [...EVENT_TYPES];
}
