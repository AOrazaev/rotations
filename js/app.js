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
  state.players.push({ id: crypto.randomUUID(), name:'New player', number:'', positions:['F'], skill:60, present:true, minMinutes:null, maxMinutes:null });
  saveState(); renderRoster();
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
