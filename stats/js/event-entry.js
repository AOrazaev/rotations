import { buildGameAnalysis } from './event-reducer.js';
import { createEventListController } from './event-list.js';
import {
  getLineupAtEventPosition,
  rebuildLineupSnapshots
} from './game-model.js';
import { formatVideoTime } from './youtube-player.js';

export function createEventEntryController({
  documentObject = document,
  store,
  videoController,
  now = () => new Date().toISOString(),
  onGameChanged = () => {}
}) {
  const gameStatus = documentObject.querySelector('#eventGameStatus');
  const lockMessage = documentObject.querySelector('#eventLockMessage');
  const teamScore = documentObject.querySelector('#teamScore');
  const opponentScore = documentObject.querySelector('#opponentScore');
  const teamFieldGoals = documentObject.querySelector('#teamFieldGoals');
  const opponentFieldGoals = documentObject.querySelector('#opponentFieldGoals');
  const sideButtons = [...documentObject.querySelectorAll('[data-event-side]')];
  const playerSelect = documentObject.querySelector('#eventPlayer');
  const eventButtons = documentObject.querySelector('#eventButtons');
  const eventError = documentObject.querySelector('#eventError');
  const undoButton = documentObject.querySelector('#undoEvent');
  const currentLineup = documentObject.querySelector('#currentLineup');
  const benchPlayers = documentObject.querySelector('#benchPlayers');
  const plannedReference = documentObject.querySelector('#plannedLineupReference');
  const openSubstitutionButton = documentObject.querySelector('#openSubstitution');
  const substitutionDialog = documentObject.querySelector('#substitutionDialog');
  const substitutionForm = documentObject.querySelector('#substitutionForm');
  const substitutionTimestamp = documentObject.querySelector('#substitutionTimestamp');
  const substitutionPlayerOut = documentObject.querySelector('#substitutionPlayerOut');
  const substitutionPlayerIn = documentObject.querySelector('#substitutionPlayerIn');
  const substitutionError = documentObject.querySelector('#substitutionError');
  const cancelSubstitution = documentObject.querySelector('#cancelSubstitution');

  let game = null;
  let side = 'team';
  let busy = false;
  let eventListController;
  let substitutionSeconds = 0;

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
  }

  function renderPlayerOptions(lineupIds = []) {
    const selectedPlayerId = playerSelect.value;
    playerSelect.innerHTML = '<option value="">Select player</option>';
    if (!game) {
      playerSelect.disabled = true;
      return;
    }
    const byId = Object.fromEntries(game.players.map(player => [player.id, player]));
    for (const playerId of lineupIds) {
      const player = byId[playerId];
      const option = documentObject.createElement('option');
      option.value = player.id;
      option.textContent = playerLabel(player);
      playerSelect.appendChild(option);
    }
    if (lineupIds.includes(selectedPlayerId)) playerSelect.value = selectedPlayerId;
    playerSelect.disabled = side === 'opponent';
  }

  function renderLineup(analysis) {
    currentLineup.innerHTML = '';
    benchPlayers.innerHTML = '';
    const activeIds = new Set(analysis?.activeLineupIds || []);
    for (const player of game?.players || []) {
      const chip = documentObject.createElement('span');
      chip.className = 'player-chip';
      chip.dataset.playerId = player.id;
      chip.textContent = playerLabel(player);
      (activeIds.has(player.id) ? currentLineup : benchPlayers).appendChild(chip);
    }
    plannedReference.innerHTML = '';
    const planned = game?.plannedRotation;
    plannedReference.classList.toggle('hidden', !planned);
    if (planned) {
      const heading = documentObject.createElement('strong');
      heading.textContent = `Planned reference · ${planned.blockMinutes}-minute blocks`;
      const blocks = documentObject.createElement('div');
      blocks.className = 'planned-blocks';
      const byId = Object.fromEntries(game.players.map(player => [player.id, player]));
      planned.blocks.forEach((block, index) => {
        const item = documentObject.createElement('span');
        item.textContent = `B${index + 1}: ${block.lineupIds.map(id => byId[id]?.name || id).join(', ')}`;
        blocks.appendChild(item);
      });
      plannedReference.append(heading, blocks);
    }
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
      renderPlayerOptions();
      renderLineup(null);
      setControlsEnabled(false);
      eventListController.render(null);
      return;
    }

    const analysis = buildGameAnalysis(game);
    gameStatus.textContent = `${game.title} · ${game.startingLineupIds.length} players on court`;
    teamScore.textContent = String(analysis.report.score.team);
    opponentScore.textContent = String(analysis.report.score.opponent);
    const ourFg = analysis.report.teamComparison.team.fieldGoals;
    const theirFg = analysis.report.teamComparison.opponent.fieldGoals;
    teamFieldGoals.textContent = `${ourFg.made}/${ourFg.attempted}`;
    opponentFieldGoals.textContent = `${theirFg.made}/${theirFg.attempted}`;
    renderPlayerOptions(analysis.activeLineupIds);
    renderLineup(analysis);
    const videoReady = videoController.isReady();
    lockMessage.textContent = videoReady ? '' : 'Load this game’s recording before adding a new event.';
    lockMessage.classList.toggle('hidden', videoReady);
    eventListController.render(game);
    setControlsEnabled(videoReady);
  }

  async function persist(nextGame) {
    const rebuilt = rebuildLineupSnapshots(nextGame);
    await store.saveGame(rebuilt);
    game = rebuilt;
    render();
    await onGameChanged(game);
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
    if (!game || busy) return;
    setError();
    busy = true;
    try {
      const videoSeconds = videoController.getCurrentSeconds();
      const playerId = side === 'team' ? playerSelect.value : null;
      if (side === 'team' && !playerId) throw new Error('Select one of our on-court players.');

      const next = structuredClone(game);
      const event = {
        id: crypto.randomUUID(),
        sequence: Math.max(0, ...next.events.map(item => item.sequence)) + 1,
        videoSeconds,
        side,
        type: button.dataset.eventType,
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
    } catch (error) {
      setError(error.message || 'Could not save the event.');
    } finally {
      busy = false;
    }
  }

  sideButtons.forEach(button => button.addEventListener('click', () => {
    side = button.dataset.eventSide;
    sideButtons.forEach(candidate => {
      const active = candidate === button;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', String(active));
    });

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
        substitutionDialog.close();
      } catch (error) {
        setSubstitutionError(error.message || 'Could not save the substitution.');
      } finally {
        busy = false;
      }
    });
    playerSelect.disabled = side === 'opponent' || !game;
    if (side === 'opponent') playerSelect.value = '';
  }));

  eventButtons.addEventListener('click', event => {
    const button = event.target.closest('button[data-event-type]');
    if (button) addEvent(button);
  });

  undoButton.addEventListener('click', async () => {
    if (!game?.events.length || busy) return;
    busy = true;
    setError();
    try {
      const next = structuredClone(game);
      const latestSequence = Math.max(...next.events.map(event => event.sequence));
      next.events = next.events.filter(event => event.sequence !== latestSequence);
      next.updatedAt = now();
      await persist(next);
    } catch (error) {
      setError(error.message || 'Could not undo the event.');
    } finally {
      busy = false;
    }
  });

  render();
  const unsubscribeReady = videoController.subscribeReady(render);

  return {
    setGame(nextGame) {
      game = structuredClone(nextGame);
      side = 'team';
      sideButtons[0].click();
      render();
    },
    getGame: () => game ? structuredClone(game) : null,
    destroy() {
      unsubscribeReady();
    },
  };
}
