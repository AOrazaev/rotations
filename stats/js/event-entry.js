import { buildGameAnalysis } from './event-reducer.js';
import { createEventListController } from './event-list.js';
import { createReportController } from './report-view.js';
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

  let game = null;
  let side = 'team';
  let busy = false;
  let eventListController;
  let substitutionSeconds = 0;
  let periodEndSeconds = 0;
  const reportController = createReportController({ documentObject, videoController });

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
      eventLogPanel.classList.add('hidden');
      renderPlayerOptions();
      renderLineup(null);
      setControlsEnabled(false);
      eventListController.render(null);
      reportController.render(null, null);
      return;
    }

    const analysis = buildGameAnalysis(game);
    eventLogPanel.classList.remove('hidden');
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
    reportController.render(game, analysis);
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
      const type = button.dataset.eventType;
      const requiresPlayer = side === 'team' && type !== 'timeout';
      const playerId = requiresPlayer ? playerSelect.value : null;
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
    } catch (error) {
      setError(error.message || 'Could not save the event.');
    } finally {
      busy = false;
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
      periodEndDialog.close();
    } catch (error) {
      setPeriodEndError(error.message || 'Could not save the period marker.');
    } finally {
      busy = false;
    }
  });

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
