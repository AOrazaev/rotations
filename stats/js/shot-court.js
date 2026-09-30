import {
  COURT_GEOMETRY,
  deriveShotLocation
} from './shot-geometry.js';
import { SHOT_ZONE_LABELS } from './shot-details.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const VIEWBOX_WIDTH = 500;
const VIEWBOX_HEIGHT = 470;
const KEYBOARD_STEP = 0.01;
const KEYBOARD_LARGE_STEP = 0.05;

function createSvgElement(documentObject, name, attributes = {}) {
  const element = documentObject.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function appendLine(documentObject, court, x1, y1, x2, y2, className = 'shot-court-line') {
  court.appendChild(createSvgElement(documentObject, 'line', {
    x1,
    y1,
    x2,
    y2,
    class: className
  }));
}

export function createShotCourtDiagram(documentObject = document, attributes = {}) {
  const court = createSvgElement(documentObject, 'svg', {
    class: 'shot-court-svg',
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
    role: 'img',
    'aria-label': 'Basketball half court',
    ...attributes
  });

  court.appendChild(createSvgElement(documentObject, 'rect', {
    class: 'shot-court-floor',
    x: 1,
    y: 1,
    width: VIEWBOX_WIDTH - 2,
    height: VIEWBOX_HEIGHT - 2,
    rx: 4
  }));
  court.appendChild(createSvgElement(documentObject, 'rect', {
    class: 'shot-court-line',
    x: 170,
    y: 0,
    width: 160,
    height: 190
  }));
  court.appendChild(createSvgElement(documentObject, 'circle', {
    class: 'shot-court-line',
    cx: 250,
    cy: 190,
    r: 60
  }));
  court.appendChild(createSvgElement(documentObject, 'path', {
    class: 'shot-court-line',
    d: 'M 210 52.5 A 40 40 0 0 0 290 52.5'
  }));
  court.appendChild(createSvgElement(documentObject, 'path', {
    class: 'shot-court-line',
    d: 'M 30 140 L 30 0 M 470 140 L 470 0 M 30 140 A 237.5 237.5 0 0 0 470 140'
  }));
  appendLine(documentObject, court, 220, 40, 280, 40, 'shot-court-backboard');
  court.appendChild(createSvgElement(documentObject, 'circle', {
    class: 'shot-court-rim',
    cx: 250,
    cy: 52.5,
    r: 7.5
  }));
  appendLine(documentObject, court, 0, 470, 500, 470, 'shot-court-half-line');
  court.appendChild(createSvgElement(documentObject, 'path', {
    class: 'shot-court-center-arc',
    d: 'M 190 470 A 60 60 0 0 1 310 470'
  }));
  return court;
}

function buildCourt(documentObject, statusId) {
  const court = createShotCourtDiagram(documentObject, {
    role: 'application',
    tabindex: '0',
    'aria-label': 'Shot location half court',
    'aria-describedby': statusId
  });

  const markerTarget = createSvgElement(documentObject, 'circle', {
    class: 'shot-court-marker-target hidden',
    r: 18,
    'aria-hidden': 'true'
  });
  const marker = createSvgElement(documentObject, 'circle', {
    class: 'shot-court-marker hidden',
    r: 8,
    'aria-hidden': 'true'
  });
  court.append(markerTarget, marker);
  return { court, marker, markerTarget };
}

function pointerLocation(court, event) {
  const bounds = court.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
  };
}

function locationDescription(location, shotValue) {
  if (!location) {
    return 'No location selected. Press Enter to place a marker, use the arrow keys to move it, or tap the court.';
  }
  const derived = deriveShotLocation(location);
  const valueDescription = `${derived.expectedShotValue}PT area`;
  const mismatch = shotValue && shotValue !== derived.expectedShotValue
    ? `; recorded as ${shotValue}PT`
    : '';
  return `${SHOT_ZONE_LABELS[derived.zone]} · ${derived.distanceFeet.toFixed(1)} ft · ${valueDescription}${mismatch}`;
}

