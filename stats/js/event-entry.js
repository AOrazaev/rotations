import { buildGameAnalysis } from './event-reducer.js';
import { createEventListController } from './event-list.js';
import { createReportController } from './report-view.js';
import {
  getLineupAtEventPosition,
  rebuildLineupSnapshots
} from './game-model.js';
import { createShotDetailsEditor } from './shot-details-editor.js';
import { getConfidentExpectedShotValue } from './shot-geometry.js';
import { formatVideoTime } from './youtube-player.js';
import {
  appendVoiceEventBatch,
  removeLatestVoiceEventBatch
} from './voice-event-batch.js';

export function createEventEntryController({
  documentObject = document,
  store,
  videoController,
  now = () => new Date().toISOString(),
  confirmFn = message => confirm(message),
  onGameChanged = () => {}
}) {
  const gameStatus = documentObject.querySelector('#eventGameStatus');
  const lockMessage = documentObject.querySelector('#eventLockMessage');
  const teamScore = documentObject.querySelector('#teamScore');
  const opponentScore = documentObject.querySelector('#opponentScore');
  const teamFieldGoals = documentObject.querySelector('#teamFieldGoals');
  const opponentFieldGoals = documentObject.querySelector('#opponentFieldGoals');
  const sideButtons = [...documentObject.querySelectorAll('[data-event-side]')];
  const eventButtons = documentObject.querySelector('#eventButtons');
  const eventError = documentObject.querySelector('#eventError');
  const shotLocationPanel = documentObject.querySelector('#shotLocationPanel');
  const shotLocationDescription = documentObject.querySelector('#shotLocationDescription');
  const shotDetailsCapture = documentObject.querySelector('#shotDetailsCapture');
  const closeShotLocation = documentObject.querySelector('#closeShotLocation');
  const undoButton = documentObject.querySelector('#undoEvent');
  const eventEntryPanel = documentObject.querySelector('#eventEntryPanel');
  const eventLogPanel = documentObject.querySelector('#eventLogPanel');
  const currentLineup = documentObject.querySelector('#currentLineup');
  const benchPlayers = documentObject.querySelector('#benchPlayers');
  const openSubstitutionButton = documentObject.querySelector('#openSubstitution');
  const substitutionDialog = documentObject.querySelector('#substitutionDialog');
  const substitutionForm = documentObject.querySelector('#substitutionForm');
  const substitutionTimestamp = documentObject.querySelector('#substitutionTimestamp');
  const substitutionPlayerOut = documentObject.querySelector('#substitutionPlayerOut');
  const substitutionPlayerIn = documentObject.querySelector('#substitutionPlayerIn');
  const substitutionError = documentObject.querySelector('#substitutionError');
  const cancelSubstitution = documentObject.querySelector('#cancelSubstitution');
  const openPeriodEndButton = documentObject.querySelector('#openPeriodEnd');
  const periodEndDialog = documentObject.querySelector('#periodEndDialog');
  const periodEndForm = documentObject.querySelector('#periodEndForm');
  const periodEndTimestamp = documentObject.querySelector('#periodEndTimestamp');
  const periodEndLabel = documentObject.querySelector('#periodEndLabel');
  const periodEndError = documentObject.querySelector('#periodEndError');
  const cancelPeriodEnd = documentObject.querySelector('#cancelPeriodEnd');
  const openNoteButton = documentObject.querySelector('#openNote');
  const noteDialog = documentObject.querySelector('#noteDialog');
  const noteForm = documentObject.querySelector('#noteForm');
  const noteTimestamp = documentObject.querySelector('#noteTimestamp');
  const noteText = documentObject.querySelector('#noteText');
  const noteError = documentObject.querySelector('#noteError');
  const cancelNote = documentObject.querySelector('#cancelNote');

  let game = null;
  let side = 'team';
  let busy = false;
  let eventListController;
  let substitutionSeconds = 0;
  let periodEndSeconds = 0;
  let noteSeconds = 0;
  let selectedPlayerId = null;
  let activeShotEventId = null;
  let shotLocationRevision = 0;
  let undoQueued = false;
  let latestVoiceBatchEventIds = [];
  let eventEntryQueue = Promise.resolve();
  const reportController = createReportController({ documentObject, videoController });
  const shotDetailsEditor = createShotDetailsEditor({
    element: shotDetailsCapture,
    documentObject,
    onChange(details, change) {
      const eventId = activeShotEventId;
      if (!eventId) return;
      const revision = ++shotLocationRevision;
      eventEntryQueue = eventEntryQueue.then(() => saveShotDetails(eventId, details, change, revision));
    }
  });

  function playerLabel(player) {
    return player.number ? `#${player.number} ${player.name}` : player.name;
  }

  function setError(message = '') {
    eventError.textContent = message;
    eventError.classList.toggle('hidden', !message);
  }

  function setControlsEnabled(enabled) {
    eventButtons.querySelectorAll('button').forEach(button => { button.disabled = !enabled; });
    undoButton.disabled = !game?.events.length;
    openSubstitutionButton.disabled = !enabled || !game || game.players.length <= 5;
    openPeriodEndButton.disabled = !enabled;
    openNoteButton.disabled = !enabled;
    shotDetailsEditor.setDisabled(!enabled);
  }

  function hideShotLocation() {
    shotLocationRevision++;
    activeShotEventId = null;
    shotLocationPanel.classList.add('hidden');
    shotDetailsEditor.setDetails(null);
  }

  function updateShotLocationDescription(event) {
    shotLocationDescription.textContent = `${event.made ? 'Made' : 'Missed'} ${event.shotValue}PT saved at ${formatVideoTime(event.videoSeconds)}. Details are optional.`;
  }

  function showShotLocation(event) {
    shotLocationRevision++;
    activeShotEventId = event.id;
    updateShotLocationDescription(event);
    shotDetailsEditor.setShotValue(event.shotValue);
    shotDetailsEditor.setDetails(event.shotDetails || null);
    shotLocationPanel.classList.remove('hidden');
  }

  function updatePlayerSelection() {
    currentLineup.querySelectorAll('.player-select-button').forEach(button => {
      const selected = side === 'team' && button.dataset.playerId === selectedPlayerId;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function setEventSide(nextSide) {
    side = nextSide;
    sideButtons.forEach(button => {
      const active = button.dataset.eventSide === side;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (side === 'opponent') selectedPlayerId = null;
    updatePlayerSelection();
  }

  function renderLineup(analysis) {
    currentLineup.innerHTML = '';
    benchPlayers.innerHTML = '';
    const activeIds = new Set(analysis?.activeLineupIds || []);
    if (!activeIds.has(selectedPlayerId)) selectedPlayerId = null;
    for (const player of game?.players || []) {
      const isActive = activeIds.has(player.id);
      const chip = documentObject.createElement(isActive ? 'button' : 'span');
      chip.className = 'player-chip';
      chip.dataset.playerId = player.id;
      chip.textContent = playerLabel(player);
      if (isActive) {
        chip.type = 'button';
        chip.classList.add('player-select-button');
        chip.setAttribute('aria-pressed', 'false');
      }
      (isActive ? currentLineup : benchPlayers).appendChild(chip);
    }
    updatePlayerSelection();
  }

  function render() {
    setError();
    if (!game) {
      gameStatus.textContent = 'Save or open a game to record events.';
      teamScore.textContent = '0';
      opponentScore.textContent = '0';
      teamFieldGoals.textContent = '0/0';
      opponentFieldGoals.textContent = '0/0';
      lockMessage.textContent = 'Save or open a game before recording statistics.';
      lockMessage.classList.remove('hidden');
      eventEntryPanel.classList.add('hidden');
      eventLogPanel.classList.add('hidden');
      renderLineup(null);
      setControlsEnabled(false);
      eventListController.render(null);
      reportController.render(null, null);
      hideShotLocation();
      return;
    }

    const analysis = buildGameAnalysis(game);
    eventEntryPanel.classList.remove('hidden');
    eventLogPanel.classList.remove('hidden');
    gameStatus.textContent = `${game.title} · ${game.startingLineupIds.length} players on court`;
    teamScore.textContent = String(analysis.report.score.team);
    opponentScore.textContent = String(analysis.report.score.opponent);
    const ourFg = analysis.report.teamComparison.team.fieldGoals;
    const theirFg = analysis.report.teamComparison.opponent.fieldGoals;
    teamFieldGoals.textContent = `${ourFg.made}/${ourFg.attempted}`;
    opponentFieldGoals.textContent = `${theirFg.made}/${theirFg.attempted}`;
    renderLineup(analysis);
    const videoReady = videoController.isReady();
    lockMessage.textContent = videoReady ? '' : 'This game’s recording is loading or unavailable.';
    lockMessage.classList.toggle('hidden', videoReady);
    eventListController.render(game);
    reportController.render(game, analysis);
    setControlsEnabled(videoReady);
  }

  async function persist(nextGame, { preserveVoiceBatch = false } = {}) {
    const rebuilt = rebuildLineupSnapshots(nextGame);
    await store.saveGame(rebuilt);
    game = rebuilt;
    if (!preserveVoiceBatch) latestVoiceBatchEventIds = [];
    render();
    await onGameChanged(game);
  }

  async function saveShotDetails(eventId, details, change, revision) {
    if (!game) return;
    const previousEvent = game.events.find(event => event.id === eventId);
    if (!previousEvent || previousEvent.type !== 'shot' || ![2, 3].includes(previousEvent.shotValue)) {
      if (activeShotEventId === eventId) hideShotLocation();
      return;
    }
    const previousDetails = previousEvent.shotDetails || null;
    busy = true;
    try {
      const next = structuredClone(game);
      const event = next.events.find(item => item.id === eventId);
      if (details) event.shotDetails = details;
      else delete event.shotDetails;
      if (change.field === 'location' && details?.location) {
        const expectedShotValue = getConfidentExpectedShotValue(details.location);
        if (expectedShotValue && expectedShotValue !== event.shotValue
          && confirmFn(`This location is in the ${expectedShotValue}PT area, but the event is recorded as ${event.shotValue}PT. Change the event to ${expectedShotValue}PT?`)) {
          event.shotValue = expectedShotValue;
        }
      }
      event.updatedAt = now();
      next.updatedAt = now();
      await persist(next);
      if (activeShotEventId === eventId && shotLocationRevision === revision) {
        const saved = game.events.find(item => item.id === eventId);
        shotDetailsEditor.setDetails(saved.shotDetails || null);
        shotDetailsEditor.setShotValue(saved.shotValue);
        updateShotLocationDescription(saved);
      }
    } catch (error) {
      if (activeShotEventId === eventId && shotLocationRevision === revision) {
        shotDetailsEditor.setDetails(previousDetails);
      }
      setError(error.message || 'Could not save the shot details.');
    } finally {
      busy = false;
      shotDetailsEditor.setDisabled(!videoController.isReady());
    }
  }

  eventListController = createEventListController({
    documentObject,
    videoController,
    saveGame: persist,
    now,
    onError(error) {
      setError(error.message || 'Could not review the event.');
    }
  });

  async function addEvent(button) {
    if (!game) return;
    setError();
    busy = true;
    try {
      const videoSeconds = videoController.getCurrentSeconds();
      const type = button.dataset.eventType;
      const requiresPlayer = side === 'team' && type !== 'timeout';
      const playerId = requiresPlayer ? selectedPlayerId : null;
      if (requiresPlayer && !playerId) throw new Error('Select one of our on-court players.');

      const next = structuredClone(game);
      const event = {
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...next.events.map(item => item.sequence)) + 1,
        videoSeconds,
        side,
        type,
        playerId,
        relatedEventId: null,
        lineupIds: getLineupAtEventPosition(next, videoSeconds),
        createdAt: now(),
        updatedAt: null,
      };
      if (event.type === 'shot') {
        event.shotValue = Number(button.dataset.shotValue);
        event.made = button.dataset.made === 'true';
      } else if (event.type === 'rebound') {
        event.reboundKind = button.dataset.reboundKind;
      }
      next.events.push(event);
      next.updatedAt = now();
      await persist(next);
      if (event.type === 'shot' && [2, 3].includes(event.shotValue)) {
        showShotLocation(event);
      } else {
        hideShotLocation();
      }
    } catch (error) {
      setError(error.message || 'Could not save the event.');
    } finally {
      busy = false;
      shotDetailsEditor.setDisabled(!videoController.isReady());
    }
  }

  function setSubstitutionError(message = '') {
    substitutionError.textContent = message;
    substitutionError.classList.toggle('hidden', !message);
  }

  function populateSubstitutionOptions(lineupIds) {
    const active = new Set(lineupIds);
    substitutionPlayerOut.innerHTML = '';
    substitutionPlayerIn.innerHTML = '';
    for (const player of game.players) {
      const option = documentObject.createElement('option');
      option.value = player.id;
      option.textContent = playerLabel(player);
      (active.has(player.id) ? substitutionPlayerOut : substitutionPlayerIn).appendChild(option);
    }
  }

  openSubstitutionButton.addEventListener('click', () => {
    if (!game || busy) return;
    try {
      substitutionSeconds = videoController.getCurrentSeconds();
      const sequence = Math.max(0, ...game.events.map(event => event.sequence)) + 1;
      const lineupIds = getLineupAtEventPosition(game, substitutionSeconds, sequence);
      populateSubstitutionOptions(lineupIds);
      substitutionTimestamp.textContent = formatVideoTime(substitutionSeconds);
      setSubstitutionError();
      substitutionDialog.showModal();
    } catch (error) {
      setError(error.message || 'Could not prepare the substitution.');
    }
  });
  cancelSubstitution.addEventListener('click', () => substitutionDialog.close());
  substitutionForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!game || busy) return;
    setSubstitutionError();
    busy = true;
    try {
      const next = structuredClone(game);
      next.events.push({
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...next.events.map(item => item.sequence)) + 1,
        videoSeconds: substitutionSeconds,
        side: 'team',
        type: 'substitution',
        playerId: null,
        playerOutId: substitutionPlayerOut.value,
        playerInId: substitutionPlayerIn.value,
        relatedEventId: null,
        lineupIds: [],
        createdAt: now(),
        updatedAt: null,
      });
      next.updatedAt = now();
      await persist(next);
      hideShotLocation();
      substitutionDialog.close();
    } catch (error) {
      setSubstitutionError(error.message || 'Could not save the substitution.');
    } finally {
      busy = false;
    }
  });

  function setPeriodEndError(message = '') {
    periodEndError.textContent = message;
    periodEndError.classList.toggle('hidden', !message);
  }

  openPeriodEndButton.addEventListener('click', () => {
    if (!game || busy) return;
    try {
      periodEndSeconds = videoController.getCurrentSeconds();
      periodEndTimestamp.textContent = formatVideoTime(periodEndSeconds);
      periodEndLabel.value = '';
      setPeriodEndError();
      periodEndDialog.showModal();
      periodEndLabel.focus();
    } catch (error) {
      setError(error.message || 'Could not prepare the period marker.');
    }
  });
  cancelPeriodEnd.addEventListener('click', () => periodEndDialog.close());
  periodEndForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!game || busy) return;
    setPeriodEndError();
    busy = true;
    try {
      const label = periodEndLabel.value.trim();
      if (!label) throw new Error('Enter a period label.');
      const next = structuredClone(game);
      next.events.push({
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...next.events.map(item => item.sequence)) + 1,
        videoSeconds: periodEndSeconds,
        side: 'system',
        type: 'period_end',
        playerId: null,
        periodLabel: label,
        relatedEventId: null,
        lineupIds: getLineupAtEventPosition(next, periodEndSeconds),
        createdAt: now(),
        updatedAt: null,
      });
      next.updatedAt = now();
      await persist(next);
      hideShotLocation();
      periodEndDialog.close();
    } catch (error) {
      setPeriodEndError(error.message || 'Could not save the period marker.');
    } finally {
      busy = false;
    }
  });

  function setNoteError(message = '') {
    noteError.textContent = message;
    noteError.classList.toggle('hidden', !message);
  }

  openNoteButton.addEventListener('click', () => {
    if (!game || busy) return;
    try {
      noteSeconds = videoController.getCurrentSeconds();
      noteTimestamp.textContent = formatVideoTime(noteSeconds);
      noteText.value = '';
      setNoteError();
      noteDialog.showModal();
      noteText.focus();
    } catch (error) {
      setError(error.message || 'Could not prepare the note.');
    }
  });
  cancelNote.addEventListener('click', () => noteDialog.close());
  noteForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!game || busy) return;
    setNoteError();
    busy = true;
    try {
      const text = noteText.value.trim();
      if (!text) throw new Error('Enter note text.');
      const next = structuredClone(game);
      next.events.push({
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...next.events.map(item => item.sequence)) + 1,
        videoSeconds: noteSeconds,
        side: 'system',
        type: 'note',
        playerId: null,
        note: text,
        relatedEventId: null,
        lineupIds: getLineupAtEventPosition(next, noteSeconds),
        createdAt: now(),
        updatedAt: null,
      });
      next.updatedAt = now();
      await persist(next);
      hideShotLocation();
      noteDialog.close();
    } catch (error) {
      setNoteError(error.message || 'Could not save the note.');
    } finally {
      busy = false;
    }
  });

  sideButtons.forEach(button => button.addEventListener('click', () => setEventSide(button.dataset.eventSide)));

  currentLineup.addEventListener('click', event => {
    const button = event.target.closest('.player-select-button');
    if (!button) return;
    setEventSide('team');
    selectedPlayerId = button.dataset.playerId;
    updatePlayerSelection();
    setError();
  });

  eventButtons.addEventListener('click', event => {
    const button = event.target.closest('button[data-event-type]');
    if (button) {
      eventEntryQueue = eventEntryQueue.then(() => addEvent(button));
    }
  });

  closeShotLocation.addEventListener('click', hideShotLocation);

  async function undoLatestEvent() {
    if (!game?.events.length) return;
    busy = true;
    setError();
    try {
      const next = structuredClone(game);
      const orderedBySequence = [...next.events].sort((a, b) => a.sequence - b.sequence);
      const latestIds = orderedBySequence
        .slice(-latestVoiceBatchEventIds.length)
        .map(event => event.id);
      const undoVoiceBatch = latestVoiceBatchEventIds.length
        && latestIds.every((eventId, index) => eventId === latestVoiceBatchEventIds[index]);
      if (undoVoiceBatch) {
        const batchIds = new Set(latestVoiceBatchEventIds);
        next.events = next.events.filter(event => !batchIds.has(event.id));
      } else {
        const latestSequence = Math.max(...next.events.map(event => event.sequence));
        next.events = next.events.filter(event => event.sequence !== latestSequence);
      }
      next.updatedAt = now();
      await persist(next);
      if (activeShotEventId && !next.events.some(event => event.id === activeShotEventId)) hideShotLocation();
    } catch (error) {
      setError(error.message || 'Could not undo the event.');
    } finally {
      busy = false;
    }
  }

  undoButton.addEventListener('click', () => {
    if (undoQueued) return;
    undoQueued = true;
    eventEntryQueue = eventEntryQueue
      .then(undoLatestEvent)
      .finally(() => { undoQueued = false; });
  });

  function enqueueExternalMutation(operation) {
    const queued = eventEntryQueue.then(operation);
    eventEntryQueue = queued.catch(() => {});
    return queued;
  }

  async function commitVoiceProposal({
    expectedGameId,
    expectedGameUpdatedAt,
    capturedSeconds,
    events
  }) {
    return enqueueExternalMutation(async () => {
      if (!game || busy) throw new Error('The game is busy. Try adding the voice events again.');
      busy = true;
      setError();
      try {
        const batch = appendVoiceEventBatch(game, {
          expectedGameId,
          expectedGameUpdatedAt,
          capturedSeconds,
          proposalEvents: events,
          now
        });
        await persist(batch.game, { preserveVoiceBatch: true });
        latestVoiceBatchEventIds = [...batch.eventIds];
        hideShotLocation();
        eventListController.highlightEvents(batch.eventIds);
        return {
          eventIds: [...batch.eventIds],
          gameId: game.id,
          gameUpdatedAt: game.updatedAt
        };
      } catch (error) {
        setError(error.message || 'Could not add the voice events.');
        throw error;
      } finally {
        busy = false;
      }
    });
  }

  async function undoVoiceBatch({ expectedGameId, eventIds }) {
    return enqueueExternalMutation(async () => {
      if (!game || busy) throw new Error('The game is busy. Try undoing the voice batch again.');
      busy = true;
      setError();
      try {
        const next = removeLatestVoiceEventBatch(game, {
          expectedGameId,
          eventIds,
          now
        });
        await persist(next);
        eventListController.clearHighlightedEvents();
        hideShotLocation();
        return {
          gameId: game.id,
          gameUpdatedAt: game.updatedAt
        };
      } catch (error) {
        setError(error.message || 'Could not undo the voice batch.');
        throw error;
      } finally {
        busy = false;
      }
    });
  }

  render();
  const unsubscribeReady = videoController.subscribeReady(render);

  return {
    setGame(nextGame) {
      game = structuredClone(nextGame);
      side = 'team';
      selectedPlayerId = null;
      latestVoiceBatchEventIds = [];
      hideShotLocation();
      eventListController.clearHighlightedEvents();
      sideButtons[0].click();
      render();
    },
    getGame: () => game ? structuredClone(game) : null,
    commitVoiceProposal,
    undoVoiceBatch,
    destroy() {
      unsubscribeReady();
      shotDetailsEditor.destroy();
    },
  };
}
