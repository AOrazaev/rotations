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

const rosterEl = document.querySelector('#roster');
const playerTemplate = document.querySelector('#playerTemplate');
const rotationCard = document.querySelector('#rotationCard');
const minutesGrid = document.querySelector('#minutesGrid');
const summary = document.querySelector('#rotationSummary');
const timelineGrid = document.querySelector('#timelineGrid');
const seedInput = document.querySelector('#regenerateSeed');
const rosterCompactTab = document.querySelector('#rosterCompactTab');
const rosterEditTab = document.querySelector('#rosterEditTab');
const addPlayerBtn = document.querySelector('#addPlayer');
const swapModeBtn = document.querySelector('#swapMode');
const swapHint = document.querySelector('#swapHint');

let swapModeActive = false;
let swapSelection = null; // { blockIndex, playerId, status: 'on' | 'off' }

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
      const valid = rebuilt.every(b =>
        b.lineup.length === expectedLineupSize &&
        b.lineup.every(Boolean) &&
        b.bench.every(Boolean));
      if (valid) {
        rotation.result = rebuilt;
        rotation.minutes = computeMinutes(rotation.result, saved.players, saved.blockMinutes);
      }
    }

    lastRotation = rotation;
    lastSeed = saved.seed ?? null;
    renderRotation(lastRotation, saved.players);
    seedInput.value = lastSeed != null ? String(lastSeed) : '';
  } catch (_) {
    // Stale/incompatible saved rotation (e.g. algorithm changed) - drop it
    // rather than fail silently on every future load.
    delete state.rotation;
    saveState();
  }
}

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

function renderRoster() {
  rosterEl.innerHTML = '';
  for (const player of state.players) {
    const node = playerTemplate.content.firstElementChild.cloneNode(true);
    const present = node.querySelector('.present');
    const jersey = node.querySelector('.jersey');
    const name = node.querySelector('.name');
    const skill = node.querySelector('.skill');
    const skillValue = node.querySelector('.skill-value');
    const posBoxes = [...node.querySelectorAll('.positions input')];
    const minMinutes = node.querySelector('.min-minutes');
    const maxMinutes = node.querySelector('.max-minutes');
    const compactJersey = node.querySelector('.compact-jersey');
    const nameText = node.querySelector('.name-text');

    present.checked = !!player.present;
    node.classList.toggle('chip-off', !present.checked);
    jersey.value = player.number || '';
    name.value = player.name;
    nameText.textContent = player.name;
    compactJersey.textContent = player.number || '';
    skill.value = player.skill;
    skillValue.textContent = player.skill;
    posBoxes.forEach(box => box.checked = player.positions.includes(box.value));
    minMinutes.value = player.minMinutes ?? '';
    maxMinutes.value = player.maxMinutes ?? '';

    const update = () => {
      player.present = present.checked;
      node.classList.toggle('chip-off', !present.checked);
      player.number = jersey.value.replace(/[^0-9]/g, '').slice(0, 3);
      jersey.value = player.number;
      compactJersey.textContent = player.number;
      player.name = name.value.trim() || 'Unnamed';
      nameText.textContent = player.name;
      player.skill = Number(skill.value);
      player.positions = posBoxes.filter(x => x.checked).map(x => x.value);
      skillValue.textContent = player.skill;
      player.minMinutes = minMinutes.value === '' ? null : Math.max(0, Number(minMinutes.value));
      player.maxMinutes = maxMinutes.value === '' ? null : Math.max(0, Number(maxMinutes.value));
      saveState();
    };

    present.addEventListener('change', update);
    jersey.addEventListener('input', update);
    name.addEventListener('input', update);
    skill.addEventListener('input', update);
    posBoxes.forEach(box => box.addEventListener('change', update));
    minMinutes.addEventListener('input', update);
    maxMinutes.addEventListener('input', update);
    node.querySelector('.delete').addEventListener('click', () => {
      state.players = state.players.filter(p => p.id !== player.id);
      saveState();
      renderRoster();
    });

    node.tabIndex = 0;
    node.addEventListener('click', (e) => {
      if (!state.rosterCompact) return;
      present.checked = !present.checked;
      update();
    });
    node.addEventListener('keydown', (e) => {
      if (!state.rosterCompact) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        present.checked = !present.checked;
        update();
      }
    });

    rosterEl.appendChild(node);
  }
}

