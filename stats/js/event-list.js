import {
  getLineupAtEventPosition,
  orderGameEvents
} from './game-model.js';
import { editableEventTypes } from './voice-proposal.js';
import { createShotDetailsEditor } from './shot-details-editor.js';
import { getConfidentExpectedShotValue } from './shot-geometry.js';
import {
  getShotDetailBadges,
  getShotDetailFacets,
  UNTAGGED_SHOT_DETAIL
} from './shot-details.js';
import { formatVideoTime } from './youtube-player.js';

const PREVIEW_SECONDS = 3;
const EDITABLE_TYPES = new Set([
  'shot',
  'rebound',
  'assist',
  'steal',
  'block',
  'turnover',
  'foul',
  'substitution',
  'timeout',
  'period_end',
  'note'
]);

export function describeEvent(event, playersById, score = null) {
  const subject = event.side === 'opponent'
    ? 'Opponent'
    : playersById[event.playerId]?.name || 'Our team';
  if (event.type === 'shot') {
    const shot = event.shotValue === 1 ? 'FT' : `${event.shotValue}PT`;
    const scoreLabel = event.made && score ? ` - ${score.team}:${score.opponent}` : '';
    return `${subject} ${event.made ? 'made' : 'missed'} ${shot}${scoreLabel}`;
  }
  if (event.type === 'rebound') return `${subject} ${event.reboundKind} rebound`;
  if (event.type === 'substitution') {
    return `${playersById[event.playerInId]?.name || 'Player'} in for ${playersById[event.playerOutId]?.name || 'player'}`;
  }
  if (event.type === 'timeout') return `${event.side === 'opponent' ? 'Opponent' : 'Our team'} timeout`;
  if (event.type === 'period_end') return event.periodLabel;
  if (event.type === 'note') return event.note;
  return `${subject} ${event.type}`;
}

