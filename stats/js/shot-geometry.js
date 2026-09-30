export const COURT_GEOMETRY = Object.freeze({
  widthFeet: 50,
  halfCourtLengthFeet: 47,
  basketXFeet: 25,
  basketYFeet: 5.25,
  paintLeftFeet: 17,
  paintRightFeet: 33,
  paintEndFeet: 19,
  restrictedRadiusFeet: 4,
  shortMidrangeRadiusFeet: 15,
  threePointRadiusFeet: 23.75,
  cornerThreeDistanceFeet: 22,
  cornerThreeLineEndFeet: 14,
  centerZoneHalfWidthFeet: 5
});

function assertNormalizedCoordinate(value, axis) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Shot location ${axis} must be a finite value from 0 through 1.`);
  }
}

function assertLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    throw new TypeError('Shot location must be an object.');
  }
  assertNormalizedCoordinate(location.x, 'x');
  assertNormalizedCoordinate(location.y, 'y');
}

function round(value, decimalPlaces = 4) {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function clampCourtLocation(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    throw new TypeError('Shot location must be an object.');
  }
  if (!Number.isFinite(location.x) || !Number.isFinite(location.y)) {
    throw new RangeError('Shot location coordinates must be finite numbers.');
  }
  return {
    x: Math.min(1, Math.max(0, location.x)),
    y: Math.min(1, Math.max(0, location.y))
  };
}

export function courtLocationToFeet(location) {
  assertLocation(location);
  return {
    x: location.x * COURT_GEOMETRY.widthFeet,
    y: location.y * COURT_GEOMETRY.halfCourtLengthFeet
  };
}

export function courtLocationFromFeet(location) {
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    throw new TypeError('Court position must be an object.');
  }
  if (!Number.isFinite(location.x) || !Number.isFinite(location.y)) {
    throw new RangeError('Court position coordinates must be finite numbers.');
  }
  const normalized = {
    x: location.x / COURT_GEOMETRY.widthFeet,
    y: location.y / COURT_GEOMETRY.halfCourtLengthFeet
  };
  assertLocation(normalized);
  return normalized;
}

export function getShotDistanceFeet(location) {
  const point = courtLocationToFeet(location);
  return Math.hypot(
    point.x - COURT_GEOMETRY.basketXFeet,
    point.y - COURT_GEOMETRY.basketYFeet
  );
}

export function getShotSide(location) {
  const point = courtLocationToFeet(location);
  const offset = point.x - COURT_GEOMETRY.basketXFeet;
  if (offset < -COURT_GEOMETRY.centerZoneHalfWidthFeet) return 'left';
  if (offset > COURT_GEOMETRY.centerZoneHalfWidthFeet) return 'right';
  return 'center';
}

export function getExpectedShotValue(location) {
  const point = courtLocationToFeet(location);
  const horizontalDistance = Math.abs(point.x - COURT_GEOMETRY.basketXFeet);
  const isCornerThree = point.y <= COURT_GEOMETRY.cornerThreeLineEndFeet
    && horizontalDistance >= COURT_GEOMETRY.cornerThreeDistanceFeet;
  const isArcThree = point.y > COURT_GEOMETRY.cornerThreeLineEndFeet
    && getShotDistanceFeet(location) >= COURT_GEOMETRY.threePointRadiusFeet;
  return isCornerThree || isArcThree ? 3 : 2;
}

export function getConfidentExpectedShotValue(location, toleranceFeet = 0.5) {
  if (!Number.isFinite(toleranceFeet) || toleranceFeet < 0) {
    throw new RangeError('Shot-value tolerance must be a non-negative finite number.');
  }
  const point = courtLocationToFeet(location);
  const horizontalDistance = Math.abs(point.x - COURT_GEOMETRY.basketXFeet);
  const boundaryDistance = point.y <= COURT_GEOMETRY.cornerThreeLineEndFeet
    ? Math.abs(horizontalDistance - COURT_GEOMETRY.cornerThreeDistanceFeet)
    : Math.abs(getShotDistanceFeet(location) - COURT_GEOMETRY.threePointRadiusFeet);
  return boundaryDistance <= toleranceFeet ? null : getExpectedShotValue(location);
}

export function getShotZone(location) {
  const point = courtLocationToFeet(location);
  const distance = getShotDistanceFeet(location);
  const side = getShotSide(location);
  const expectedShotValue = getExpectedShotValue(location);

  if (expectedShotValue === 3) {
    if (point.y <= COURT_GEOMETRY.cornerThreeLineEndFeet) {
      return side === 'left' ? 'left_corner_three' : 'right_corner_three';
    }
    if (side === 'left') return 'above_break_three_left';
    if (side === 'right') return 'above_break_three_right';
    return 'above_break_three_center';
  }
  if (distance <= COURT_GEOMETRY.restrictedRadiusFeet) return 'restricted_area';
  if (point.x >= COURT_GEOMETRY.paintLeftFeet
    && point.x <= COURT_GEOMETRY.paintRightFeet
    && point.y <= COURT_GEOMETRY.paintEndFeet) {
    return 'paint_non_restricted';
  }
  if (distance < COURT_GEOMETRY.shortMidrangeRadiusFeet) return 'short_midrange';
  return 'long_midrange';
}

export function deriveShotLocation(location) {
  assertLocation(location);
  const normalized = {
    x: round(location.x),
    y: round(location.y)
  };
  return {
    location: normalized,
    distanceFeet: round(getShotDistanceFeet(normalized), 1),
    side: getShotSide(normalized),
    zone: getShotZone(normalized),
    expectedShotValue: getExpectedShotValue(normalized)
  };
}
