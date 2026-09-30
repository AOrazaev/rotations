import { validateGame } from './game-model.js';
import { parseYouTubeVideoId } from './youtube-player.js';
import { consumePlannerHandoff } from './roster-transfer.js';
import {
  gameBackupFileName,
  parseGameBackup,
  serializeGameBackup
} from './game-backup.js';

function newPlayer(index) {
  return {
    id: crypto.randomUUID(),
    name: `Player ${index}`,
    number: '',
    positions: [],
    skill: null,
  };
}

function snapshotPlayer(player) {
  return {
    id: player.id,
    name: player.name.trim(),
    number: player.number.replace(/[^0-9]/g, '').slice(0, 3),
    positions: [...(player.positions || [])],
    skill: player.skill == null ? null : Number(player.skill),
  };
}

export function buildGameFromSetup({
  id = crypto.randomUUID(),
  title,
  opponentName = '',
  videoUrl,
  players,
  startingLineupIds,
  source = 'standalone',
  plannedRotation = null,
  events = [],
  videoStartSeconds = 0,
  videoEndSeconds = null,
  createdAt,
  now = new Date().toISOString()
}) {
  const videoId = parseYouTubeVideoId(videoUrl);
  const game = {
    schemaVersion: 1,
    id,
    title: String(title || '').trim(),
    opponentName: String(opponentName || '').trim(),
    createdAt: createdAt || now,
    updatedAt: now,
    source,
    video: {
      provider: 'youtube',
      videoId,
      sourceUrl: String(videoUrl).trim(),
      startSeconds: videoStartSeconds,
      endSeconds: videoEndSeconds,
    },
    players: players.map(snapshotPlayer),
    startingLineupIds: [...startingLineupIds],
    plannedRotation: plannedRotation ? structuredClone(plannedRotation) : null,
    events: structuredClone(events),
  };
  validateGame(game);
  return game;
}