export function createEventListController({
  documentObject = document,
  videoController,
  saveGame,
  readOnly = false,
  initialEarliestFirst = false,
  followPlayback = false,
  initialFilters = null,
  onFiltersChanged = () => {},
  now = () => new Date().toISOString(),
  confirmFn = message => confirm(message),
  onError = () => {}
}) {
  const eventList = documentObject.querySelector('#eventList');
  const emptyEvents = documentObject.querySelector('#emptyEvents');
  const eventTemplate = documentObject.querySelector('#eventListItemTemplate');
  const dialog = documentObject.querySelector('#eventEditDialog');
  const form = documentObject.querySelector('#eventEditForm');
  const cancelButton = documentObject.querySelector('#cancelEventEdit');
  const sideInput = documentObject.querySelector('#editEventSide');
  const playerInput = documentObject.querySelector('#editEventPlayer');
  const typeInput = documentObject.querySelector('#editEventType');
  const shotFields = documentObject.querySelector('#editShotFields');
  const shotValueInput = documentObject.querySelector('#editShotValue');
  const shotMadeInput = documentObject.querySelector('#editShotMade');
  const shotDetailsFields = documentObject.querySelector('#editShotDetailsFields');
  const shotDetailsHost = documentObject.querySelector('#editShotDetails');
  const reboundFields = documentObject.querySelector('#editReboundFields');
  const reboundKindInput = documentObject.querySelector('#editReboundKind');
  const substitutionFields = documentObject.querySelector('#editSubstitutionFields');
  const playerOutInput = documentObject.querySelector('#editPlayerOut');
  const playerInInput = documentObject.querySelector('#editPlayerIn');
  const periodEndFields = documentObject.querySelector('#editPeriodEndFields');
  const periodLabelInput = documentObject.querySelector('#editPeriodLabel');
  const noteFields = documentObject.querySelector('#editNoteFields');
  const noteInput = documentObject.querySelector('#editNote');
  const timestampDisplay = documentObject.querySelector('#editEventTimestamp');
  const useCurrentButton = documentObject.querySelector('#useCurrentEventTime');
  const editError = documentObject.querySelector('#eventEditError');
  const commentDialog = documentObject.querySelector('#coachCommentDialog');
  const commentForm = documentObject.querySelector('#coachCommentForm');
  const commentText = documentObject.querySelector('#coachCommentText');
  const commentError = documentObject.querySelector('#coachCommentError');
  const cancelComment = documentObject.querySelector('#cancelCoachComment');
  const removeComment = documentObject.querySelector('#removeCoachComment');
  const filterButton = documentObject.querySelector('#openEventFilters');
  const filterCount = documentObject.querySelector('#eventFilterCount');
  const filterDialog = documentObject.querySelector('#eventFilterDialog');
  const filterForm = documentObject.querySelector('#eventFilterForm');
  const filterPlayers = documentObject.querySelector('#eventFilterPlayers');
  const filterTeamMention = documentObject.querySelector('#filterTeamMention');
  const cancelFilters = documentObject.querySelector('#cancelEventFilters');
  const clearFilters = documentObject.querySelector('#clearEventFilters');
  const orderButton = documentObject.querySelector('#toggleEventOrder');
  const orderDescription = documentObject.querySelector('#eventOrderDescription');
  const followPlaybackButton = documentObject.querySelector('#followTimelinePlayback');
  const activeFilters = documentObject.querySelector('#activeEventFilters');
  const filterSummary = documentObject.querySelector('#timelineFilterSummary');
  const copyFilteredReviewLink = documentObject.querySelector('#copyFilteredReviewLink');
  const copyFilteredReviewStatus = documentObject.querySelector('#copyFilteredReviewStatus');
  const shotFilterDetails = documentObject.querySelector('#shotFilterDetails');
  const shotFilterSelectionCount = documentObject.querySelector('#shotFilterSelectionCount');
  const mobileTimelineBackdrop = documentObject.querySelector('#mobileTimelineBackdrop');
  const mobileTimelineContent = documentObject.querySelector('#mobileTimelineContent');
  const mobileTimelinePreview = documentObject.querySelector('#mobileTimelinePreview');
  const mobileTimelineToggle = documentObject.querySelector('#toggleMobileTimeline');
  const timelineScrollContainer = eventList;
  const quickTimestampActions = readOnly ? null : documentObject.createElement('div');
  const quickTimestampEarlier = readOnly ? null : documentObject.createElement('button');
  const quickTimestampLater = readOnly ? null : documentObject.createElement('button');

  let game = null;
  let editingEventId = null;
  let commentEventId = null;
  let quickTimestampEventId = null;
  let quickTimestampPositionFrame = null;
  let editingSeconds = 0;
  let busy = false;
  let earliestFirst = initialEarliestFirst;
  let activeEventId = null;
  let highlightedEventIds = new Set();
  let voiceCommands = [];
  const expandedVoiceCommandIds = new Set();
  let lastPlaybackSeconds = 0;
  let playbackFollowing = true;
  let suppressManualScrollUntil = 0;
  let eventSummaries = new Map();
  let mobileTimelineOpen = false;
  let mobileTimelinePointer = null;
  let suppressMobileTimelineClickUntil = 0;

  if (quickTimestampActions) {
    quickTimestampActions.id = 'eventTimestampQuickActions';
    quickTimestampActions.className = 'event-timestamp-quick-actions hidden';
    quickTimestampActions.setAttribute('role', 'menu');
    quickTimestampActions.setAttribute('aria-label', 'Adjust event timestamp');
    quickTimestampEarlier.type = 'button';
    quickTimestampEarlier.className = 'secondary small';
    quickTimestampEarlier.setAttribute('role', 'menuitem');
    quickTimestampEarlier.setAttribute('aria-label', 'Move event one second earlier');
    quickTimestampEarlier.textContent = '−1s';
    quickTimestampLater.type = 'button';
    quickTimestampLater.className = 'secondary small';
    quickTimestampLater.setAttribute('role', 'menuitem');
    quickTimestampLater.setAttribute('aria-label', 'Move event one second later');
    quickTimestampLater.textContent = '+1s';
    quickTimestampActions.append(quickTimestampEarlier, quickTimestampLater);
    documentObject.body.appendChild(quickTimestampActions);
  }

  function closeQuickTimestampActions() {
    if (!quickTimestampActions) return;
    quickTimestampActions.classList.add('hidden');
    quickTimestampActions.style.removeProperty('left');
    quickTimestampActions.style.removeProperty('top');
    eventList.querySelectorAll('[data-action="open-time-actions"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
    });
    quickTimestampEventId = null;
  }

  function positionQuickTimestampActions(anchor) {
    if (!quickTimestampActions || !anchor) return;
    const windowObject = documentObject.defaultView;
    quickTimestampActions.classList.remove('hidden');
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = quickTimestampActions.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const left = Math.min(
      windowObject.innerWidth - menuRect.width - margin,
      Math.max(margin, anchorRect.left)
    );
    let top = anchorRect.bottom + gap;
    if (top + menuRect.height > windowObject.innerHeight - margin) {
      top = Math.max(margin, anchorRect.top - menuRect.height - gap);
    }
    quickTimestampActions.style.left = `${left}px`;
    quickTimestampActions.style.top = `${top}px`;
  }

  function quickTimestampAnchorIsVisible(anchor) {
    const windowObject = documentObject.defaultView;
    const anchorRect = anchor.getBoundingClientRect();
    if (anchorRect.bottom <= 0 || anchorRect.top >= windowObject.innerHeight
      || anchorRect.right <= 0 || anchorRect.left >= windowObject.innerWidth) {
      return false;
    }
    let ancestor = anchor.parentElement;
    while (ancestor && ancestor !== documentObject.body) {
      const style = windowObject.getComputedStyle(ancestor);
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const ancestorRect = ancestor.getBoundingClientRect();
        if (anchorRect.bottom <= ancestorRect.top || anchorRect.top >= ancestorRect.bottom
          || anchorRect.right <= ancestorRect.left || anchorRect.left >= ancestorRect.right) {
          return false;
        }
      }
      ancestor = ancestor.parentElement;
    }
    return true;
  }

  function openQuickTimestampActions(eventId, anchor) {
    if (!quickTimestampActions) return;
    const reopening = quickTimestampEventId === eventId
      && !quickTimestampActions.classList.contains('hidden');
    closeQuickTimestampActions();
    if (reopening) return;
    quickTimestampEventId = eventId;
    anchor.setAttribute('aria-expanded', 'true');
    const selected = game?.events.find(event => event.id === eventId);
    quickTimestampEarlier.disabled = !selected || selected.videoSeconds <= 0;
    positionQuickTimestampActions(anchor);
    quickTimestampEarlier.focus();
  }

  function restoreQuickTimestampActions() {
    if (!quickTimestampEventId || !quickTimestampActions) return;
    const anchor = eventList.querySelector(
      `[data-event-id="${CSS.escape(quickTimestampEventId)}"] [data-action="open-time-actions"]`
    );
    if (!anchor) {
      closeQuickTimestampActions();
      return;
    }
    if (!quickTimestampAnchorIsVisible(anchor)) {
      closeQuickTimestampActions();
      return;
    }
    anchor.setAttribute('aria-expanded', 'true');
    const selected = game?.events.find(event => event.id === quickTimestampEventId);
    quickTimestampEarlier.disabled = !selected || selected.videoSeconds <= 0;
    positionQuickTimestampActions(anchor);
  }

  function scheduleQuickTimestampPosition() {
    if (!quickTimestampEventId || quickTimestampPositionFrame !== null) return;
    quickTimestampPositionFrame = documentObject.defaultView.requestAnimationFrame(() => {
      quickTimestampPositionFrame = null;
      restoreQuickTimestampActions();
    });
  }

  function handleQuickTimestampDocumentClick(event) {
    if (!quickTimestampActions || quickTimestampActions.classList.contains('hidden')) return;
    if (quickTimestampActions.contains(event.target)
      || event.target.closest?.('[data-action="open-time-actions"]')) return;
    closeQuickTimestampActions();
  }

  function handleQuickTimestampKeydown(event) {
    if (event.key === 'Escape' && !quickTimestampActions?.classList.contains('hidden')) {
      closeQuickTimestampActions();
    }
  }

  async function adjustQuickTimestamp(delta) {
    if (!game || !quickTimestampEventId || busy) return;
    const selected = game.events.find(event => event.id === quickTimestampEventId);
    if (!selected) {
      closeQuickTimestampActions();
      return;
    }
    const videoSeconds = Math.max(0, selected.videoSeconds + delta);
    if (videoSeconds === selected.videoSeconds) return;
    busy = true;
    quickTimestampEarlier.disabled = true;
    quickTimestampLater.disabled = true;
    try {
      const next = structuredClone(game);
      const adjusted = next.events.find(event => event.id === quickTimestampEventId);
      adjusted.videoSeconds = videoSeconds;
      adjusted.updatedAt = now();
      next.updatedAt = now();
      await commit(next);
      restoreQuickTimestampActions();
    } catch (error) {
      onError(error);
    } finally {
      busy = false;
      quickTimestampLater.disabled = false;
      const current = game?.events.find(event => event.id === quickTimestampEventId);
      quickTimestampEarlier.disabled = !current || current.videoSeconds <= 0;
    }
  }

  function createFilterState(source = {}) {
    return {
      sides: new Set(source.sides || []),
      types: new Set(source.types || []),
      players: new Set(source.players || []),
      teamMention: Boolean(source.teamMention),
      comment: ['with', 'without'].includes(source.comment) ? source.comment : 'any',
      shotZones: new Set(source.shotZones || []),
      shotPressures: new Set(source.shotPressures || []),
      shotPhases: new Set(source.shotPhases || []),
      shotContexts: new Set(source.shotContexts || []),
      shotCreations: new Set(source.shotCreations || [])
    };
  }

  function getFilterState() {
    return {
      sides: [...filters.sides],
      types: [...filters.types],
      players: [...filters.players],
      teamMention: filters.teamMention,
      comment: filters.comment,
      shotZones: [...filters.shotZones],
      shotPressures: [...filters.shotPressures],
      shotPhases: [...filters.shotPhases],
      shotContexts: [...filters.shotContexts],
      shotCreations: [...filters.shotCreations]
    };
  }

  let filters = createFilterState(initialFilters || {});
  const shotDetailsEditor = readOnly ? null : createShotDetailsEditor({
    element: shotDetailsHost,
    documentObject
  });

  function setEditError(message = '') {
    editError.textContent = message;
    editError.classList.toggle('hidden', !message);
  }

  function setCommentError(message = '') {
    commentError.textContent = message;
    commentError.classList.toggle('hidden', !message);
  }

  function openCommentEditor(event) {
    commentEventId = event.id;
    commentText.value = event.coachComment || '';
    removeComment.classList.toggle('hidden', !event.coachComment);
    setCommentError();
    commentDialog.showModal();
    commentText.focus();
  }

  function updateDependentFields() {
    shotFields.classList.toggle('hidden', typeInput.value !== 'shot');
    const isFieldGoal = typeInput.value === 'shot' && ['2', '3'].includes(shotValueInput.value);
    shotDetailsFields.classList.toggle('hidden', !isFieldGoal);
    if (isFieldGoal) shotDetailsEditor.setShotValue(Number(shotValueInput.value));
    reboundFields.classList.toggle('hidden', typeInput.value !== 'rebound');
    substitutionFields.classList.toggle('hidden', typeInput.value !== 'substitution');
    periodEndFields.classList.toggle('hidden', typeInput.value !== 'period_end');
    noteFields.classList.toggle('hidden', typeInput.value !== 'note');
  }

  function playerLabel(player) {
    return player.number ? `#${player.number} ${player.name}` : player.name;
  }

  function checkedValues(name) {
    return new Set(
      [...filterForm.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value)
    );
  }

  function setCheckedValues(name, values) {
    filterForm.querySelectorAll(`input[name="${name}"]`).forEach(input => {
      input.checked = values.has(input.value);
    });
  }

  function activeFilterCount() {
    return Number(filters.sides.size > 0)
      + Number(filters.types.size > 0)
      + Number(filters.players.size > 0 || filters.teamMention)
      + Number(filters.comment !== 'any')
      + Number(filters.shotZones.size > 0)
      + Number(filters.shotPressures.size > 0)
      + Number(filters.shotPhases.size > 0)
      + Number(filters.shotContexts.size > 0)
      + Number(filters.shotCreations.size > 0);
  }

  function selectedShotFilterCount() {
    return filters.shotZones.size
      + filters.shotPressures.size
      + filters.shotPhases.size
      + filters.shotContexts.size
      + filters.shotCreations.size;
  }

  function draftShotFilterCount() {
    return filterForm.querySelectorAll(
      'input[name^="filterShot"]:checked'
    ).length;
  }

  function updateShotFilterSummary(count = draftShotFilterCount()) {
    shotFilterSelectionCount.textContent = count
      ? `${count} selected`
      : 'None selected';
  }

  function filterInputLabel(input, group) {
    const label = input?.closest('label')?.textContent.trim() || input?.value || '';
    if (input?.value === UNTAGGED_SHOT_DETAIL) {
      const legend = input.closest('fieldset')?.querySelector('legend')?.textContent.trim();
      return legend ? `${legend.replace(/^Shot /, '')}: ${label}` : label;
    }
    if (group === 'players') return label;
    return label;
  }

  function appendFilterChip(group, value, input) {
    const label = filterInputLabel(input, group);
    if (!label) return;
    const button = documentObject.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    button.dataset.filterGroup = group;
    button.dataset.filterValue = value;
    button.setAttribute('aria-label', `Remove ${label} filter`);
    const text = documentObject.createElement('span');
    text.className = 'filter-chip-label';
    text.textContent = label;
    const remove = documentObject.createElement('span');
    remove.className = 'filter-chip-remove';
    remove.setAttribute('aria-hidden', 'true');
    remove.textContent = '×';
    button.append(text, remove);
    activeFilters.appendChild(button);
  }

  function updateActiveFilterChips() {
    activeFilters.innerHTML = '';
    const inputGroups = [
      ['sides', 'filterSide'],
      ['types', 'filterType'],
      ['players', 'filterPlayer'],
      ['shotZones', 'filterShotZone'],
      ['shotPressures', 'filterShotPressure'],
      ['shotPhases', 'filterShotPhase'],
      ['shotContexts', 'filterShotContext'],
      ['shotCreations', 'filterShotCreation']
    ];
    for (const [group, inputName] of inputGroups) {
      for (const value of filters[group]) {
        const input = filterForm.querySelector(
          `input[name="${inputName}"][value="${CSS.escape(value)}"]`
        );
        appendFilterChip(group, value, input);
      }
    }
    if (filters.teamMention) {
      appendFilterChip('teamMention', 'true', filterTeamMention);
    }
    if (filters.comment !== 'any') {
      const input = filterForm.querySelector(
        `input[name="filterComment"][value="${filters.comment}"]`
      );
      appendFilterChip('comment', filters.comment, input);
    }
    const hasFilters = activeFilters.childElementCount > 0;
    filterSummary.classList.toggle('hidden', !hasFilters);
    copyFilteredReviewLink.classList.toggle('hidden', !readOnly || !hasFilters);
  }

  function updateFilterButton() {
    const count = activeFilterCount();
    filterButton.classList.toggle('active', count > 0);
    filterCount.textContent = String(count);
    filterCount.classList.toggle('hidden', count === 0);
    const label = count ? `Filter timeline, ${count} active` : 'Filter timeline';
    filterButton.setAttribute('aria-label', label);
    filterButton.title = label;
  }

  function updateOrderControl() {
    const action = earliestFirst ? 'Show latest events first' : 'Show earliest events first';
    orderButton.setAttribute('aria-label', action);
    orderButton.title = action;
    orderButton.classList.toggle('earliest-first', earliestFirst);
    orderDescription.textContent = earliestFirst ? 'Earliest first.' : 'Latest first.';
  }

  function timelineScrollsPage() {
    return documentObject.defaultView.getComputedStyle(timelineScrollContainer).overflowY === 'visible';
  }

  function updatePlaybackFollowControl() {
    const pageScroll = timelineScrollsPage();
    const label = pageScroll ? 'Jump to current event' : 'Follow playback';
    followPlaybackButton.textContent = label;
    followPlaybackButton.title = label;
    followPlaybackButton.classList.toggle(
      'hidden',
      !followPlayback || (!pageScroll && playbackFollowing)
    );
  }

  function setMobileTimelineOpen(open) {
    if (!readOnly) return;
    mobileTimelineOpen = Boolean(open);
    eventList.closest('#eventLogPanel')?.classList.toggle('mobile-timeline-open', mobileTimelineOpen);
    mobileTimelineBackdrop.classList.toggle('hidden', !mobileTimelineOpen);
    documentObject.body.classList.toggle('mobile-timeline-sheet-open', mobileTimelineOpen);
    mobileTimelineToggle.setAttribute('aria-expanded', String(mobileTimelineOpen));
    mobileTimelineToggle.setAttribute(
      'aria-label',
      mobileTimelineOpen ? 'Close event timeline' : 'Open event timeline'
    );
    mobileTimelineContent.inert = !mobileTimelineOpen;
  }

  function syncMobileTimelineMode() {
    if (!readOnly) return;
    if (documentObject.defaultView.matchMedia('(max-width: 760px)').matches) {
      setMobileTimelineOpen(false);
      return;
    }
    mobileTimelineOpen = false;
    eventList.closest('#eventLogPanel')?.classList.remove('mobile-timeline-open');
    mobileTimelineBackdrop.classList.add('hidden');
    documentObject.body.classList.remove('mobile-timeline-sheet-open');
    mobileTimelineToggle.setAttribute('aria-expanded', 'false');
    mobileTimelineToggle.setAttribute('aria-label', 'Open event timeline');
    mobileTimelineContent.inert = false;
  }

  function updateMobileTimelinePreview() {
    mobileTimelinePreview.textContent = activeEventId
      ? eventSummaries.get(activeEventId) || 'Current event'
      : 'Waiting for playback';
  }

  function setPlaybackFollowing(following) {
    playbackFollowing = following;
    updatePlaybackFollowControl();
  }

  function setActiveEvent(eventId) {
    activeEventId = eventId;
    for (const item of eventList.querySelectorAll('[data-event-id]')) {
      const active = item.dataset.eventId === eventId;
      item.classList.toggle('current-event', active);
      if (active) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
    updateMobileTimelinePreview();
  }

  function scrollActiveEventIntoView({ allowPageScroll = false } = {}) {
    if (!activeEventId || !videoController.isPlaying()) return;
    const item = eventList.querySelector(`[data-event-id="${CSS.escape(activeEventId)}"]`);
    if (!item) return;
    if (timelineScrollsPage()) {
      setPlaybackFollowing(false);
      if (!allowPageScroll) return;
      item.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (!playbackFollowing) return;
    const panelBox = timelineScrollContainer.getBoundingClientRect();
    const itemBox = item.getBoundingClientRect();
    const top = timelineScrollContainer.scrollTop
      + itemBox.top
      - panelBox.top
      - (timelineScrollContainer.clientHeight - itemBox.height) / 2;
    suppressManualScrollUntil = Date.now() + 500;
    timelineScrollContainer.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function updatePlaybackPosition(seconds, {
    forceScroll = false,
    allowPageScroll = false
  } = {}) {
    lastPlaybackSeconds = seconds;
    if (followPlayback) updatePlaybackFollowControl();
    const orderedEvents = orderGameEvents(game?.events || []);
    let currentEvent = null;
    for (const event of orderedEvents) {
      if (event.videoSeconds > seconds) break;
      currentEvent = event;
    }
    const nextEventId = currentEvent?.id || null;
    const changed = nextEventId !== activeEventId;
    setActiveEvent(nextEventId);
    if (followPlayback && (changed || forceScroll)) {
      scrollActiveEventIntoView({ allowPageScroll });
    }
  }

  function pausePlaybackFollowing() {
    if (followPlayback && playbackFollowing) setPlaybackFollowing(false);
  }

  function handleTimelineScroll() {
    if (Date.now() >= suppressManualScrollUntil) pausePlaybackFollowing();
  }

  function populateFilterPlayers() {
    filterPlayers.innerHTML = '';
    if (game) {
      filters.players = new Set(
        game.players
          .map(player => player.id)
          .filter(playerId => filters.players.has(playerId))
      );
    }
    for (const player of game?.players || []) {
      const label = documentObject.createElement('label');
      const input = documentObject.createElement('input');
      input.type = 'checkbox';
      input.name = 'filterPlayer';
      input.value = player.id;
      input.checked = filters.players.has(player.id);
      label.append(input, documentObject.createTextNode(` ${playerLabel(player)}`));
      filterPlayers.appendChild(label);
    }
  }

  function syncFilterForm() {
    setCheckedValues('filterSide', filters.sides);
    setCheckedValues('filterType', filters.types);
    setCheckedValues('filterShotZone', filters.shotZones);
    setCheckedValues('filterShotPressure', filters.shotPressures);
    setCheckedValues('filterShotPhase', filters.shotPhases);
    setCheckedValues('filterShotContext', filters.shotContexts);
    setCheckedValues('filterShotCreation', filters.shotCreations);
    populateFilterPlayers();
    filterTeamMention.checked = filters.teamMention;
    const comment = filterForm.querySelector(`input[name="filterComment"][value="${filters.comment}"]`);
    if (comment) comment.checked = true;
    const shotCount = selectedShotFilterCount();
    shotFilterDetails.open = shotCount > 0;
    updateShotFilterSummary(shotCount);
  }

  function eventMatchesFilters(event) {
    if (filters.sides.size && !filters.sides.has(event.side)) return false;
    if (filters.types.size && !filters.types.has(event.type)) return false;
    if (filters.players.size || filters.teamMention) {
      const eventPlayerIds = [event.playerId, event.playerInId, event.playerOutId].filter(Boolean);
      const matchesPlayer = eventPlayerIds.some(playerId => filters.players.has(playerId));
      const mentionsTeam = filters.teamMention
        && [...String(event.coachComment || '').matchAll(/@([A-Za-z0-9]+)/g)]
          .some(match => match[1].toLowerCase() === 'team');
      if (!matchesPlayer && !mentionsTeam) return false;
    }
    const hasComment = Boolean(String(event.coachComment || '').trim());
    if (filters.comment === 'with' && !hasComment) return false;
    if (filters.comment === 'without' && hasComment) return false;
    const hasShotFilters = filters.shotZones.size
      || filters.shotPressures.size
      || filters.shotPhases.size
      || filters.shotContexts.size
      || filters.shotCreations.size;
    if (hasShotFilters) {
      if (event.type !== 'shot' || ![2, 3].includes(event.shotValue)) return false;
      const facets = getShotDetailFacets(event);
      const matchesValue = (selected, value) => !selected.size
        || selected.has(value || UNTAGGED_SHOT_DETAIL);
      const contextValues = facets.contexts.length ? facets.contexts : [UNTAGGED_SHOT_DETAIL];
      if (!matchesValue(filters.shotZones, facets.zone)) return false;
      if (!matchesValue(filters.shotPressures, facets.pressure)) return false;
      if (!matchesValue(filters.shotPhases, facets.phase)) return false;
      if (filters.shotContexts.size
        && !contextValues.some(context => filters.shotContexts.has(context))) return false;
      if (!matchesValue(filters.shotCreations, facets.creation)) return false;
    }
    return true;
  }

  function addPlayerOption(select, player) {
    const option = documentObject.createElement('option');
    option.value = player.id;
    option.textContent = playerLabel(player);
    select.appendChild(option);
  }

  function lineupForEditor(event) {
    return getLineupAtEventPosition(game, editingSeconds, event.sequence, event.id);
  }

  function populatePlayers(event, preferredPlayerId = event.playerId) {
    playerInput.innerHTML = '<option value="">Select player</option>';
    const byId = Object.fromEntries(game.players.map(player => [player.id, player]));
    for (const playerId of lineupForEditor(event)) {
      addPlayerOption(playerInput, byId[playerId]);
    }
    playerInput.value = preferredPlayerId || '';
    playerInput.disabled = sideInput.value === 'opponent';
  }

  function populateSubstitutionPlayers(event, preferredOutId = event.playerOutId, preferredInId = event.playerInId) {
    const activeIds = new Set(lineupForEditor(event));
    playerOutInput.innerHTML = '<option value="">Select player</option>';
    playerInInput.innerHTML = '<option value="">Select player</option>';
    for (const player of game.players) {
      addPlayerOption(activeIds.has(player.id) ? playerOutInput : playerInInput, player);
    }
    playerOutInput.value = preferredOutId || '';
    playerInInput.value = preferredInId || '';
  }

  function refreshEditorLineupOptions() {
    const event = game.events.find(item => item.id === editingEventId);
    if (!event) return;
    if (event.type === 'substitution') {
      populateSubstitutionPlayers(event, playerOutInput.value || event.playerOutId, playerInInput.value || event.playerInId);
    } else if (!['timeout', 'period_end', 'note'].includes(event.type)) {
      populatePlayers(event, playerInput.value || event.playerId);
    }
  }

  function openEditor(event) {
    if (!EDITABLE_TYPES.has(event.type)) return;
    editingEventId = event.id;
    editingSeconds = event.videoSeconds;
    sideInput.value = event.side;
    typeInput.value = event.type;
    const isSubstitution = event.type === 'substitution';
    const isTimeout = event.type === 'timeout';
    const isPeriodEnd = event.type === 'period_end';
    const isNote = event.type === 'note';
    const isSpecial = isSubstitution || isTimeout || isPeriodEnd || isNote;
    typeInput.disabled = isSpecial;
    for (const option of typeInput.options) {
      option.disabled = ['substitution', 'timeout', 'period_end', 'note'].includes(option.value)
        && option.value !== event.type;
    }
    sideInput.disabled = isSubstitution || isPeriodEnd || isNote;
    playerInput.disabled = isSpecial || event.side === 'opponent';
    if (isSubstitution) populateSubstitutionPlayers(event);
    else if (!isSpecial) populatePlayers(event);
    else playerInput.innerHTML = '<option value="">Not applicable</option>';
    shotValueInput.value = String(event.shotValue || 2);
    shotMadeInput.value = String(event.made ?? true);
    shotDetailsEditor.setShotValue(event.shotValue || 2);
    shotDetailsEditor.setDetails(event.shotDetails || null);
    reboundKindInput.value = event.reboundKind || 'defensive';
    periodLabelInput.value = event.periodLabel || '';
    noteInput.value = event.note || '';
    timestampDisplay.textContent = formatVideoTime(editingSeconds);
    updateDependentFields();
    setEditError();
    dialog.showModal();
  }

  function voiceOption(value, label, selected) {
    const option = documentObject.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = selected;
    return option;
  }

  function voiceAction(label, action, className = 'secondary small') {
    const button = documentObject.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.voiceAction = action;
    button.textContent = label;
    return button;
  }

  function renderVoiceDraftEvent(command, event, index, players) {
    const fieldset = documentObject.createElement('fieldset');
    fieldset.className = 'voice-proposal-event';
    fieldset.dataset.voiceEventIndex = String(index);
    const legend = documentObject.createElement('legend');
    legend.textContent = `Event ${index + 1} · ${Math.round(event.confidence * 100)}% confidence`;
    fieldset.append(legend);

    const grid = documentObject.createElement('div');
    grid.className = 'voice-proposal-grid';
    const addSelect = (labelText, field, options, disabled = false) => {
      const label = documentObject.createElement('label');
      label.textContent = labelText;
      const select = documentObject.createElement('select');
      select.dataset.voiceField = field;
      select.disabled = disabled;
      select.append(...options);
      label.append(select);
      grid.append(label);
    };

    if (event.type === 'substitution') {
      const activeIds = new Set(command.currentLineupIds || []);
      addSelect('Player out', 'playerOutId', [
        voiceOption('', 'Select player', !event.playerOutId),
        ...players
          .filter(player => activeIds.has(player.id))
          .map(player => voiceOption(
            player.id,
            player.number ? `#${player.number} ${player.name}` : player.name,
            event.playerOutId === player.id
          ))
      ]);
      addSelect('Player in', 'playerInId', [
        voiceOption('', 'Select player', !event.playerInId),
        ...players
          .filter(player => !activeIds.has(player.id))
          .map(player => voiceOption(
            player.id,
            player.number ? `#${player.number} ${player.name}` : player.name,
            event.playerInId === player.id
          ))
      ]);
      const remove = voiceAction(
        'Remove event',
        'remove-event',
        'danger small voice-remove-event'
      );
      remove.dataset.voiceEventIndex = String(index);
      grid.append(remove);
      fieldset.append(grid);
      return fieldset;
    }

    addSelect('Side', 'side', [
      voiceOption('team', 'Our team', event.side === 'team'),
      voiceOption('opponent', 'Opponent', event.side === 'opponent')
    ]);
    addSelect('Player', 'playerId', [
      voiceOption(
        '',
        event.type === 'timeout' ? 'Not applicable' : 'Select player',
        !event.playerId
      ),
      ...players.map(player => voiceOption(
        player.id,
        player.number ? `#${player.number} ${player.name}` : player.name,
        event.playerId === player.id
      ))
    ], event.side === 'opponent' || event.type === 'timeout');
    addSelect('Event', 'type', editableEventTypes().map(type => voiceOption(
      type,
      type.replace('_', ' '),
      event.type === type
    )));

    if (event.type === 'shot') {
      addSelect('Shot value', 'shotValue', [1, 2, 3].map(value => voiceOption(
        String(value),
        `${value} point`,
        event.shotValue === value
      )));
      addSelect('Result', 'made', [
        voiceOption('true', 'Made', event.made === true),
        voiceOption('false', 'Missed', event.made === false)
      ]);
    } else if (event.type === 'rebound') {
      addSelect('Rebound', 'reboundKind', [
        voiceOption('offensive', 'Offensive', event.reboundKind === 'offensive'),
        voiceOption('defensive', 'Defensive', event.reboundKind === 'defensive')
      ]);
    }

    const remove = voiceAction('Remove event', 'remove-event', 'danger small voice-remove-event');
    remove.dataset.voiceEventIndex = String(index);
    grid.append(remove);
    fieldset.append(grid);
    return fieldset;
  }

  function renderVoiceDraftSummary(command, players) {
    const playersById = Object.fromEntries(players.map(player => [
      player.id,
      {
        ...player,
        name: player.number ? `#${player.number} ${player.name}` : player.name
      }
    ]));
    const summary = documentObject.createElement('ul');
    summary.className = 'voice-command-event-summary';
    const visibleEvents = command.events.slice(0, 3);
    visibleEvents.forEach(event => {
      const item = documentObject.createElement('li');
      item.className = 'voice-command-event-summary-item';
      const description = documentObject.createElement('span');
      description.textContent = describeEvent(event, playersById);
      const confidence = documentObject.createElement('span');
      confidence.className = 'voice-command-event-confidence';
      confidence.textContent = `${Math.round(event.confidence * 100)}%`;
      item.append(description, confidence);
      summary.append(item);
    });
    if (command.events.length > visibleEvents.length) {
      const more = documentObject.createElement('li');
      more.className = 'voice-command-event-more';
      more.textContent = `+${command.events.length - visibleEvents.length} more`;
      summary.append(more);
    }
    return summary;
  }

  function renderVoiceCommand(command, players) {
    const item = documentObject.createElement('li');
    item.className = `event-list-item voice-command-item voice-command-${command.state}`;
    item.dataset.voiceCommandId = command.id;

    const time = documentObject.createElement('button');
    time.type = 'button';
    time.className = 'event-time link-button voice-command-time';
    time.dataset.action = 'play-voice-command';
    time.setAttribute('aria-label', `Play video around ${formatVideoTime(command.capturedSeconds)}`);
    time.textContent = formatVideoTime(command.capturedSeconds);
    const content = documentObject.createElement('div');
    content.className = 'voice-command-content';
    const heading = documentObject.createElement('div');
    heading.className = 'voice-command-heading';
    const title = documentObject.createElement('strong');
    const stateLabels = {
      queued: 'Voice command queued',
      processing: 'Voice command is processing',
      cancelling: 'Cancelling voice command',
      rerecording: 'Rerecording voice command',
      draft: `${command.events.length} voice event${command.events.length === 1 ? '' : 's'} ready`,
      committing: 'Adding voice events',
      error: 'Voice command needs attention'
    };
    title.textContent = stateLabels[command.state] || 'Voice command';
    if (['queued', 'processing', 'cancelling', 'rerecording', 'committing'].includes(command.state)) {
      const spinner = documentObject.createElement('span');
      spinner.className = 'voice-command-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      heading.append(spinner);
    }
    heading.append(title);
    if (command.state === 'draft') {
      const confirm = voiceAction('Accept', 'confirm', 'primary small voice-command-accept');
      confirm.disabled = !command.events.length;
      heading.append(confirm);
    }
    content.append(heading);

    if (command.errorMessage) {
      const error = documentObject.createElement('p');
      error.className = 'message error';
      error.textContent = command.errorMessage;
      content.append(error);
    } else if (command.transcript) {
      const transcript = documentObject.createElement('p');
      transcript.className = 'voice-command-transcript';
      transcript.textContent = command.transcript;
      content.append(transcript);
    }

    if (command.state === 'draft') {
      content.append(renderVoiceDraftSummary(command, players));
    }

    if (command.state === 'draft' || (command.state === 'error' && command.audioUrl)) {
      const details = documentObject.createElement('details');
      details.className = 'voice-command-details';
      details.open = expandedVoiceCommandIds.has(command.id)
        || (command.state === 'draft' && Boolean(command.errorMessage));
      const summary = documentObject.createElement('summary');
      summary.textContent = command.state === 'draft' ? 'Edit voice events' : 'Recording details';
      details.append(summary);
      details.addEventListener('toggle', () => {
        if (details.open) expandedVoiceCommandIds.add(command.id);
        else expandedVoiceCommandIds.delete(command.id);
      });
      if (command.audioUrl) {
        const audio = documentObject.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.src = command.audioUrl;
        audio.className = 'voice-recording-preview';
        details.append(audio);
      }
      if (command.transcript) {
        const original = documentObject.createElement('label');
        original.className = 'voice-transcript-label';
        original.textContent = 'Transcript';
        const textarea = documentObject.createElement('textarea');
        textarea.rows = 2;
        textarea.readOnly = true;
        textarea.value = command.transcript;
        original.append(textarea);
        details.append(original);
      }
      if (command.canSaveEvaluation) {
        const expected = documentObject.createElement('label');
        expected.className = 'voice-transcript-label';
        expected.textContent = 'Expected transcript for evaluation';
        const textarea = documentObject.createElement('textarea');
        textarea.rows = 2;
        textarea.value = command.expectedTranscript || '';
        textarea.dataset.voiceField = 'expectedTranscript';
        expected.append(textarea);
        details.append(expected);
      }
      if (command.warnings?.length) {
        const warnings = documentObject.createElement('ul');
        warnings.className = 'voice-warnings';
        for (const warning of command.warnings) {
          const warningItem = documentObject.createElement('li');
          warningItem.textContent = warning;
          warnings.append(warningItem);
        }
        details.append(warnings);
      }
      if (command.diagnostics) {
        const diagnostics = documentObject.createElement('p');
        diagnostics.className = 'message';
        diagnostics.textContent = command.diagnostics;
        details.append(diagnostics);
      }
      if (command.state === 'draft') {
        const proposals = documentObject.createElement('div');
        proposals.className = 'voice-proposal-events';
        command.events.forEach((event, index) => {
          proposals.append(renderVoiceDraftEvent(command, event, index, players));
        });
        details.append(proposals);
        const editActions = documentObject.createElement('div');
        editActions.className = 'voice-command-actions voice-command-edit-actions';
        editActions.append(
          voiceAction('Rerecord', 'rerecord'),
          voiceAction('Use current time', 'replace-timestamp'),
          voiceAction('Retry', 'retry'),
          voiceAction('Discard', 'discard', 'danger small')
        );
        if (command.canSaveEvaluation) {
          editActions.append(voiceAction('Save sample', 'save-evaluation'));
        }
        details.append(editActions);
      }
      if (command.state === 'error') {
        const recordingActions = documentObject.createElement('div');
        recordingActions.className = 'voice-command-actions voice-command-edit-actions';
        recordingActions.append(voiceAction('Rerecord', 'rerecord'));
        details.append(recordingActions);
      }
      if (command.evaluationStatus) {
        const status = documentObject.createElement('p');
        status.className = `message voice-status ${command.evaluationStatusKind || ''}`.trim();
        status.textContent = command.evaluationStatus;
        details.append(status);
      }
      content.append(details);
    }

    const actions = documentObject.createElement('div');
    actions.className = 'voice-command-actions';
    if (command.state === 'queued') {
      actions.append(voiceAction('Discard', 'discard', 'danger small'));
    } else if (command.state === 'processing') {
      actions.append(voiceAction('Cancel', 'cancel'));
    } else if (command.state === 'rerecording') {
      actions.append(voiceAction('Stop rerecording', 'stop-rerecord', 'primary small'));
    } else if (command.state === 'error') {
      actions.append(
        voiceAction('Retry', 'retry', 'primary small'),
        voiceAction('Discard', 'discard', 'danger small')
      );
      if (command.canSaveEvaluation) {
        actions.append(voiceAction('Save sample', 'save-evaluation'));
      }
    }
    if (actions.childElementCount) content.append(actions);
    item.append(time, content);
    return item;
  }

  function render(nextGame) {
    game = nextGame;
    eventList.innerHTML = '';
    eventSummaries = new Map();
    populateFilterPlayers();
    updateFilterButton();
    updateActiveFilterChips();
    updateOrderControl();
    if (!game) {
      closeQuickTimestampActions();
      emptyEvents.textContent = 'No events recorded.';
      emptyEvents.classList.remove('hidden');
      return;
    }
    copyFilteredReviewStatus.textContent = '';
    copyFilteredReviewStatus.classList.remove('error');
    onFiltersChanged(getFilterState());
    const playersById = Object.fromEntries(game.players.map(player => [player.id, player]));
    const orderedEvents = orderGameEvents(game.events);
    const scoreByEventId = new Map();
    const score = { team: 0, opponent: 0 };
    for (const event of orderedEvents) {
      if (event.type !== 'shot' || !event.made) continue;
      score[event.side] += event.shotValue;
      scoreByEventId.set(event.id, { ...score });
    }
    for (const event of orderedEvents) {
      eventSummaries.set(
        event.id,
        `${formatVideoTime(event.videoSeconds)} · ${describeEvent(event, playersById, scoreByEventId.get(event.id))}`
      );
    }
    updateMobileTimelinePreview();
    const visibleEvents = orderedEvents.filter(eventMatchesFilters);
    const timelineItems = [
      ...visibleEvents.map(event => ({
        kind: 'event',
        videoSeconds: event.videoSeconds,
        order: event.sequence,
        value: event
      })),
      ...voiceCommands.map(command => ({
        kind: 'voice',
        videoSeconds: command.capturedSeconds,
        order: Number.MAX_SAFE_INTEGER - 1000 + command.order,
        value: command
      }))
    ].sort((a, b) => a.videoSeconds - b.videoSeconds || a.order - b.order);
    if (!earliestFirst) timelineItems.reverse();
    emptyEvents.textContent = (game.events.length || voiceCommands.length) && !timelineItems.length
      ? 'No events match the current filters.'
      : 'No events recorded.';
    emptyEvents.classList.toggle('hidden', timelineItems.length > 0);
    for (const timelineItem of timelineItems) {
      if (timelineItem.kind === 'voice') {
        eventList.append(renderVoiceCommand(timelineItem.value, game.players));
        continue;
      }
      const event = timelineItem.value;
      const item = eventTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.eventId = event.id;
      item.classList.toggle('voice-added-event', highlightedEventIds.has(event.id));
      item.querySelector('.event-time').textContent = formatVideoTime(event.videoSeconds);
      const description = describeEvent(event, playersById, scoreByEventId.get(event.id));
      const descriptionElement = item.querySelector('.event-description');
      descriptionElement.textContent = description;
      descriptionElement.title = description;
      if (!readOnly) {
        const descriptionButton = documentObject.createElement('button');
        descriptionButton.type = 'button';
        descriptionButton.className = 'event-description event-description-button';
        descriptionButton.dataset.action = 'open-time-actions';
        descriptionButton.setAttribute('aria-haspopup', 'menu');
        descriptionButton.setAttribute('aria-expanded', 'false');
        descriptionButton.textContent = description;
        descriptionButton.title = `${description} · Adjust timestamp`;
        descriptionElement.replaceWith(descriptionButton);
      }
      const detailBadges = item.querySelector('.event-detail-badges');
      const badges = getShotDetailBadges(event);
      for (const badge of badges) {
        if (detailBadges.childElementCount) {
          detailBadges.append(documentObject.createTextNode(' · '));
        }
        const badgeItem = documentObject.createElement('span');
        badgeItem.className = 'event-detail-badge';
        badgeItem.dataset.shotDetailKind = badge.kind;
        badgeItem.dataset.value = badge.value;
        badgeItem.textContent = badge.label;
        detailBadges.appendChild(badgeItem);
      }
      detailBadges.classList.toggle('hidden', !badges.length);
      const comment = String(event.coachComment || '').trim();
      const commentBlock = item.querySelector('.coach-comment');
      item.classList.toggle('has-comment', !!comment);
      commentBlock.textContent = comment;
      commentBlock.classList.toggle('hidden', !comment);
      if (readOnly) {
        item.querySelector('.event-row-actions').remove();
        eventList.appendChild(item);
        continue;
      }
      const commentButton = item.querySelector('[data-action="comment-event"]');
      const commentLabel = comment ? 'Edit coach comment' : 'Add coach comment';
      commentButton.setAttribute('aria-label', commentLabel);
      commentButton.title = commentLabel;
      item.querySelector('[data-action="edit-event"]').disabled = !EDITABLE_TYPES.has(event.type);
      eventList.appendChild(item);
    }
    restoreQuickTimestampActions();
  }

  async function commit(nextGame) {
    if (readOnly) throw new Error('Review view cannot modify game data.');
    await saveGame(nextGame);
    game = nextGame;
  }

  eventList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button || !game || busy) return;
    if (button.dataset.action === 'play-voice-command') {
      const voiceRow = button.closest('[data-voice-command-id]');
      const command = voiceCommands.find(item => item.id === voiceRow?.dataset.voiceCommandId);
      if (!command) return;
      setPlaybackFollowing(true);
      videoController.seekTo(Math.max(0, command.capturedSeconds - PREVIEW_SECONDS));
      videoController.play();
      return;
    }
    const row = event.target.closest('[data-event-id]');
    if (!row) return;
    const selected = game.events.find(item => item.id === row.dataset.eventId);
    if (!selected) return;
    try {
      if (button.dataset.action === 'open-time-actions') {
        openQuickTimestampActions(selected.id, button);
      } else if (button.dataset.action === 'play-event') {
        setPlaybackFollowing(true);
        videoController.seekTo(Math.max(0, selected.videoSeconds - PREVIEW_SECONDS));
        videoController.play();
      } else if (readOnly) {
        return;
      } else if (button.dataset.action === 'comment-event') {
        openCommentEditor(selected);
      } else if (button.dataset.action === 'edit-event') {
        openEditor(selected);
      } else if (button.dataset.action === 'delete-event' && confirmFn('Delete this event?')) {
        busy = true;
        const next = structuredClone(game);
        next.events = next.events.filter(item => item.id !== selected.id);
        next.updatedAt = now();
        await commit(next);
      }
    } catch (error) {
      onError(error);
    } finally {
      busy = false;
    }
  });
  quickTimestampEarlier?.addEventListener('click', () => adjustQuickTimestamp(-1));
  quickTimestampLater?.addEventListener('click', () => adjustQuickTimestamp(1));
  if (quickTimestampActions) {
    documentObject.addEventListener('click', handleQuickTimestampDocumentClick);
    documentObject.addEventListener('keydown', handleQuickTimestampKeydown);
    documentObject.defaultView.addEventListener('resize', scheduleQuickTimestampPosition);
    documentObject.addEventListener('scroll', scheduleQuickTimestampPosition, true);
  }
  activeFilters.addEventListener('click', event => {
    const chip = event.target.closest('.filter-chip');
    if (!chip) return;
    const { filterGroup: group, filterValue: value } = chip.dataset;
    if (group === 'teamMention') filters.teamMention = false;
    else if (group === 'comment') filters.comment = 'any';
    else filters[group]?.delete(value);
    render(game);
  });
  const mobileTimelineMedia = documentObject.defaultView.matchMedia('(max-width: 760px)');
  function handleMobileTimelineToggle() {
    if (Date.now() < suppressMobileTimelineClickUntil) {
      suppressMobileTimelineClickUntil = 0;
      return;
    }
    setMobileTimelineOpen(!mobileTimelineOpen);
  }
  function handleMobileTimelinePointerDown(event) {
    if (!readOnly || event.button !== 0) return;
    mobileTimelinePointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    mobileTimelineToggle.setPointerCapture(event.pointerId);
  }
  function handleMobileTimelinePointerUp(event) {
    if (!mobileTimelinePointer || mobileTimelinePointer.id !== event.pointerId) return;
    const deltaX = event.clientX - mobileTimelinePointer.x;
    const deltaY = event.clientY - mobileTimelinePointer.y;
    mobileTimelinePointer = null;
    if (mobileTimelineToggle.hasPointerCapture(event.pointerId)) {
      mobileTimelineToggle.releasePointerCapture(event.pointerId);
    }
    if (Math.abs(deltaY) < 45 || Math.abs(deltaY) <= Math.abs(deltaX)) return;
    suppressMobileTimelineClickUntil = Date.now() + 500;
    setMobileTimelineOpen(deltaY < 0);
  }
  function handleMobileTimelinePointerCancel() {
    mobileTimelinePointer = null;
  }
  function handleMobileTimelineKeydown(event) {
    if (event.key === 'Escape' && mobileTimelineOpen) {
      setMobileTimelineOpen(false);
      mobileTimelineToggle.focus();
    }
  }
  function handleMobileTimelineBackdrop() {
    setMobileTimelineOpen(false);
  }
  if (readOnly) {
    mobileTimelineToggle.addEventListener('click', handleMobileTimelineToggle);
    mobileTimelineToggle.addEventListener('pointerdown', handleMobileTimelinePointerDown);
    mobileTimelineToggle.addEventListener('pointerup', handleMobileTimelinePointerUp);
    mobileTimelineToggle.addEventListener('pointercancel', handleMobileTimelinePointerCancel);
    mobileTimelineBackdrop.addEventListener('click', handleMobileTimelineBackdrop);
    documentObject.addEventListener('keydown', handleMobileTimelineKeydown);
    mobileTimelineMedia.addEventListener('change', syncMobileTimelineMode);
    syncMobileTimelineMode();
  }

  copyFilteredReviewLink.addEventListener('click', async () => {
    copyFilteredReviewStatus.textContent = '';
    copyFilteredReviewStatus.classList.remove('error');
    try {
      const clipboard = documentObject.defaultView?.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await clipboard.writeText(documentObject.defaultView.location.href);
      copyFilteredReviewStatus.textContent = 'Filtered link copied.';
    } catch (error) {
      copyFilteredReviewStatus.textContent = error.message || 'Could not copy the filtered link.';
      copyFilteredReviewStatus.classList.add('error');
    }
  });

  if (!readOnly) {
    sideInput.addEventListener('change', () => {
      playerInput.disabled = sideInput.value === 'opponent';
      if (sideInput.value === 'opponent') playerInput.value = '';
    });
    typeInput.addEventListener('change', updateDependentFields);
    shotValueInput.addEventListener('change', updateDependentFields);
    cancelButton.addEventListener('click', () => dialog.close());
  }
  orderButton.addEventListener('click', () => {
    earliestFirst = !earliestFirst;
    render(game);
  });
  if (followPlayback) {
    followPlaybackButton.addEventListener('click', () => {
      if (timelineScrollsPage()) {
        updatePlaybackPosition(videoController.getCurrentSeconds(), {
          forceScroll: true,
          allowPageScroll: true
        });
        return;
      }
      setPlaybackFollowing(true);
      updatePlaybackPosition(videoController.getCurrentSeconds(), { forceScroll: true });
    });
    timelineScrollContainer.addEventListener('wheel', pausePlaybackFollowing, { passive: true });
    timelineScrollContainer.addEventListener('touchstart', pausePlaybackFollowing, { passive: true });
    timelineScrollContainer.addEventListener('scroll', handleTimelineScroll, { passive: true });
  }
  filterButton.addEventListener('click', () => {
    syncFilterForm();
    filterDialog.showModal();
  });
  filterForm.addEventListener('change', event => {
    if (event.target.matches('input[name^="filterShot"]')) updateShotFilterSummary();
  });
  cancelFilters.addEventListener('click', () => filterDialog.close());
  clearFilters.addEventListener('click', () => {
    filters = createFilterState();
    syncFilterForm();
    render(game);
  });
  filterForm.addEventListener('submit', event => {
    event.preventDefault();
    filters = {
      sides: checkedValues('filterSide'),
      types: checkedValues('filterType'),
      players: checkedValues('filterPlayer'),
      teamMention: filterTeamMention.checked,
      comment: filterForm.querySelector('input[name="filterComment"]:checked')?.value || 'any',
      shotZones: checkedValues('filterShotZone'),
      shotPressures: checkedValues('filterShotPressure'),
      shotPhases: checkedValues('filterShotPhase'),
      shotContexts: checkedValues('filterShotContext'),
      shotCreations: checkedValues('filterShotCreation')
    };
    filterDialog.close();
    render(game);
  });
  if (!readOnly) {
    cancelComment.addEventListener('click', () => commentDialog.close());
    commentForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!game || !commentEventId || busy) return;
      setCommentError();
      busy = true;
      try {
        const value = commentText.value.trim();
        if (!value) throw new Error('Enter a coach comment.');
        const next = structuredClone(game);
        const commented = next.events.find(item => item.id === commentEventId);
        commented.coachComment = value;
        commented.updatedAt = now();
        next.updatedAt = now();
        await commit(next);
        commentDialog.close();
      } catch (error) {
        setCommentError(error.message || 'Could not save the coach comment.');
      } finally {
        busy = false;
      }
    });
    removeComment.addEventListener('click', async () => {
      if (!game || !commentEventId || busy) return;
      setCommentError();
      busy = true;
      try {
        const next = structuredClone(game);
        const commented = next.events.find(item => item.id === commentEventId);
        delete commented.coachComment;
        commented.updatedAt = now();
        next.updatedAt = now();
        await commit(next);
        commentDialog.close();
      } catch (error) {
        setCommentError(error.message || 'Could not remove the coach comment.');
      } finally {
        busy = false;
      }
    });
    dialog.querySelectorAll('[data-time-adjust]').forEach(button => button.addEventListener('click', () => {
      editingSeconds = Math.max(0, editingSeconds + Number(button.dataset.timeAdjust));
      timestampDisplay.textContent = formatVideoTime(editingSeconds);
      refreshEditorLineupOptions();
    }));
    useCurrentButton.addEventListener('click', () => {
      try {
        editingSeconds = videoController.getCurrentSeconds();
        timestampDisplay.textContent = formatVideoTime(editingSeconds);
        refreshEditorLineupOptions();
        setEditError();
      } catch (error) {
        setEditError(error.message);
      }
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!game || !editingEventId || busy) return;
      setEditError();
      busy = true;
      try {
        const next = structuredClone(game);
        const edited = next.events.find(item => item.id === editingEventId);
        const shotDetails = shotDetailsEditor.getDetails();
        const remainsFieldGoal = typeInput.value === 'shot' && ['2', '3'].includes(shotValueInput.value);
        if (shotDetails && !remainsFieldGoal
          && !confirmFn('Changing this event will remove its shot details. Continue?')) {
          return;
        }
        edited.videoSeconds = editingSeconds;
        edited.updatedAt = now();
        delete edited.shotValue;
        delete edited.made;
        delete edited.shotDetails;
        delete edited.reboundKind;
        delete edited.playerOutId;
        delete edited.playerInId;
        delete edited.periodLabel;
        delete edited.note;
        if (typeInput.value === 'substitution') {
          edited.side = 'team';
          edited.type = 'substitution';
          edited.playerId = null;
          edited.playerOutId = playerOutInput.value;
          edited.playerInId = playerInInput.value;
          if (!edited.playerOutId || !edited.playerInId) {
            throw new Error('Select one on-court player and one bench player.');
          }
        } else if (typeInput.value === 'timeout') {
          edited.side = sideInput.value;
          edited.type = 'timeout';
          edited.playerId = null;
        } else if (typeInput.value === 'period_end') {
          edited.side = 'system';
          edited.type = 'period_end';
          edited.playerId = null;
          edited.periodLabel = periodLabelInput.value.trim();
          if (!edited.periodLabel) throw new Error('Enter a period label.');
        } else if (typeInput.value === 'note') {
          edited.side = 'system';
          edited.type = 'note';
          edited.playerId = null;
          edited.note = noteInput.value.trim();
          if (!edited.note) throw new Error('Enter note text.');
        } else {
          edited.side = sideInput.value;
          edited.playerId = edited.side === 'team' ? playerInput.value : null;
          if (edited.side === 'team' && !edited.playerId) throw new Error('Select one of our on-court players.');
          edited.type = typeInput.value;
          if (edited.type === 'shot') {
            let shotValue = Number(shotValueInput.value);
            if ([2, 3].includes(shotValue) && shotDetails?.location) {
              const expectedShotValue = getConfidentExpectedShotValue(shotDetails.location);
              if (expectedShotValue && expectedShotValue !== shotValue
                && confirmFn(`This location is in the ${expectedShotValue}PT area, but the event is recorded as ${shotValue}PT. Change the event to ${expectedShotValue}PT?`)) {
                shotValue = expectedShotValue;
                shotValueInput.value = String(shotValue);
              }
            }
            edited.shotValue = shotValue;
            edited.made = shotMadeInput.value === 'true';
            if ([2, 3].includes(shotValue) && shotDetails) edited.shotDetails = shotDetails;
          } else if (edited.type === 'rebound') {
            edited.reboundKind = reboundKindInput.value;
          }
        }
        next.updatedAt = now();
        await commit(next);
        dialog.close();
      } catch (error) {
        setEditError(error.message || 'Could not save the correction.');
      } finally {
        busy = false;
      }
    });
  }

  setPlaybackFollowing(true);
  const unsubscribeTime = followPlayback
    ? videoController.subscribeTime(seconds => updatePlaybackPosition(seconds))
    : () => {};

  return {
    render,
    getFilters: getFilterState,
    setVoiceCommands(commands) {
      voiceCommands = structuredClone(commands);
      const commandIds = new Set(voiceCommands.map(command => command.id));
      for (const commandId of expandedVoiceCommandIds) {
        if (!commandIds.has(commandId)) expandedVoiceCommandIds.delete(commandId);
      }
      render(game);
    },
    highlightEvents(eventIds) {
      highlightedEventIds = new Set(eventIds);
      for (const item of eventList.querySelectorAll('[data-event-id]')) {
        item.classList.toggle('voice-added-event', highlightedEventIds.has(item.dataset.eventId));
      }
    },
    clearHighlightedEvents() {
      highlightedEventIds.clear();
      eventList.querySelectorAll('.voice-added-event').forEach(item => {
        item.classList.remove('voice-added-event');
      });
    },
    destroy() {
      if (quickTimestampActions) {
        documentObject.removeEventListener('click', handleQuickTimestampDocumentClick);
        documentObject.removeEventListener('keydown', handleQuickTimestampKeydown);
        documentObject.defaultView.removeEventListener('resize', scheduleQuickTimestampPosition);
        documentObject.removeEventListener('scroll', scheduleQuickTimestampPosition, true);
        if (quickTimestampPositionFrame !== null) {
          documentObject.defaultView.cancelAnimationFrame(quickTimestampPositionFrame);
        }
      }
      quickTimestampActions?.remove();
      unsubscribeTime();
      shotDetailsEditor?.destroy();
      if (!followPlayback) return;
      timelineScrollContainer.removeEventListener('wheel', pausePlaybackFollowing);
      timelineScrollContainer.removeEventListener('touchstart', pausePlaybackFollowing);
      timelineScrollContainer.removeEventListener('scroll', handleTimelineScroll);
      if (!readOnly) return;
      mobileTimelineToggle.removeEventListener('click', handleMobileTimelineToggle);
      mobileTimelineToggle.removeEventListener('pointerdown', handleMobileTimelinePointerDown);
      mobileTimelineToggle.removeEventListener('pointerup', handleMobileTimelinePointerUp);
      mobileTimelineToggle.removeEventListener('pointercancel', handleMobileTimelinePointerCancel);
      mobileTimelineBackdrop.removeEventListener('click', handleMobileTimelineBackdrop);
      documentObject.removeEventListener('keydown', handleMobileTimelineKeydown);
      mobileTimelineMedia.removeEventListener('change', syncMobileTimelineMode);
      mobileTimelineContent.inert = false;
      documentObject.body.classList.remove('mobile-timeline-sheet-open');
    }
  };
}
