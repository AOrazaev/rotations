import { getShotZone } from './shot-geometry.js';

export const SHOT_ZONE_LABELS = Object.freeze({
  restricted_area: 'Restricted area',
  paint_non_restricted: 'Paint',
  short_midrange: 'Short midrange',
  long_midrange: 'Long midrange',
  left_corner_three: 'Left corner 3',
  right_corner_three: 'Right corner 3',
  above_break_three_left: 'Left above-break 3',
  above_break_three_center: 'Center above-break 3',
  above_break_three_right: 'Right above-break 3'
});

export const SHOT_PRESSURE_LABELS = Object.freeze({
  open: 'Open',
  lightly_contested: 'Lightly contested',
  contested: 'Contested',
  heavily_contested: 'Heavily contested'
});

export const SHOT_PHASE_LABELS = Object.freeze({
  half_court: 'Half court',
  transition: 'Transition'
});

export const SHOT_CONTEXT_LABELS = Object.freeze({
  second_chance: 'Second chance'
});

export const SHOT_CREATION_LABELS = Object.freeze({
  catch_and_shoot: 'Catch-and-shoot',
  pull_up: 'Pull-up',
  drive: 'Drive',
  cut: 'Cut',
  post_up: 'Post-up',
  putback: 'Putback',
  other: 'Other'
});

export const UNTAGGED_SHOT_DETAIL = '__untagged__';

export function getShotDetailFacets(event) {
  const details = event?.type === 'shot' && [2, 3].includes(event.shotValue)
    ? event.shotDetails || null
    : null;
  return {
    zone: details?.location ? getShotZone(details.location) : null,
    pressure: details?.pressure || null,
    phase: details?.phase || null,
    contexts: [...(details?.contexts || [])],
    creation: details?.creation || null,
    tagged: Boolean(details)
  };
}

export function getShotDetailBadges(event) {
  const facets = getShotDetailFacets(event);
  const badges = [];
  if (facets.zone) badges.push({ kind: 'zone', value: facets.zone, label: SHOT_ZONE_LABELS[facets.zone] });
  if (facets.pressure) badges.push({
    kind: 'pressure',
    value: facets.pressure,
    label: SHOT_PRESSURE_LABELS[facets.pressure]
  });
  if (facets.phase) badges.push({ kind: 'phase', value: facets.phase, label: SHOT_PHASE_LABELS[facets.phase] });
  for (const context of facets.contexts) {
    badges.push({ kind: 'context', value: context, label: SHOT_CONTEXT_LABELS[context] });
  }
  if (facets.creation) badges.push({
    kind: 'creation',
    value: facets.creation,
    label: SHOT_CREATION_LABELS[facets.creation]
  });
  return badges;
}
