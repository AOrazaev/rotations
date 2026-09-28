// Top-level wiring: generate/regenerate actions, roster/settings controls,
// and the final page bootstrap. Loaded last since the bootstrap calls at the
// bottom depend on every other file already being defined.

function generate() {
  state.blockMinutes = Number(document.querySelector('#blockMinutes').value);
  state.intensity = Number(document.querySelector('#intensity').value);
  saveState();
  const players = state.players.filter(p=>p.present);
  try {
    lastRotation = buildRotation(players, state.blockMinutes, state.intensity);
    resetSwapHistory();
    renderRotation(lastRotation, players);
    setSwapMode(false);
    seedInput.value = '';
    lastSeed = null;
    persistRotation();
    rotationCard.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (e) { alert(e.message); }
}

function applySeed(seed, players) {
  const rng = createSeededRng(seed);
  lastRotation = buildRotation(players, state.blockMinutes, state.intensity, rng);
  resetSwapHistory();
  renderRotation(lastRotation, players);
  setSwapMode(false);
  seedInput.value = String(seed);
  lastSeed = seed;
  persistRotation();
}

document.querySelector('#addPlayer').addEventListener('click', () => {
  state.players.push({ id: crypto.randomUUID(), name:'New player', number:'', positions:['F'], skill:60, present:true, minMinutes:null, maxMinutes:null, maxConsecutiveBlocks:null });
  saveState(); renderRoster();
});
document.querySelector('#startStatsReview').addEventListener('click', () => {
  const players = state.players.filter(player => player.present).map(player => ({
    id: player.id,
    name: player.name,
    number: player.number || '',
    positions: [...player.positions],
    skill: player.skill,
  }));
  if (players.length < 5) {
    alert('Select at least 5 available players before starting a stats review.');
    return;
  }
  const playerIds = new Set(players.map(player => player.id));
  const plannedRotation = lastRotation && lastRotation.result.every(block =>
    block.lineup.length === 5 && block.lineup.every(player => playerIds.has(player.id))
  ) ? {
    blockMinutes: lastRotation.blockMinutes,
    blocks: lastRotation.result.map(block => ({
      lineupIds: block.lineup.map(player => player.id),
    })),
  } : null;
  localStorage.setItem('basketball-stats-handoff-v1', JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    players,
    plannedRotation,
  }));
  window.location.href = 'stats/?import=planner';
});
document.querySelector('#generate').addEventListener('click', generate);
document.querySelector('#blockMinutes').value = String(state.blockMinutes || 4);
const intensityInput = document.querySelector('#intensity');
const intensityValueEl = document.querySelector('#intensityValue');
intensityInput.value = String(state.intensity ?? 100);
intensityValueEl.textContent = intensityLabel(Number(intensityInput.value));
intensityInput.addEventListener('input', () => {
  intensityValueEl.textContent = intensityLabel(Number(intensityInput.value));
});
document.querySelector('#resetApp').addEventListener('click', () => {
  if (!confirm('Reset roster and settings to defaults?')) return;
  localStorage.removeItem(STORAGE_KEY); state = { players: defaultPlayers.map(p=>({...p,id:crypto.randomUUID()})), blockMinutes:4, intensity:100, rosterCompact:true }; saveState(); renderRoster(); setRosterMode(true);
  intensityInput.value = '100'; intensityValueEl.textContent = intensityLabel(100);
  lastRotation = null; lastPlayers = null; lastSeed = null;
  resetSwapHistory();
  setSwapMode(false);
  rotationCard.classList.add('hidden'); seedInput.value = '';
});
document.querySelector('#regenerateRotation').addEventListener('click', () => {
  if (!lastRotation) return;
  const players = state.players.filter(p=>p.present);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  try { applySeed(seed, players); } catch (e) { alert(e.message); }
});
seedInput.addEventListener('change', () => {
  if (!lastRotation) return;
  const value = Math.floor(Number(seedInput.value));
  if (!Number.isFinite(value)) return;
  const players = state.players.filter(p=>p.present);
  try { applySeed(value, players); } catch (e) { alert(e.message); }
});

renderRoster();
setRosterMode(state.rosterCompact !== false);
restoreRotation();