function combinations(arr, k) {
  const out = [];
  const rec = (start, combo) => {
    if (combo.length === k) { out.push(combo.slice()); return; }
    for (let i = start; i <= arr.length - (k - combo.length); i++) {
      combo.push(arr[i]); rec(i + 1, combo); combo.pop();
    }
  };
  rec(0, []);
  return out;
}

function hasRole(lineup, role) { return lineup.some(p => p.positions.includes(role)); }
function avgSkill(lineup) { return lineup.reduce((s,p)=>s+p.skill,0)/lineup.length; }

function createSeededRng(seed) {
  // mulberry32 — small, fast, deterministic PRNG so a given seed always
  // reproduces the exact same "randomized" rotation.
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// rng is optional: omitted => strict greedy/deterministic (used by the main
// "Generate rotation" button). Provided => at each block, sample randomly
// among the top-scoring candidate lineups instead of always taking the
// single best one, so "Regenerate" can offer different, still-solid results.
const REGENERATE_TOP_K = 3;

function buildRotation(players, blockMinutes, intensity, rng) {
  if (players.length < 5) throw new Error('You need at least 5 available players.');
  const totalMinutes = 40;
  const blocks = Math.ceil(totalMinutes / blockMinutes);
  const combos = combinations(players, 5);
  const playedBlocks = Object.fromEntries(players.map(p => [p.id, 0]));
  const consecutive = Object.fromEntries(players.map(p => [p.id, 0]));
  const lastPlayed = Object.fromEntries(players.map(p => [p.id, -99]));
  const result = [];

  // Convert each player's optional minute floor/ceiling into block counts.
  // Unset min => 0 (no floor). Unset max => blocks (no ceiling).
  const minBlocks = {};
  const maxBlocks = {};
  for (const p of players) {
    const rawMin = Number(p.minMinutes);
    const rawMax = Number(p.maxMinutes);
    minBlocks[p.id] = (p.minMinutes != null && p.minMinutes !== '' && Number.isFinite(rawMin) && rawMin > 0)
      ? Math.min(blocks, Math.round(rawMin / blockMinutes))
      : 0;
    maxBlocks[p.id] = (p.maxMinutes != null && p.maxMinutes !== '' && Number.isFinite(rawMax))
      ? Math.max(0, Math.min(blocks, Math.round(rawMax / blockMinutes)))
      : blocks;
    if (minBlocks[p.id] > maxBlocks[p.id]) {
      throw new Error(`${p.name}: minimum minutes can't exceed maximum minutes.`);
    }
  }
  const totalSlots = blocks * 5;
  const sumMin = players.reduce((s, p) => s + minBlocks[p.id], 0);
  const sumMax = players.reduce((s, p) => s + maxBlocks[p.id], 0);
  if (sumMin > totalSlots) {
    throw new Error('Total minimum minutes across players exceed the available playing time. Lower some minimums.');
  }
  if (sumMax < totalSlots) {
    throw new Error('Maximum minute limits leave too little playing time to fill every lineup slot. Raise some maximums.');
  }

  const skills = players.map(p=>p.skill);
  const minSkill = Math.min(...skills), maxSkill = Math.max(...skills);
  const norm = p => maxSkill === minSkill ? 0.5 : (p.skill-minSkill)/(maxSkill-minSkill);

  // t=0 => Equal minutes, t=1 => fully Competitive. Balanced sits at t=0.5.
  // Target shares are soft constraints, not exact minute contracts.
  const t = Math.min(1, Math.max(0, (Number(intensity) || 0) / 100));
  const weightBase = 1 - 0.45 * t;
  const weightSpread = 0.9 * t;
  const skillMultiplier = 0.45 + 1.05 * t;
  const weights = Object.fromEntries(players.map(p => [p.id, weightBase + weightSpread * norm(p)]));

  const totalWeight = Object.values(weights).reduce((a,b)=>a+b,0);
  const targetBlocks = Object.fromEntries(players.map(p => [p.id, (blocks*5)*(weights[p.id]/totalWeight)]));

  for (let b=0; b<blocks; b++) {
    const closing = b === blocks-1;
    const remaining = blocks - b; // blocks left, including this one

    // Hard max: once a player has hit their ceiling, they can't appear again.
    const cappedOut = new Set(players.filter(p => playedBlocks[p.id] >= maxBlocks[p.id]).map(p => p.id));
    const eligibleCount = players.length - cappedOut.size;
    if (eligibleCount < 5) {
      throw new Error(`Not enough eligible players for block ${b + 1} — too many players have reached their maximum minutes at the same time. Raise some maximums or relax the constraints.`);
    }

    // Hard min: if a player's remaining minimum equals the blocks left, they
    // must play from now until the end of the game or they'll miss their floor.
    const forced = players.filter(p => {
      if (cappedOut.has(p.id)) return false;
      const needed = minBlocks[p.id] - playedBlocks[p.id];
      return needed > 0 && needed >= remaining;
    });
    if (forced.length > 5) {
      throw new Error(`Minimum-minute requirements for ${forced.map(p => p.name).join(', ')} all come due in the same time block — lower some minimums or spread them out.`);
    }

    let eligibleCombos = combos.filter(lineup => lineup.every(p => !cappedOut.has(p.id)));
    if (forced.length) {
      eligibleCombos = eligibleCombos.filter(lineup => {
        const ids = new Set(lineup.map(p => p.id));
        return forced.every(p => ids.has(p.id));
      });
    }
    if (!eligibleCombos.length) {
      throw new Error(`Couldn't find a valid lineup for block ${b + 1} given the current minute limits — try relaxing them.`);
    }

    const scored = [];

    for (const lineup of eligibleCombos) {
      let score = 0;
      const ids = new Set(lineup.map(p=>p.id));
      const skillScore = lineup.reduce((s,p)=>s+p.skill,0);
      score += skillScore * skillMultiplier;

      if (hasRole(lineup,'C')) score += 26; else score -= 55;
      if (hasRole(lineup,'G')) score += 18; else score -= 40;
      if (hasRole(lineup,'F')) score += 8;

      const weakGuards = lineup.filter(p => p.positions.length===1 && p.positions.includes('G') && p.skill <= 55).length;
      if (weakGuards >= 2) score -= 30;

      for (const p of players) {
        const deficit = targetBlocks[p.id] - playedBlocks[p.id];
        if (ids.has(p.id)) {
          score += deficit * 11;
          if (consecutive[p.id] >= 2) score -= consecutive[p.id] * 12;
          if (b - lastPlayed[p.id] > 1) score += 10;
        } else {
          if (consecutive[p.id] >= 2) score += 14;
          if (b - lastPlayed[p.id] >= 2) score -= 8;
        }
      }

      if (closing) {
        score += skillScore * 2.2 * t;
        if (hasRole(lineup,'C') && hasRole(lineup,'G')) score += 30 * t;
      }

      // Reduce excessive lineup repetition.
      if (result.length) {
        const overlap = result[result.length-1].lineup.filter(p=>ids.has(p.id)).length;
        if (overlap === 5) score -= 35;
      }

      scored.push({ lineup, score });
    }

    // Stable sort keeps the original (deterministic) winner at index 0 when
    // there's no rng, matching the previous strict-greedy behavior exactly.
    scored.sort((a, b) => b.score - a.score);
    const best = rng
      ? scored[Math.floor(rng() * Math.min(REGENERATE_TOP_K, scored.length))].lineup
      : scored[0].lineup;

    const ids = new Set(best.map(p=>p.id));
    players.forEach(p => {
      if (ids.has(p.id)) {
        playedBlocks[p.id]++;
        consecutive[p.id]++;
        lastPlayed[p.id] = b;
      } else consecutive[p.id] = 0;
    });
    result.push({ lineup: best, bench: players.filter(p=>!ids.has(p.id)) });
  }

  const minutes = Object.fromEntries(players.map(p => [p.id, playedBlocks[p.id]*blockMinutes]));
  return { result, minutes, blocks, blockMinutes };
}

function blockLabel(i, blockMinutes) {
  const minuteIntoGame = i * blockMinutes;
  const half = minuteIntoGame < 20 ? 1 : 2;
  const intoHalf = minuteIntoGame % 20;
  const start = 20 - intoHalf;
  const end = Math.max(0, start - blockMinutes);
  return `H${half} ${start}:00–${end}:00`;
}

function computeSubs(prevBlock, currBlock) {
  const prevIds = new Set(prevBlock.lineup.map(p => p.id));
  const currIds = new Set(currBlock.lineup.map(p => p.id));
  const out = prevBlock.lineup.filter(p => !currIds.has(p.id));
  const inn = currBlock.lineup.filter(p => !prevIds.has(p.id));
  return { out, inn };
}

// Pairs each incoming player with an outgoing player at the same transition
// (by array order — lineup counts always match, so every "in" gets an "out").
// Used to label "who this player is subbing in for" on the timeline.
function buildSubLookup(rotation) {
  const lookup = new Map();
  for (let i = 1; i < rotation.result.length; i++) {
    const { out, inn } = computeSubs(rotation.result[i - 1], rotation.result[i]);
    inn.forEach((inPlayer, idx) => {
      const outPlayer = out[idx];
      if (outPlayer) lookup.set(`${i}:${inPlayer.id}`, outPlayer);
    });
  }
  return lookup;
}

function renderRotation(rotation, players) {
  const sorted = [...players].sort((a,b)=>rotation.minutes[b.id]-rotation.minutes[a.id] || b.skill-a.skill);
  minutesGrid.innerHTML = sorted.map(p => `<div class="minute-card"><strong>${playerLabelHtml(p)}</strong><span>${rotation.minutes[p.id]} min</span></div>`).join('');
  summary.textContent = `${players.length} players · ${rotation.blockMinutes}-minute blocks · ${intensityLabel(state.intensity)}`;
  renderTimeline(rotation, players);
  lastPlayers = players;
  rotationCard.classList.remove('hidden');
}

function halfForBlock(i, blockMinutes) {
  return (i * blockMinutes) < 20 ? 1 : 2;
}

function shortBlockHeader(i, blockMinutes) {
  const minuteIntoGame = i * blockMinutes;
  const half = halfForBlock(i, blockMinutes);
  const intoHalf = minuteIntoGame % 20;
  const start = 20 - intoHalf;
  const end = Math.max(0, start - blockMinutes);
  return { half, label: `${start}-${end}` };
}

function renderTimeline(rotation, players) {
  const blocks = rotation.result.length;
  const sorted = [...players].sort((a,b)=>rotation.minutes[b.id]-rotation.minutes[a.id] || b.skill-a.skill);
  const subLookup = buildSubLookup(rotation);

  timelineGrid.style.gridTemplateColumns = `160px repeat(${blocks}, minmax(34px, 1fr))`;

  let html = '<div class="timeline-header-cell"></div>';
  for (let i = 0; i < blocks; i++) {
    const { half, label } = shortBlockHeader(i, rotation.blockMinutes);
    const prevHalf = i > 0 ? halfForBlock(i - 1, rotation.blockMinutes) : half;
    const dividerClass = (i > 0 && half !== prevHalf) ? ' timeline-half-divider' : '';
    html += `<div class="timeline-header-cell${dividerClass}">H${half}<br>${label}</div>`;
  }

  sorted.forEach(p => {
    html += `<div class="timeline-row-label"><span>${playerLabelSupHtml(p)}</span><span class="tl-minutes">${rotation.minutes[p.id]}m</span></div>`;
    for (let i = 0; i < blocks; i++) {
      const on = rotation.result[i].lineup.some(x => x.id === p.id);
      const prevOn = i > 0 && rotation.result[i - 1].lineup.some(x => x.id === p.id);
      const nextOn = i < blocks - 1 && rotation.result[i + 1].lineup.some(x => x.id === p.id);
      const half = halfForBlock(i, rotation.blockMinutes);
      const prevHalf = i > 0 ? halfForBlock(i - 1, rotation.blockMinutes) : half;
      let cls = 'timeline-cell';
      let label = '';
      if (on) {
        cls += ' on';
        if (!prevOn) {
          cls += ' run-start';
          const subOutPlayer = i > 0 ? subLookup.get(`${i}:${p.id}`) : null;
          if (subOutPlayer) label = `<span class="sub-label">🔄 ${playerLabelSupHtml(subOutPlayer)}</span>`;
        }
        if (!nextOn) cls += ' run-end';
      }
      if (i > 0 && half !== prevHalf) cls += ' timeline-half-divider';
      const subOutPlayerForTitle = on && !prevOn && i > 0 ? subLookup.get(`${i}:${p.id}`) : null;
      const titleText = `${playerLabel(p)} — ${blockLabel(i, rotation.blockMinutes)} — ${on ? 'On court' : 'Bench'}${subOutPlayerForTitle ? ` (in for ${playerLabel(subOutPlayerForTitle)})` : ''}`;
      html += `<div class="${cls}" title="${escapeHtml(titleText)}" data-block="${i}" data-player="${p.id}" data-status="${on ? 'on' : 'off'}">${label}</div>`;
    }
  });

  timelineGrid.innerHTML = html;
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
    const swapped = applySwap(lastRotation, blockIndex, onCourtId, benchId);
    swapSelection = null;
    if (swapped) {
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

function setRosterMode(compact) {
  state.rosterCompact = compact;
  saveState();
  rosterEl.classList.toggle('compact', compact);
  addPlayerBtn.classList.toggle('hidden', compact);
  rosterCompactTab.classList.toggle('active', compact);
  rosterEditTab.classList.toggle('active', !compact);
  rosterCompactTab.setAttribute('aria-selected', String(compact));
  rosterEditTab.setAttribute('aria-selected', String(!compact));
}

rosterCompactTab.addEventListener('click', () => setRosterMode(true));
rosterEditTab.addEventListener('click', () => setRosterMode(false));

function intensityLabel(v) {
  if (v <= 10) return 'Equal minutes';
  if (v >= 90) return 'Competitive';
  if (v < 40) return `Mostly equal (${v}%)`;
  if (v > 60) return `Mostly competitive (${v}%)`;
  return `Balanced (${v}%)`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

// Plain-text label (used in canvas exports / clipboard text): "#12 Name" or "Name".
function playerLabel(p) {
  return p.number ? `#${p.number} ${p.name}` : p.name;
}

// HTML label with a styled jersey-number badge (used in on-page DOM rendering).
function playerLabelHtml(p) {
  const badge = p.number ? `<span class="jersey-badge">${escapeHtml(p.number)}</span>` : '';
  return `${badge}${escapeHtml(p.name)}`;
}

// Compact HTML label: jersey number as a superscript (no "#"), for the
// space-constrained timeline view (row labels, sub-in tags).
function playerLabelSupHtml(p) {
  const sup = p.number ? `<sup class="jersey-sup">${escapeHtml(p.number)}</sup>` : '';
  return `${escapeHtml(p.name)}${sup}`;
}

const SUPERSCRIPT_DIGITS = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };

// Plain-text label with the jersey number rendered as superscript Unicode
// digits (no "#") — used where a single fillText/string is needed, e.g. the
// canvas timeline's clipped sub-in labels.
function playerLabelSupText(p) {
  if (!p.number) return p.name;
  const sup = String(p.number).split('').map(d => SUPERSCRIPT_DIGITS[d] || d).join('');
  return `${p.name}${sup}`;
}

function generate() {
  state.blockMinutes = Number(document.querySelector('#blockMinutes').value);
  state.intensity = Number(document.querySelector('#intensity').value);
  saveState();
  const players = state.players.filter(p=>p.present);
  try {
    lastRotation = buildRotation(players, state.blockMinutes, state.intensity);
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

// --- Rotation-as-image export -----------------------------------------
// Draws the rotation timeline + minutes grid onto a plain <canvas> using the
// in-memory rotation data (no DOM screenshot library needed), then either
// copies the resulting PNG to the clipboard or falls back to a download.

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderTimelineCanvas(rotation, players) {
  const theme = {
    bg: '#0b1020', card: '#121a2b', line: '#26324b',
    text: '#f6f7fb', muted: '#91a0b8', rowAlt: '#0f1727', accent: '#6d7cff', accent2: '#8290ff',
  };
  const fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const titleFont = `700 22px ${fontFamily}`;
  const subFont = `400 13px ${fontFamily}`;
  const labelFont = `650 14px ${fontFamily}`;
  const minutesFont = `500 12px ${fontFamily}`;
  const headerFont = `600 11px ${fontFamily}`;
  const subLabelFont = `600 9px ${fontFamily}`;
  const subLookup = buildSubLookup(rotation);

  const scale = 2;
  const padding = 28;
  const labelColWidth = 160;
  const blocks = rotation.result.length;
  const cellWidth = Math.max(34, Math.min(60, 720 / blocks));
  const width = padding * 2 + labelColWidth + cellWidth * blocks;

  const titleTop = padding;
  const headerTop = titleTop + 54;
  const headerHeight = 34;
  const rowHeight = 26;
  const rowGap = 8;
  const gridTop = headerTop + headerHeight + 8;

  const sorted = [...players].sort((a, b) => rotation.minutes[b.id] - rotation.minutes[a.id] || b.skill - a.skill);
  const totalHeight = gridTop + sorted.length * (rowHeight + rowGap) + padding;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(totalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'top';

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, totalHeight);
  roundRect(ctx, 6, 6, width - 12, totalHeight - 12, 16);
  ctx.fillStyle = theme.card;
  ctx.fill();

  ctx.fillStyle = theme.text;
  ctx.font = titleFont;
  ctx.fillText('Rotation timeline', padding, titleTop);
  ctx.font = subFont;
  ctx.fillStyle = theme.muted;
  ctx.fillText(summary.textContent || '', padding, titleTop + 30);

  // Column headers
  for (let i = 0; i < blocks; i++) {
    const { half, label } = shortBlockHeader(i, rotation.blockMinutes);
    const prevHalf = i > 0 ? halfForBlock(i - 1, rotation.blockMinutes) : half;
    const x = padding + labelColWidth + i * cellWidth;
    if (i > 0 && half !== prevHalf) {
      ctx.strokeStyle = theme.accent2;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, headerTop); ctx.lineTo(x, totalHeight - padding); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.font = headerFont;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.fillText(`H${half}`, x + cellWidth / 2, headerTop);
    ctx.fillText(label, x + cellWidth / 2, headerTop + 14);
    ctx.textAlign = 'left';
  }

  sorted.forEach((p, rowIdx) => {
    const rowY = gridTop + rowIdx * (rowHeight + rowGap);
    ctx.font = labelFont;
    ctx.fillStyle = theme.text;
    ctx.fillText(p.name, padding, rowY + 6);
    if (p.number) {
      const nameWidth = ctx.measureText(p.name).width;
      ctx.font = `800 10px ${fontFamily}`;
      ctx.fillStyle = theme.muted;
      ctx.fillText(p.number, padding + nameWidth + 2, rowY + 2);
    }
    ctx.font = minutesFont;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`${rotation.minutes[p.id]}m`, padding + labelColWidth - 12, rowY + 7);
    ctx.textAlign = 'left';

    // Row background track
    roundRect(ctx, padding + labelColWidth, rowY, cellWidth * blocks - 2, rowHeight, 6);
    ctx.fillStyle = theme.rowAlt;
    ctx.fill();

    // Draw contiguous "on court" runs as single rounded bars
    let runStart = null;
    for (let i = 0; i <= blocks; i++) {
      const on = i < blocks && rotation.result[i].lineup.some(x => x.id === p.id);
      if (on && runStart === null) runStart = i;
      if (!on && runStart !== null) {
        const x = padding + labelColWidth + runStart * cellWidth + 1;
        const w = (i - runStart) * cellWidth - 2;
        roundRect(ctx, x, rowY, w, rowHeight, 6);
        ctx.fillStyle = theme.accent;
        ctx.fill();

        if (runStart > 0) {
          const subOutPlayer = subLookup.get(`${runStart}:${p.id}`);
          if (subOutPlayer) {
            const text = `🔄 ${playerLabelSupText(subOutPlayer)}`;
            const maxWidth = Math.max(0, w - 8);
            ctx.save();
            roundRect(ctx, x, rowY, w, rowHeight, 6);
            ctx.clip();
            ctx.font = subLabelFont;
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x + 5, rowY + rowHeight / 2 + 1, maxWidth);
            ctx.textBaseline = 'top';
            ctx.restore();
          }
        }
        runStart = null;
      }
    }
  });

  return canvas;
}

function canvasToBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector('#copyRotationImage').addEventListener('click', async () => {
  if (!lastRotation) return;
  const btn = document.querySelector('#copyRotationImage');
  const old = btn.textContent;
  const players = state.players.filter(p => p.present);
  const renderCanvas = () => renderTimelineCanvas(lastRotation, players);
  try {
    const canvas = renderCanvas();
    const blob = await canvasToBlob(canvas);
    if (!blob) throw new Error('Could not create image.');
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = 'Copied!';
    } else {
      downloadBlob(blob, 'rotation.png');
      btn.textContent = 'Downloaded';
    }
  } catch (e) {
    try {
      const canvas = renderCanvas();
      const blob = await canvasToBlob(canvas);
      if (blob) { downloadBlob(blob, 'rotation.png'); btn.textContent = 'Downloaded'; }
      else throw e;
    } catch (e2) {
      alert('Could not copy or download the image.');
      return;
    }
  } finally {
    setTimeout(() => { btn.textContent = old; }, 1400);
  }
});

document.querySelector('#printRotation').addEventListener('click', () => {
  if (!lastRotation) return;
  window.print();
});

renderRoster();
setRosterMode(state.rosterCompact !== false);
restoreRotation();
