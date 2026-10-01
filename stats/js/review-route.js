import {
  SHOT_CONTEXTS,
  SHOT_CREATIONS,
  SHOT_PHASES,
  SHOT_PRESSURES,
  STAT_EVENT_TYPES
} from './game-model.js';
import {
  SHOT_ZONE_LABELS,
  UNTAGGED_SHOT_DETAIL
} from './shot-details.js';

const TIMELINE_FILTER_LIMIT = 20;
const TIMELINE_FILTER_DEFINITIONS = Object.freeze([
  ['sides', 'tl-side', ['team', 'opponent', 'system']],
  ['types', 'tl-type', [...STAT_EVENT_TYPES, 'substitution', 'timeout', 'period_end', 'note']],
  ['shotZones', 'tl-zone', [...Object.keys(SHOT_ZONE_LABELS), UNTAGGED_SHOT_DETAIL]],
  ['shotPressures', 'tl-pressure', [...SHOT_PRESSURES, UNTAGGED_SHOT_DETAIL]],
  ['shotPhases', 'tl-phase', [...SHOT_PHASES, UNTAGGED_SHOT_DETAIL]],
  ['shotContexts', 'tl-context', [...SHOT_CONTEXTS, UNTAGGED_SHOT_DETAIL]],
  ['shotCreations', 'tl-creation', [...SHOT_CREATIONS, UNTAGGED_SHOT_DETAIL]]
]);

export function isSafeSharedGameName(value) {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9_-]{0,79})$/.test(value);
}

function isSafeTimelinePlayerId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function parseTimelineFilters(params) {
  const filters = {};
  for (const [property, parameter, allowed] of TIMELINE_FILTER_DEFINITIONS) {
    const requested = new Set(params.getAll(parameter).slice(0, TIMELINE_FILTER_LIMIT));
    const values = allowed.filter(value => requested.has(value));
    if (values.length) filters[property] = values;
  }
  const players = [...new Set(params.getAll('tl-player')
    .slice(0, TIMELINE_FILTER_LIMIT)
    .filter(isSafeTimelinePlayerId))];
  if (players.length) filters.players = players;
  if (params.get('tl-team-mention') === '1') filters.teamMention = true;
  const comment = params.get('tl-comment');
  if (['with', 'without'].includes(comment)) filters.comment = comment;
  return Object.keys(filters).length ? filters : null;
}

function appendTimelineFilters(params, filters) {
  if (!filters) return;
  for (const [property, parameter, allowed] of TIMELINE_FILTER_DEFINITIONS) {
    const selected = new Set(filters[property] || []);
    for (const value of allowed) {
      if (selected.has(value)) params.append(parameter, value);
    }
  }
  const players = [...new Set(filters.players || [])]
    .filter(isSafeTimelinePlayerId)
    .slice(0, TIMELINE_FILTER_LIMIT);
  for (const playerId of players) params.append('tl-player', playerId);
  if (filters.teamMention) params.set('tl-team-mention', '1');
  if (['with', 'without'].includes(filters.comment)) {
    params.set('tl-comment', filters.comment);
  }
}

export function parseStatsRoute(search = '') {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  if (mode === 'shared') {
    if (!params.has('game')) {
      return { mode: 'shared', status: 'missing-game', snapshotName: null };
    }
    const snapshotName = params.get('game');
    if (!isSafeSharedGameName(snapshotName)) {
      return { mode: 'shared', status: 'invalid-game', snapshotName: null };
    }
    const route = { mode: 'shared', status: 'ready', snapshotName };
    const timelineFilters = parseTimelineFilters(params);
    if (timelineFilters) route.timelineFilters = timelineFilters;
    return route;
  }
  if (mode !== 'review') return { mode: 'tracker' };

  if (!params.has('game')) {
    return { mode: 'review', status: 'missing-game', gameId: null };
  }

  const gameId = params.get('game');
  if (!gameId || gameId !== gameId.trim() || /[\u0000-\u001f\u007f]/.test(gameId)) {
    return { mode: 'review', status: 'invalid-game', gameId: null };
  }

  const route = { mode: 'review', status: 'ready', gameId };
  const timelineFilters = parseTimelineFilters(params);
  if (timelineFilters) route.timelineFilters = timelineFilters;
  return route;
}

export function buildReviewUrl(gameId, pathname = '/stats/', timelineFilters = null) {
  const params = new URLSearchParams({
    mode: 'review',
    game: String(gameId)
  });
  appendTimelineFilters(params, timelineFilters);
  return `${pathname}?${params}`;
}

export function buildSharedReviewUrl(snapshotName, pathname = '/stats/', timelineFilters = null) {
  const params = new URLSearchParams({
    mode: 'shared',
    game: String(snapshotName)
  });
  appendTimelineFilters(params, timelineFilters);
  return `${pathname}?${params}`;
}
