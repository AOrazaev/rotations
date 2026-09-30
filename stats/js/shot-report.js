import {
  SHOT_CONTEXT_LABELS,
  SHOT_CREATION_LABELS,
  SHOT_PHASE_LABELS,
  SHOT_PRESSURE_LABELS,
  SHOT_ZONE_LABELS,
  UNTAGGED_SHOT_DETAIL,
  getShotDetailFacets
} from './shot-details.js';
import { orderGameEvents } from './game-model.js';

export const SHOT_REPORT_DIMENSIONS = Object.freeze([
  { key: 'zone', label: 'Zone', labels: SHOT_ZONE_LABELS },
  { key: 'pressure', label: 'Pressure', labels: SHOT_PRESSURE_LABELS },
  { key: 'phase', label: 'Phase', labels: SHOT_PHASE_LABELS },
  { key: 'context', label: 'Context', labels: SHOT_CONTEXT_LABELS },
  { key: 'creation', label: 'Creation', labels: SHOT_CREATION_LABELS }
]);

export const SHOT_REPORT_ANY = '__any__';

function isFieldGoal(event) {
  return event?.type === 'shot' && [2, 3].includes(event.shotValue);
}

function periodizedFieldGoals(game) {
  let period = 1;
  const periodLabels = new Map();
  const shots = [];
  for (const event of orderGameEvents(game.events)) {
    if (event.type === 'period_end') {
      periodLabels.set(period, event.periodLabel);
      period++;
    } else if (isFieldGoal(event)) {
      shots.push({ event, period });
    }
  }
  return { shots, periodLabels };
}

export function getShotReportPeriods(game) {
  const { shots, periodLabels } = periodizedFieldGoals(game);
  return [...new Set(shots.map(item => item.period))].map(period => ({
    value: String(period),
    label: periodLabels.has(period)
      ? `Period ${period} — ${periodLabels.get(period)}`
      : `Period ${period}`
  }));
}

function facetValues(event, key) {
  const facets = getShotDetailFacets(event);
  if (key === 'context') {
    return facets.contexts.length ? facets.contexts : [UNTAGGED_SHOT_DETAIL];
  }
  return [facets[key] || UNTAGGED_SHOT_DETAIL];
}

function matchesFacet(event, key, selectedValue) {
  return selectedValue === SHOT_REPORT_ANY
    || facetValues(event, key).includes(selectedValue);
}

export function filterShotReportEvents(game, filters = {}) {
  const scope = filters.scope || 'team';
  const result = filters.result || SHOT_REPORT_ANY;
  const selectedPeriod = filters.period || SHOT_REPORT_ANY;
  return periodizedFieldGoals(game).shots.filter(({ event, period }) => {
    if (selectedPeriod !== SHOT_REPORT_ANY && String(period) !== selectedPeriod) return false;
    if (scope === 'opponent') {
      if (event.side !== 'opponent') return false;
    } else if (scope.startsWith('player:')) {
      if (event.side !== 'team' || event.playerId !== scope.slice('player:'.length)) return false;
    } else if (event.side !== 'team') {
      return false;
    }
    if (result === 'made' && !event.made) return false;
    if (result === 'missed' && event.made) return false;
    return ['pressure', 'phase', 'context', 'creation']
      .every(key => matchesFacet(event, key, filters[key] || SHOT_REPORT_ANY));
  }).map(item => item.event);
}

function summarizeBucket(events, key, value, label) {
  const matching = events.filter(event => facetValues(event, key).includes(value));
  const made = matching.filter(event => event.made).length;
  const points = matching.reduce(
    (total, event) => total + (event.made ? event.shotValue : 0),
    0
  );
  return {
    key: value,
    label,
    made,
    attempted: matching.length,
    percentage: matching.length ? made * 100 / matching.length : null,
    pointsPerAttempt: matching.length ? points / matching.length : null,
    eventIds: matching.map(event => event.id)
  };
}

function dimensionRows(events, dimension) {
  const rows = Object.entries(dimension.labels)
    .map(([value, label]) => summarizeBucket(events, dimension.key, value, label))
    .filter(row => row.attempted > 0);
  const untagged = summarizeBucket(
    events,
    dimension.key,
    UNTAGGED_SHOT_DETAIL,
    dimension.key === 'zone' ? 'No location' : 'Not tagged'
  );
  if (untagged.attempted || !rows.length) rows.push(untagged);
  return rows;
}

export function buildShotReport(game, filters = {}) {
  const events = filterShotReportEvents(game, filters);
  const made = events.filter(event => event.made).length;
  const points = events.reduce(
    (total, event) => total + (event.made ? event.shotValue : 0),
    0
  );
  return {
    events,
    plottedEvents: events.filter(event => event.shotDetails?.location),
    made,
    attempted: events.length,
    percentage: events.length ? made * 100 / events.length : null,
    pointsPerAttempt: events.length ? points / events.length : null,
    dimensions: Object.fromEntries(
      SHOT_REPORT_DIMENSIONS.map(dimension => [
        dimension.key,
        dimensionRows(events, dimension)
      ])
    )
  };
}
