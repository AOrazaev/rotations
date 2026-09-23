// The rotation-building algorithm and its small pure helpers: no DOM access,
// nothing here reads or writes `state`/localStorage. This is exactly the
// surface tests/logic.spec.js exercises directly (as page globals).

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
    // Clone: `best` is a reference into the shared `combos` list, so if the
    // same 5-player combination wins in more than one block (common), every
    // block that picked it would otherwise share the exact same array -
    // mutating one block's lineup (e.g. via a manual swap) would silently
    // corrupt every other block with that same lineup too.
    result.push({ lineup: [...best], bench: players.filter(p=>!ids.has(p.id)) });
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
