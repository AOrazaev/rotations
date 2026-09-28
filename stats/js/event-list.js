import { orderGameEvents } from './game-model.js';
import { formatVideoTime } from './youtube-player.js';

const PREVIEW_SECONDS = 3;
const EDITABLE_TYPES = new Set(['shot', 'rebound', 'assist', 'steal', 'block', 'turnover', 'foul']);

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
  }

  function populatePlayers(event) {
    playerInput.innerHTML = '<option value="">Select player</option>';
    const byId = Object.fromEntries(game.players.map(player => [player.id, player]));
    for (const playerId of event.lineupIds) {
      const player = byId[playerId];
      const option = documentObject.createElement('option');
      option.value = player.id;
      option.textContent = player.number ? `#${player.number} ${player.name}` : player.name;
      playerInput.appendChild(option);
    }
    playerInput.value = event.playerId || '';
    playerInput.disabled = sideInput.value === 'opponent';
  }

  function openEditor(event) {
    if (!EDITABLE_TYPES.has(event.type)) return;
    editingEventId = event.id;
    editingSeconds = event.videoSeconds;
    sideInput.value = event.side;
    typeInput.value = event.type;
    populatePlayers(event);
    shotValueInput.value = String(event.shotValue || 2);
    shotMadeInput.value = String(event.made ?? true);
    reboundKindInput.value = event.reboundKind || 'defensive';
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
    const events = orderGameEvents(game.events);
    emptyEvents.classList.toggle('hidden', events.length > 0);
    for (const event of events) {
      const item = eventTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.eventId = event.id;
      item.querySelector('.event-time').textContent = formatVideoTime(event.videoSeconds);
      item.querySelector('.event-description').textContent = describeEvent(event, playersById);
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
      if (button.dataset.action === 'seek-event') {
        videoController.seekTo(selected.videoSeconds);
      } else if (button.dataset.action === 'preview-event') {
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
  }));
  useCurrentButton.addEventListener('click', () => {
    try {
      editingSeconds = videoController.getCurrentSeconds();
      timestampDisplay.textContent = formatVideoTime(editingSeconds);
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
      edited.side = sideInput.value;
      edited.playerId = edited.side === 'team' ? playerInput.value : null;
      if (edited.side === 'team' && !edited.playerId) throw new Error('Select one of our on-court players.');
      edited.type = typeInput.value;
      edited.videoSeconds = editingSeconds;
      edited.updatedAt = now();
      delete edited.shotValue;
      delete edited.made;
      delete edited.reboundKind;
      if (edited.type === 'shot') {
        edited.shotValue = Number(shotValueInput.value);
        edited.made = shotMadeInput.value === 'true';
      } else if (edited.type === 'rebound') {
        edited.reboundKind = reboundKindInput.value;
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