export function createShotCourt({
  element,
  documentObject = document,
  location = null,
  shotValue = null,
  disabled = false,
  onChange = () => {}
}) {
  if (!element) throw new Error('Shot court host element is required.');

  const status = documentObject.createElement('p');
  status.className = 'shot-court-status';
  status.id = `${element.id || 'shotCourt'}Status`;
  status.setAttribute('aria-live', 'polite');
  const instructions = documentObject.createElement('p');
  instructions.className = 'shot-court-instructions';
  instructions.textContent = 'Tap or click to place. Arrow keys move 1%; hold Shift for 5%. Delete clears.';
  const { court, marker, markerTarget } = buildCourt(documentObject, status.id);
  element.replaceChildren(court, status, instructions);

  let currentLocation = location ? deriveShotLocation(location).location : null;
  let currentShotValue = shotValue;
  let currentDisabled = Boolean(disabled);
  let pointerId = null;

  function render() {
    court.setAttribute('aria-disabled', String(currentDisabled));
    court.classList.toggle('disabled', currentDisabled);
    status.textContent = locationDescription(currentLocation, currentShotValue);
    status.classList.toggle(
      'shot-value-mismatch',
      Boolean(currentLocation && currentShotValue && deriveShotLocation(currentLocation).expectedShotValue !== currentShotValue)
    );
    for (const elementToPosition of [marker, markerTarget]) {
      elementToPosition.classList.toggle('hidden', !currentLocation);
      if (currentLocation) {
        elementToPosition.setAttribute('cx', String(currentLocation.x * VIEWBOX_WIDTH));
        elementToPosition.setAttribute('cy', String(currentLocation.y * VIEWBOX_HEIGHT));
      }
    }
  }

  function updateLocation(nextLocation, { commit = false } = {}) {
    currentLocation = nextLocation ? deriveShotLocation(nextLocation).location : null;
    render();
    if (commit) onChange(currentLocation ? structuredClone(currentLocation) : null);
  }

  function handlePointerDown(event) {
    if (currentDisabled || event.button !== 0) return;
    pointerId = event.pointerId;
    court.setPointerCapture(pointerId);
    updateLocation(pointerLocation(court, event));
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (currentDisabled || event.pointerId !== pointerId) return;
    updateLocation(pointerLocation(court, event));
  }

  function finishPointer(event) {
    if (event.pointerId !== pointerId) return;
    updateLocation(pointerLocation(court, event), { commit: true });
    pointerId = null;
    if (court.hasPointerCapture(event.pointerId)) court.releasePointerCapture(event.pointerId);
  }

  function cancelPointer(event) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    if (court.hasPointerCapture(event.pointerId)) court.releasePointerCapture(event.pointerId);
  }

  function handleKeyDown(event) {
    if (currentDisabled) return;
    if ((event.key === 'Enter' || event.key === ' ') && !currentLocation) {
      updateLocation({ x: 0.5, y: 0.5 }, { commit: true });
      event.preventDefault();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && currentLocation) {
      updateLocation(null, { commit: true });
      event.preventDefault();
      return;
    }
    const changes = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    };
    const change = changes[event.key];
    if (!change || !currentLocation) return;
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
    updateLocation({
      x: Math.min(1, Math.max(0, currentLocation.x + change[0] * step)),
      y: Math.min(1, Math.max(0, currentLocation.y + change[1] * step))
    }, { commit: true });
    event.preventDefault();
  }

  court.addEventListener('pointerdown', handlePointerDown);
  court.addEventListener('pointermove', handlePointerMove);
  court.addEventListener('pointerup', finishPointer);
  court.addEventListener('pointercancel', cancelPointer);
  court.addEventListener('keydown', handleKeyDown);
  render();

  return {
    getLocation: () => currentLocation ? structuredClone(currentLocation) : null,
    setLocation(nextLocation) {
      updateLocation(nextLocation);
    },
    setShotValue(nextShotValue) {
      currentShotValue = nextShotValue;
      render();
    },
    setDisabled(nextDisabled) {
      currentDisabled = Boolean(nextDisabled);
      render();
    },
    focus() {
      court.focus();
    },
    destroy() {
      court.removeEventListener('pointerdown', handlePointerDown);
      court.removeEventListener('pointermove', handlePointerMove);
      court.removeEventListener('pointerup', finishPointer);
      court.removeEventListener('pointercancel', cancelPointer);
      court.removeEventListener('keydown', handleKeyDown);
      element.replaceChildren();
    }
  };
}
