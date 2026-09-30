import {
  getLineupAtEventPosition,
  orderGameEvents
} from './game-model.js';
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

export function describeEvent(event, playersById) {
  const subject = event.side === 'opponent'
    ? 'Opponent'
    : playersById[event.playerId]?.name || 'Our team';
  if (event.type === 'shot') {
    const shot = event.shotValue === 1 ? 'FT' : `${event.shotValue}PT`;
    return `${subject} ${event.made ? 'made' : 'missed'} ${shot}`;
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

  let game = null;
  let editingEventId = null;
  let commentEventId = null;
  let editingSeconds = 0;
  let busy = false;
  let earliestFirst = false;
  let filters = {
    sides: new Set(),
    types: new Set(),
    players: new Set(),
    teamMention: false,
    comment: 'any'
  };

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
      + Number(filters.comment !== 'any');
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

  function populateFilterPlayers() {
    filterPlayers.innerHTML = '';
    const validPlayerIds = new Set((game?.players || []).map(player => player.id));
    filters.players = new Set([...filters.players].filter(playerId => validPlayerIds.has(playerId)));
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
    populateFilterPlayers();
    filterTeamMention.checked = filters.teamMention;
    const comment = filterForm.querySelector(`input[name="filterComment"][value="${filters.comment}"]`);
    if (comment) comment.checked = true;
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
    reboundKindInput.value = event.reboundKind || 'defensive';
    periodLabelInput.value = event.periodLabel || '';
    noteInput.value = event.note || '';
    timestampDisplay.textContent = formatVideoTime(editingSeconds);
    updateDependentFields();
    setEditError();
    dialog.showModal();
  }

  function render(nextGame) {
    game = nextGame;
    eventList.innerHTML = '';
    populateFilterPlayers();
    updateFilterButton();
    updateOrderControl();
    if (!game) {
      emptyEvents.textContent = 'No events recorded.';
      emptyEvents.classList.remove('hidden');
      return;
    }
    const playersById = Object.fromEntries(game.players.map(player => [player.id, player]));
    const orderedEvents = orderGameEvents(game.events);
    const events = (earliestFirst ? orderedEvents : orderedEvents.reverse()).filter(eventMatchesFilters);
    emptyEvents.textContent = game.events.length && !events.length
      ? 'No events match the current filters.'
      : 'No events recorded.';
    emptyEvents.classList.toggle('hidden', events.length > 0);
    for (const event of events) {
      const item = eventTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.eventId = event.id;
      item.querySelector('.event-time').textContent = formatVideoTime(event.videoSeconds);
      const description = describeEvent(event, playersById);
      item.querySelector('.event-description').textContent = description;
      item.querySelector('.event-description').title = description;
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
  }

  async function commit(nextGame) {
    if (readOnly) throw new Error('Review view cannot modify game data.');
    await saveGame(nextGame);
    game = nextGame;
  }

  eventList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    const row = event.target.closest('[data-event-id]');
    if (!button || !row || !game || busy) return;
    const selected = game.events.find(item => item.id === row.dataset.eventId);
    if (!selected) return;
    try {
      if (button.dataset.action === 'play-event') {
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

  if (!readOnly) {
    sideInput.addEventListener('change', () => {
      playerInput.disabled = sideInput.value === 'opponent';
      if (sideInput.value === 'opponent') playerInput.value = '';
    });
    typeInput.addEventListener('change', updateDependentFields);
    cancelButton.addEventListener('click', () => dialog.close());
  }
  orderButton.addEventListener('click', () => {
    earliestFirst = !earliestFirst;
    render(game);
  });
  filterButton.addEventListener('click', () => {
    syncFilterForm();
    filterDialog.showModal();
  });
  cancelFilters.addEventListener('click', () => filterDialog.close());
  clearFilters.addEventListener('click', () => {
    filters = {
      sides: new Set(),
      types: new Set(),
      players: new Set(),
      teamMention: false,
      comment: 'any'
    };
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
      comment: filterForm.querySelector('input[name="filterComment"]:checked')?.value || 'any'
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
        edited.videoSeconds = editingSeconds;
        edited.updatedAt = now();
        delete edited.shotValue;
        delete edited.made;
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
            edited.shotValue = Number(shotValueInput.value);
            edited.made = shotMadeInput.value === 'true';
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

  return { render };
}
