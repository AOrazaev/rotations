// App state: the roster/settings model, localStorage persistence, and
// restoring a previously-generated rotation (including any manual swaps)
// on reload.

const STORAGE_KEY = 'basketball-rotation-planner-v1';

const defaultPlayers = [
  { id: crypto.randomUUID(), name: 'Dmytro', number: '13', positions: ['F','G'], skill: 80, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Aman', number: '7', positions: ['F','G'], skill: 70, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Bohdan', number: '27', positions: ['C','F'], skill: 90, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Denis', number: '50', positions: ['F'], skill: 70, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Anatoly', number: '3', positions: ['G'], skill: 50, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Bek', number: '40', positions: ['G'], skill: 50, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Vlad', number: '5', positions: ['C','F','G'], skill: 75, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Valya', number: '60', positions: ['F','G'], skill: 70, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Yedil', number: '70', positions: ['C'], skill: 70, present: true, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Nikita', number: '', positions: ['F','G'], skill: 95, present: false, minMinutes: null, maxMinutes: null },
  { id: crypto.randomUUID(), name: 'Anton', number: '1', positions: ['C'], skill: 70, present: false, minMinutes: null, maxMinutes: null },
];

const LEGACY_MODE_INTENSITY = { equal: 0, balanced: 50, competitive: 100 };

let state = loadState();
let lastRotation = null;
let lastPlayers = null;
let lastSeed = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.players?.length) {
      if (typeof saved.intensity !== 'number') {
        saved.intensity = LEGACY_MODE_INTENSITY[saved.mode] ?? 100;
      }
      delete saved.mode;
      if (typeof saved.rosterCompact !== 'boolean') saved.rosterCompact = true;
      saved.players.forEach(p => {
        if (typeof p.number !== 'string') p.number = '';
        if (typeof p.minMinutes !== 'number') p.minMinutes = null;
        if (typeof p.maxMinutes !== 'number') p.maxMinutes = null;
      });
      return saved;
    }
  } catch (_) {}
  return { players: defaultPlayers.map(p => ({ ...p, id: crypto.randomUUID() })), blockMinutes: 4, intensity: 100, rosterCompact: true };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Persist just enough to reconstruct the currently-displayed rotation on
// reload: buildRotation() is a pure function of (players, blockMinutes,
// intensity, rng), so we only need the player snapshot it was built from,
// the settings, the seed (if any), and which tab was active. We additionally
// snapshot the actual per-block lineup/bench (as player ids) so that manual
// swaps - which make the rendered rotation diverge from what buildRotation()
// would produce - also survive a reload.
function persistRotation() {
  if (lastRotation && lastPlayers) {
    state.rotation = {
      players: lastPlayers,
      blockMinutes: lastRotation.blockMinutes,
      intensity: state.intensity,
      seed: lastSeed,
      blocks: lastRotation.result.map(b => ({
        lineup: b.lineup.map(p => p.id),
        bench: b.bench.map(p => p.id),
      })),
    };
  } else {
    delete state.rotation;
  }
  saveState();
}

function computeMinutes(resultBlocks, players, blockMinutes) {
  const counts = Object.fromEntries(players.map(p => [p.id, 0]));
  resultBlocks.forEach(block => block.lineup.forEach(p => { counts[p.id]++; }));
  return Object.fromEntries(players.map(p => [p.id, counts[p.id] * blockMinutes]));
}

function restoreRotation() {
  const saved = state.rotation;
  if (!saved || !Array.isArray(saved.players) || saved.players.length < 5) return;
  try {
    const rng = saved.seed != null ? createSeededRng(saved.seed) : undefined;
    const rotation = buildRotation(saved.players, saved.blockMinutes, saved.intensity, rng);

    // If we have a saved per-block snapshot that still matches this
    // rotation's shape (same block count, all player ids resolvable —
    // i.e. the roster used to build it hasn't changed), prefer it: it
    // carries any manual swaps the algorithm alone wouldn't reproduce.
    if (Array.isArray(saved.blocks) && saved.blocks.length === rotation.result.length) {
      const byId = Object.fromEntries(saved.players.map(p => [p.id, p]));
      const expectedLineupSize = rotation.result[0] ? rotation.result[0].lineup.length : 5;
      const rebuilt = saved.blocks.map(b => ({
        lineup: (b.lineup || []).map(id => byId[id]),
        bench: (b.bench || []).map(id => byId[id]),
      }));
      // Every player must appear in exactly one of lineup/bench per block -
      // guards against corrupted snapshots (e.g. a player duplicated across
      // both, or missing entirely) that would otherwise be trusted as-is.
      const valid = rebuilt.every(b => {
        if (b.lineup.length !== expectedLineupSize) return false;
        if (!b.lineup.every(Boolean) || !b.bench.every(Boolean)) return false;
        const ids = [...b.lineup, ...b.bench].map(p => p.id);
        return ids.length === saved.players.length && new Set(ids).size === ids.length;
      });
      if (valid) {
        rotation.result = rebuilt;
        rotation.minutes = computeMinutes(rotation.result, saved.players, saved.blockMinutes);
      }
    }

    lastRotation = rotation;
    lastSeed = saved.seed ?? null;
    resetSwapHistory();
    renderRotation(lastRotation, saved.players);
    seedInput.value = lastSeed != null ? String(lastSeed) : '';
  } catch (_) {
    // Stale/incompatible saved rotation (e.g. algorithm changed) - drop it
    // rather than fail silently on every future load.
    delete state.rotation;
    saveState();
  }
}