export function createGameSetupController({
  documentObject = document,
  store,
  storage = localStorage,
  locationObject = location,
  historyObject = history,
  now = () => new Date().toISOString(),
  onGameOpened = () => {},
  onReviewRequested = () => {},
  initializeDraft = true
}) {
  const gamesStatus = documentObject.querySelector('#gamesStatus');
  const gamesList = documentObject.querySelector('#gamesList');
  const emptyGames = documentObject.querySelector('#emptyGames');
  const gameListItemTemplate = documentObject.querySelector('#gameListItemTemplate');
  const newStandaloneButton = documentObject.querySelector('#newStandaloneGame');
  const importPlannerButton = documentObject.querySelector('#importPlannerRoster');
  const importBackupButton = documentObject.querySelector('#importGameBackup');
  const importBackupFile = documentObject.querySelector('#importGameBackupFile');
  const setupForm = documentObject.querySelector('#gameSetupForm');
  const gameEditorDetails = documentObject.querySelector('#gameEditorDetails');
  const setupTitle = documentObject.querySelector('#gameSetupTitle');
  const titleInput = documentObject.querySelector('#gameTitle');
  const opponentInput = documentObject.querySelector('#opponentName');
  const gameVideoUrl = documentObject.querySelector('#gameVideoUrl');
  const setupRoster = documentObject.querySelector('#setupRoster');
  const setupPlayerTemplate = documentObject.querySelector('#setupPlayerTemplate');
  const addPlayerButton = documentObject.querySelector('#addSetupPlayer');
  const starterCount = documentObject.querySelector('#starterCount');
  const setupError = documentObject.querySelector('#setupError');

  let draft = null;
  let savedGames = [];

  function setStatus(message, isError = false) {
    gamesStatus.textContent = message;
    gamesStatus.classList.toggle('error', isError);
  }

  function setSetupError(message = '') {
    setupError.textContent = message;
    setupError.classList.toggle('hidden', !message);
  }

  function updateStarterCount() {
    const count = setupRoster.querySelectorAll('.setup-starter:checked').length;
    starterCount.textContent = String(count);
    starterCount.parentElement.classList.toggle('invalid-count', count !== 5);
  }

  function readRoster() {
    return [...setupRoster.querySelectorAll('.setup-player')].map(row => {
      const existing = draft.players.find(player => player.id === row.dataset.playerId);
      return {
        ...existing,
        id: row.dataset.playerId,
        name: row.querySelector('.setup-name').value,
        number: row.querySelector('.setup-number').value,
      };
    });
  }

  function readStartingLineupIds() {
    return [...setupRoster.querySelectorAll('.setup-player')]
      .filter(row => row.querySelector('.setup-starter').checked)
      .map(row => row.dataset.playerId);
  }

  function syncDraftFromForm() {
    draft.players = readRoster();
    draft.startingLineupIds = readStartingLineupIds();
  }

  function renderRoster() {
    setupRoster.innerHTML = '';
    draft.players.forEach((player, index) => {
      const row = setupPlayerTemplate.content.firstElementChild.cloneNode(true);
      row.dataset.playerId = player.id;
      row.querySelector('.setup-name').value = player.name;
      row.querySelector('.setup-number').value = player.number || '';
      row.querySelector('.setup-starter').checked = draft.startingLineupIds.includes(player.id);
      row.querySelector('.setup-delete').disabled = draft.players.length <= 5;
      row.querySelector('.setup-delete').addEventListener('click', () => {
        syncDraftFromForm();
        draft.players.splice(index, 1);
        draft.startingLineupIds = draft.startingLineupIds.filter(id => id !== player.id);
        renderRoster();
      });
      row.querySelector('.setup-starter').addEventListener('change', updateStarterCount);
      setupRoster.appendChild(row);
    });
    updateStarterCount();
  }

  function showDraft(nextDraft) {
    draft = nextDraft;
    gameEditorDetails.open = true;
    setupTitle.textContent = draft.id ? 'Edit game' : 'New game';
    titleInput.value = draft.title || '';
    opponentInput.value = draft.opponentName || '';
    gameVideoUrl.value = draft.videoUrl || '';
    setSetupError();
    renderRoster();
  }

  function createStandaloneDraft() {
    const players = Array.from({ length: 5 }, (_, index) => newPlayer(index + 1));
    showDraft({
      id: null,
      createdAt: null,
      source: 'standalone',
      plannedRotation: null,
      title: '',
      opponentName: '',
      videoUrl: '',
      videoStartSeconds: 0,
      videoEndSeconds: null,
      events: [],
      players,
      startingLineupIds: players.map(player => player.id),
    });
  }

  function importPlannerDraft() {
    try {
      const handoff = consumePlannerHandoff(storage);
      showDraft({
        id: null,
        createdAt: null,
        source: 'planner',
        plannedRotation: handoff.plannedRotation,
        title: '',
        opponentName: '',
        videoUrl: '',
        videoStartSeconds: 0,
        videoEndSeconds: null,
        events: [],
        players: handoff.players,
        startingLineupIds: handoff.plannedRotation?.blocks[0]?.lineupIds || handoff.players.slice(0, 5).map(player => player.id),
      });
      setStatus(`Imported ${handoff.players.length} players from the rotation planner.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function renderGames() {
    savedGames = await store.listGames();
    gamesList.innerHTML = '';
    emptyGames.classList.toggle('hidden', savedGames.length > 0);
    for (const game of savedGames) {
      const item = gameListItemTemplate.content.firstElementChild.cloneNode(true);
      item.dataset.gameId = game.id;
      item.classList.toggle('archived', Boolean(game.archivedAt));
      item.querySelector('.game-list-title').textContent = game.title;
      item.querySelector('.game-list-detail').textContent = [
        game.opponentName || 'No opponent',
        `${game.players.length} players`,
        game.archivedAt ? 'Archived' : null
      ].filter(Boolean).join(' · ');
      item.querySelector('[data-action="view-game"]').classList.toggle('hidden', Boolean(game.archivedAt));
      item.querySelector('[data-action="open-game"]').classList.toggle('hidden', Boolean(game.archivedAt));
      const archiveButton = item.querySelector('[data-action="archive-game"]');
      archiveButton.dataset.action = game.archivedAt ? 'restore-game' : 'archive-game';
      archiveButton.textContent = game.archivedAt ? 'Restore' : 'Archive';
      item.querySelectorAll('button[data-action]').forEach(button => {
        button.setAttribute('aria-label', `${button.textContent} ${game.title}`);
      });
      gamesList.appendChild(item);
    }
  }

  async function exportGame(gameId) {
    const game = await store.getGame(gameId);
    if (!game) throw new Error('That saved game no longer exists.');
    const blob = new Blob([serializeGameBackup(game, now())], { type: 'application/json' });
    const url = documentObject.defaultView.URL.createObjectURL(blob);
    const anchor = documentObject.createElement('a');
    anchor.href = url;
    anchor.download = gameBackupFileName(game);
    anchor.click();
    documentObject.defaultView.URL.revokeObjectURL(url);
    setStatus(`Exported ${game.title}.`);
  }

  async function importGameBackup(file) {
    if (!file) return;
    const game = parseGameBackup(await file.text());
    if (await store.getGame(game.id)) {
      throw new Error(`A game with ID ${game.id} already exists. Delete it before importing this backup.`);
    }
    await store.saveGame(game);
    await renderGames();
    setStatus(`Imported ${game.title} from backup.`);
  }

  async function setArchived(gameId, archived) {
    const game = await store.getGame(gameId);
    if (!game) throw new Error('That saved game no longer exists.');
    const timestamp = now();
    if (archived) game.archivedAt = timestamp;
    else delete game.archivedAt;
    game.updatedAt = timestamp;
    await store.saveGame(game);
    await renderGames();
    setStatus(`${archived ? 'Archived' : 'Restored'} ${game.title}.`);
  }

  async function openGame(gameId) {
    const game = await store.getGame(gameId);
    if (!game) {
      setStatus('That saved game no longer exists.', true);
      return;
    }
    showDraft({
      id: game.id,
      createdAt: game.createdAt,
      source: game.source,
      plannedRotation: game.plannedRotation,
      title: game.title,
      opponentName: game.opponentName,
      videoUrl: game.video.sourceUrl,
      videoStartSeconds: game.video.startSeconds,
      videoEndSeconds: game.video.endSeconds,
      events: structuredClone(game.events),
      players: structuredClone(game.players),
      startingLineupIds: [...game.startingLineupIds],
    });
    onGameOpened(game);
    setStatus(`Opened ${game.title}.`);
  }

  setupForm.addEventListener('submit', async event => {
    event.preventDefault();
    setSetupError();
    try {
      const players = readRoster();
      const starters = readStartingLineupIds();
      if (starters.length !== 5) throw new Error('Select exactly five starters.');
      const game = buildGameFromSetup({
        id: draft.id || undefined,
        createdAt: draft.createdAt || undefined,
        title: titleInput.value,
        opponentName: opponentInput.value,
        videoUrl: gameVideoUrl.value,
        players,
        startingLineupIds: starters,
        source: draft.source,
        plannedRotation: draft.plannedRotation,
        events: draft.events,
        videoStartSeconds: draft.videoStartSeconds,
        videoEndSeconds: draft.videoEndSeconds,
      });
      await store.saveGame(game);
      draft.id = game.id;
      draft.createdAt = game.createdAt;
      draft.players = structuredClone(game.players);
      draft.startingLineupIds = [...game.startingLineupIds];
      draft.events = structuredClone(game.events);
      draft.videoStartSeconds = game.video.startSeconds;
      draft.videoEndSeconds = game.video.endSeconds;
      setupTitle.textContent = 'Edit game';
      await renderGames();
      onGameOpened(game);
      setStatus(`Saved ${game.title}.`);
    } catch (error) {
      setSetupError(error.message || 'Could not save the game.');
    }
  });

  newStandaloneButton.addEventListener('click', createStandaloneDraft);
  importPlannerButton.addEventListener('click', importPlannerDraft);
  importBackupButton.addEventListener('click', () => importBackupFile.click());
  importBackupFile.addEventListener('change', async () => {
    try {
      await importGameBackup(importBackupFile.files?.[0]);
    } catch (error) {
      setStatus(error.message || 'Could not import the game backup.', true);
    } finally {
      importBackupFile.value = '';
    }
  });
  addPlayerButton.addEventListener('click', () => {
    syncDraftFromForm();
    draft.players.push(newPlayer(draft.players.length + 1));
    renderRoster();
  });
  gamesList.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    const item = event.target.closest('[data-game-id]');
    if (!button || !item) return;
    try {
      if (button.dataset.action === 'open-game') {
        await openGame(item.dataset.gameId);
      } else if (button.dataset.action === 'view-game') {
        onReviewRequested(item.dataset.gameId);
      } else if (button.dataset.action === 'export-game') {
        await exportGame(item.dataset.gameId);
      } else if (button.dataset.action === 'archive-game') {
        await setArchived(item.dataset.gameId, true);
      } else if (button.dataset.action === 'restore-game') {
        await setArchived(item.dataset.gameId, false);
      } else if (button.dataset.action === 'delete-game') {
        await store.deleteGame(item.dataset.gameId);
        await renderGames();
        setStatus('Game deleted.');
      }
    } catch (error) {
      setStatus(error.message || 'Could not update the saved game.', true);
    }
  });

  const ready = (async () => {
    try {
      await renderGames();
      if (initializeDraft && new URLSearchParams(locationObject.search).get('import') === 'planner') {
        importPlannerDraft();
        historyObject.replaceState({}, '', locationObject.pathname);
      } else if (initializeDraft) createStandaloneDraft();
    } catch (error) {
      setStatus(error.message || 'Could not initialize saved games.', true);
      if (initializeDraft) createStandaloneDraft();
    }
  })();

  return {
    ready,
    openGame,
    refreshGames: renderGames,
    syncGame(game) {
      if (draft?.id !== game.id) return;
      draft.events = structuredClone(game.events);
      draft.videoStartSeconds = game.video.startSeconds;
      draft.videoEndSeconds = game.video.endSeconds;
      draft.createdAt = game.createdAt;
    },
  };
}
