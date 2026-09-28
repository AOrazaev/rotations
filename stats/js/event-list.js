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
  'period_end'
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
  const timestampDisplay = documentObject.querySelector('#editEventTimestamp');
  const useCurrentButton = documentObject.querySelector('#useCurrentEventTime');
  const editError = documentObject.querySelector('#eventEditError');

  let game = null;
  let editingEventId = null;
  let editingSeconds = 0;
  let busy = false;

  function setEditError(message = '') {
    editError.textContent = message;
    editError.classList.toggle('hidden', !message);
  }

  function updateDependentFields() {
    shotFields.classList.toggle('hidden', typeInput.value !== 'shot');
    reboundFields.classList.toggle('hidden', typeInput.value !== 'rebound');
    substitutionFields.classList.toggle('hidden', typeInput.value !== 'substitution');
    periodEndFields.classList.toggle('hidden', typeInput.value !== 'period_end');
  }

  function playerLabel(player) {
    return player.number ? `#${player.number} ${player.name}` : player.name;
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
    } else if (!['timeout', 'period_end'].includes(event.type)) {
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
    const isSpecial = isSubstitution || isTimeout || isPeriodEnd;
    typeInput.disabled = isSpecial;
    for (const option of typeInput.options) {
      option.disabled = ['substitution', 'timeout', 'period_end'].includes(option.value)
        && option.value !== event.type;
    }
    sideInput.disabled = isSubstitution || isPeriodEnd;
    playerInput.disabled = isSpecial || event.side === 'opponent';
    if (isSubstitution) populateSubstitutionPlayers(event);
    else if (!isSpecial) populatePlayers(event);
    else playerInput.innerHTML = '<option value="">Not applicable</option>';
    shotValueInput.value = String(event.shotValue || 2);
    shotMadeInput.value = String(event.made ?? true);
    reboundKindInput.value = event.reboundKind || 'defensive';
    periodLabelInput.value = event.periodLabel || '';
    timestampDisplay.textContent = formatVideoTime(editingSeconds);
    updateDependentFields();
    setEditError();
    dialog.showModal();
  }

  function render(nextGame) {
    game = nextGame;
    eventList.innerHTML = '';
    if (!game) {
      emptyEvents.classList.remove('hidden');
      return;
    }
    const playersById = Object.fromEntries(game.players.map(player => [player.id, player]));
    const events = orderGameEvents(game.events).reverse();
    emptyEvents.classList.toggle('hidden', events.length > 0);
    for (const event of events) {
      const item = eventTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.eventId = event.id;
      item.querySelector('.event-time').textContent = formatVideoTime(event.videoSeconds);
      const description = describeEvent(event, playersById);
      item.querySelector('.event-description').textContent = description;
      item.querySelector('.event-description').title = description;
      item.querySelector('[data-action="edit-event"]').disabled = !EDITABLE_TYPES.has(event.type);
      eventList.appendChild(item);
    }
  }

  async function commit(nextGame) {
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

  sideInput.addEventListener('change', () => {
    playerInput.disabled = sideInput.value === 'opponent';
    if (sideInput.value === 'opponent') playerInput.value = '';
  });
  typeInput.addEventListener('change', updateDependentFields);
  cancelButton.addEventListener('click', () => dialog.close());
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

  return { render };
}
