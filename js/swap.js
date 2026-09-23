// Manual swap mode: click an on-court player then a benched player (or vice
// versa) within the same time block to trade them, plus undo/redo history
// for those swaps.

let swapModeActive = false;
let swapSelection = null; // { blockIndex, playerId, status: 'on' | 'off' }

// Undo/redo for manual swaps only (not for Generate/Regenerate — those
// intentionally produce a brand-new rotation and start a fresh history).
// Each entry is a serializable snapshot (player ids + minutes) of the
// rotation immediately before a swap was applied, so it survives even
// though `lastRotation.result` holds live player object references.
const MAX_SWAP_HISTORY = 50;
let swapHistory = [];
let swapFuture = [];

// Trades a single time block between an on-court player and a benched
// player, mutating the rotation in place. Returns false (no-op) if either
// player can't be found in the expected role for that block.
function applySwap(rotation, blockIndex, onCourtId, benchId) {
  const block = rotation.result[blockIndex];
  if (!block) return false;
  const lineupIdx = block.lineup.findIndex(p => p.id === onCourtId);
  const benchIdx = block.bench.findIndex(p => p.id === benchId);
  if (lineupIdx === -1 || benchIdx === -1) return false;
  const onPlayer = block.lineup[lineupIdx];
  const benchPlayer = block.bench[benchIdx];
  block.lineup[lineupIdx] = benchPlayer;
  block.bench[benchIdx] = onPlayer;
  rotation.minutes[onPlayer.id] -= rotation.blockMinutes;
  rotation.minutes[benchPlayer.id] += rotation.blockMinutes;
  return true;
}

// Captures just enough to reconstruct rotation.result/minutes later (player
// ids rather than object references, so it's cheap to clone and stays valid
// even if the roster array is later replaced).
function snapshotRotation(rotation) {
  return {
    blocks: rotation.result.map(b => ({ lineup: b.lineup.map(p => p.id), bench: b.bench.map(p => p.id) })),
    minutes: { ...rotation.minutes },
  };
}

function applyRotationSnapshot(rotation, players, snapshot) {
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  rotation.result = snapshot.blocks.map(b => ({
    lineup: b.lineup.map(id => byId[id]),
    bench: b.bench.map(id => byId[id]),
  }));
  rotation.minutes = { ...snapshot.minutes };
}

function resetSwapHistory() {
  swapHistory = [];
  swapFuture = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoSwapBtn.disabled = swapHistory.length === 0;
  redoSwapBtn.disabled = swapFuture.length === 0;
}

function setSwapMode(active) {
  swapModeActive = active;
  swapSelection = null;
  swapModeBtn.classList.toggle('active', active);
  swapModeBtn.setAttribute('aria-pressed', String(active));
  swapHint.classList.toggle('hidden', !active);
  timelineGrid.classList.toggle('swap-active', active);
}

swapModeBtn.addEventListener('click', () => {
  if (!lastRotation) return;
  setSwapMode(!swapModeActive);
});

timelineGrid.addEventListener('click', (e) => {
  if (!swapModeActive) return;
  const cell = e.target.closest('.timeline-cell');
  if (!cell || !cell.dataset.player) return;
  const blockIndex = Number(cell.dataset.block);
  const playerId = cell.dataset.player;
  const status = cell.dataset.status;

  if (swapSelection && swapSelection.blockIndex === blockIndex && swapSelection.playerId === playerId) {
    // Clicking the same cell again just deselects it.
    swapSelection = null;
    highlightSwapSelection();
    return;
  }

  if (swapSelection && swapSelection.blockIndex === blockIndex && swapSelection.status !== status) {
    const onCourtId = status === 'on' ? playerId : swapSelection.playerId;
    const benchId = status === 'off' ? playerId : swapSelection.playerId;
    const beforeSwap = snapshotRotation(lastRotation);
    const swapped = applySwap(lastRotation, blockIndex, onCourtId, benchId);
    swapSelection = null;
    if (swapped) {
      swapHistory.push(beforeSwap);
      if (swapHistory.length > MAX_SWAP_HISTORY) swapHistory.shift();
      swapFuture = [];
      updateUndoRedoButtons();
      renderRotation(lastRotation, lastPlayers);
      setSwapMode(true); // renderRotation rebuilds the grid; keep swap mode visibly on
      persistRotation();
    } else {
      highlightSwapSelection();
    }
    return;
  }

  // Different block, or same status as the current selection — restart the
  // selection with the newly clicked cell instead of leaving the user stuck.
  swapSelection = { blockIndex, playerId, status };
  highlightSwapSelection();
});

function highlightSwapSelection() {
  timelineGrid.querySelectorAll('.timeline-cell.swap-selected').forEach(el => el.classList.remove('swap-selected'));
  if (!swapSelection) return;
  const sel = timelineGrid.querySelector(`.timeline-cell[data-block="${swapSelection.blockIndex}"][data-player="${swapSelection.playerId}"]`);
  if (sel) sel.classList.add('swap-selected');
}

undoSwapBtn.addEventListener('click', () => {
  if (!lastRotation || !lastPlayers || swapHistory.length === 0) return;
  swapFuture.push(snapshotRotation(lastRotation));
  const previous = swapHistory.pop();
  applyRotationSnapshot(lastRotation, lastPlayers, previous);
  updateUndoRedoButtons();
  renderRotation(lastRotation, lastPlayers);
  if (swapModeActive) setSwapMode(true);
  persistRotation();
});

redoSwapBtn.addEventListener('click', () => {
  if (!lastRotation || !lastPlayers || swapFuture.length === 0) return;
  swapHistory.push(snapshotRotation(lastRotation));
  const next = swapFuture.pop();
  applyRotationSnapshot(lastRotation, lastPlayers, next);
  updateUndoRedoButtons();
  renderRotation(lastRotation, lastPlayers);
  if (swapModeActive) setSwapMode(true);
  persistRotation();
});

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (!(e.ctrlKey || e.metaKey) || key !== 'z') return;
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (!lastRotation) return;
  if (e.shiftKey) {
    if (!redoSwapBtn.disabled) { e.preventDefault(); redoSwapBtn.click(); }
  } else if (!undoSwapBtn.disabled) {
    e.preventDefault();
    undoSwapBtn.click();
  }
});
