import { buildGameAnalysis } from './event-reducer.js';
import { createEventListController } from './event-list.js';

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

  let game = null;
  let side = 'team';
  let busy = false;
  let eventListController;

  function setError(message = '') {
    eventError.textContent = message;
    eventError.classList.toggle('hidden', !message);
  }

  function setControlsEnabled(enabled) {
    eventButtons.querySelectorAll('button').forEach(button => { button.disabled = !enabled; });
    undoButton.disabled = !game?.events.length;
  }

  function renderPlayerOptions() {
    playerSelect.innerHTML = '<option value="">Select player</option>';
    if (!game) {
      playerSelect.disabled = true;
      return;
    }
    const byId = Object.fromEntries(game.players.map(player => [player.id, player]));
    for (const playerId of game.startingLineupIds) {
      const player = byId[playerId];
      const option = documentObject.createElement('option');
      option.value = player.id;
      option.textContent = player.number ? `#${player.number} ${player.name}` : player.name;
      playerSelect.appendChild(option);
    }
    playerSelect.disabled = side === 'opponent';
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
    renderPlayerOptions();
    const videoReady = videoController.isReady();
    lockMessage.textContent = videoReady ? '' : 'Load this game’s recording before adding a new event.';
    lockMessage.classList.toggle('hidden', videoReady);
    eventListController.render(game);
    setControlsEnabled(videoReady);
  }

  async function persist(nextGame) {
    await store.saveGame(nextGame);
    game = nextGame;
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
        lineupIds: [...next.startingLineupIds],
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
