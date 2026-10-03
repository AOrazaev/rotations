const DEFAULT_EVENT_TYPES = [
  'shot',
  'rebound',
  'assist',
  'steal',
  'block',
  'turnover',
  'foul',
  'timeout',
  'substitution'
];

function responseError(message) {
  return new Error(`Invalid voice response: ${message}`);
}

export function validateVoiceResponse(payload, {
  requestId,
  allowedEventTypes = DEFAULT_EVENT_TYPES
} = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw responseError('response must be an object.');
  }
  if (payload.protocolVersion !== 1) {
    throw responseError('unsupported protocol version.');
  }
  if (requestId && payload.requestId !== requestId) {
    throw responseError('request ID does not match the active request.');
  }
  if (typeof payload.transcript !== 'string') {
    throw responseError('transcript must be text.');
  }
  if (!Array.isArray(payload.events) || payload.events.length > 20) {
    throw responseError('event list is invalid.');
  }
  if (
    payload.overallConfidence !== null
    && (
      typeof payload.overallConfidence !== 'number'
      || payload.overallConfidence < 0
      || payload.overallConfidence > 1
    )
  ) {
    throw responseError('overall confidence is invalid.');
  }
  if (
    !Array.isArray(payload.warnings)
    || payload.warnings.some(warning => typeof warning !== 'string')
  ) {
    throw responseError('warnings are invalid.');
  }
  if (!payload.processor || typeof payload.processor !== 'object') {
    throw responseError('processor metadata is missing.');
  }
  if (!payload.timingMs || typeof payload.timingMs !== 'object') {
    throw responseError('timing metadata is missing.');
  }

  const eventTypes = new Set(allowedEventTypes);
  const events = payload.events.map((event, index) => {
    const label = `event ${index + 1}`;
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw responseError(`${label} must be an object.`);
    }
    if (!['team', 'opponent'].includes(event.side)) {
      throw responseError(`${label} side is invalid.`);
    }
    if (!eventTypes.has(event.type)) {
      throw responseError(`${label} type is unsupported.`);
    }
    if (event.playerId !== null && typeof event.playerId !== 'string') {
      throw responseError(`${label} player ID is invalid.`);
    }
    if (
      typeof event.confidence !== 'number'
      || event.confidence < 0
      || event.confidence > 1
    ) {
      throw responseError(`${label} confidence is invalid.`);
    }
    if (
      event.type === 'shot'
      && (
        ![1, 2, 3].includes(event.shotValue)
        || typeof event.made !== 'boolean'
      )
    ) {
      throw responseError(`${label} shot details are invalid.`);
    }
    if (
      event.type === 'rebound'
      && !['offensive', 'defensive'].includes(event.reboundKind)
    ) {
      throw responseError(`${label} rebound kind is invalid.`);
    }
    if (
      ['timeout', 'substitution'].includes(event.type)
      && event.playerId !== null
    ) {
      throw responseError(`${label} ${event.type} must be playerless.`);
    }
    if (
      event.type === 'substitution'
      && (
        typeof event.playerInId !== 'string'
        || typeof event.playerOutId !== 'string'
        || event.playerInId === event.playerOutId
      )
    ) {
      throw responseError(`${label} substitution players are invalid.`);
    }
    return structuredClone(event);
  });

  return {
    ...structuredClone(payload),
    events
  };
}
