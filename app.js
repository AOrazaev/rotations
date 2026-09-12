const STORAGE_KEY = 'basketball-rotation-planner-v1';

const defaultPlayers = [
  { id: crypto.randomUUID(), name: 'Dmytro', positions: ['F','G'], skill: 80, present: false },
  { id: crypto.randomUUID(), name: 'Aman', positions: ['F','G'], skill: 75, present: true },
  { id: crypto.randomUUID(), name: 'Bohdan', positions: ['C','F'], skill: 90, present: false },
  { id: crypto.randomUUID(), name: 'Denis', positions: ['F'], skill: 70, present: true },
  { id: crypto.randomUUID(), name: 'Anatoly', positions: ['G'], skill: 50, present: true },
  { id: crypto.randomUUID(), name: 'Bek', positions: ['G'], skill: 50, present: true },
  { id: crypto.randomUUID(), name: 'Vlad', positions: ['C','F','G'], skill: 75, present: true },
  { id: crypto.randomUUID(), name: 'Valya', positions: ['F','G'], skill: 70, present: true },
  { id: crypto.randomUUID(), name: 'Yedil', positions: ['C'], skill: 70, present: true },
  { id: crypto.randomUUID(), name: 'Nikita', positions: ['F','G'], skill: 95, present: false },
  { id: crypto.randomUUID(), name: 'Anton', positions: ['C'], skill: 70, present: false },
];

const LEGACY_MODE_INTENSITY = { equal: 0, balanced: 50, competitive: 100 };

let state = loadState();
let lastRotation = null;

const rosterEl = document.querySelector('#roster');
const playerTemplate = document.querySelector('#playerTemplate');
const rotationCard = document.querySelector('#rotationCard');
const rotationBody = document.querySelector('#rotationBody');
const minutesGrid = document.querySelector('#minutesGrid');
const summary = document.querySelector('#rotationSummary');
const seedInput = document.querySelector('#regenerateSeed');

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.players?.length) {
      if (typeof saved.intensity !== 'number') {
        saved.intensity = LEGACY_MODE_INTENSITY[saved.mode] ?? 100;
      }
      delete saved.mode;
      return saved;
    }
  } catch (_) {}
  return { players: defaultPlayers, blockMinutes: 4, intensity: 100 };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function renderRoster() {
  rosterEl.innerHTML = '';
  for (const player of state.players) {
    const node = playerTemplate.content.firstElementChild.cloneNode(true);
    const present = node.querySelector('.present');
    const name = node.querySelector('.name');
    const skill = node.querySelector('.skill');
    const skillValue = node.querySelector('.skill-value');
    const posBoxes = [...node.querySelectorAll('.positions input')];

    present.checked = !!player.present;
    name.value = player.name;
    skill.value = player.skill;
    skillValue.textContent = player.skill;
    posBoxes.forEach(box => box.checked = player.positions.includes(box.value));

    const update = () => {
      player.present = present.checked;
      player.name = name.value.trim() || 'Unnamed';
      player.skill = Number(skill.value);
      player.positions = posBoxes.filter(x => x.checked).map(x => x.value);
      skillValue.textContent = player.skill;
      saveState();
    };

    present.addEventListener('change', update);
    name.addEventListener('input', update);
    skill.addEventListener('input', update);
    posBoxes.forEach(box => box.addEventListener('change', update));
    node.querySelector('.delete').addEventListener('click', () => {
      state.players = state.players.filter(p => p.id !== player.id);
      saveState();
      renderRoster();
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
    const scored = [];

    for (const lineup of combos) {
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

function renderRotation(rotation, players) {
  rotationBody.innerHTML = '';
  rotation.result.forEach((block, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${blockLabel(i, rotation.blockMinutes)}</td>
      <td class="lineup">${block.lineup.map(p=>escapeHtml(p.name)).join(' · ')}</td>
      <td class="bench">${block.bench.length ? block.bench.map(p=>escapeHtml(p.name)).join(', ') : '—'}</td>`;
    rotationBody.appendChild(tr);

    if (i < rotation.result.length - 1) {
      const { out, inn } = computeSubs(block, rotation.result[i + 1]);
      if (out.length || inn.length) {
        const subTr = document.createElement('tr');
        subTr.className = 'sub-row';
        const parts = [];
        if (out.length) parts.push(`<span class="sub-out">OUT: ${out.map(p=>escapeHtml(p.name)).join(', ')}</span>`);
        if (inn.length) parts.push(`<span class="sub-in">IN: ${inn.map(p=>escapeHtml(p.name)).join(', ')}</span>`);
        subTr.innerHTML = `<td colspan="3">${parts.join(' · ')}</td>`;
        rotationBody.appendChild(subTr);
      }
    }
  });

  const sorted = [...players].sort((a,b)=>rotation.minutes[b.id]-rotation.minutes[a.id] || b.skill-a.skill);
  minutesGrid.innerHTML = sorted.map(p => `<div class="minute-card"><strong>${escapeHtml(p.name)}</strong><span>${rotation.minutes[p.id]} min</span></div>`).join('');
  summary.textContent = `${players.length} players · ${rotation.blockMinutes}-minute blocks · ${intensityLabel(state.intensity)}`;
  rotationCard.classList.remove('hidden');
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

function generate() {
  state.blockMinutes = Number(document.querySelector('#blockMinutes').value);
  state.intensity = Number(document.querySelector('#intensity').value);
  saveState();
  const players = state.players.filter(p=>p.present);
  try {
    lastRotation = buildRotation(players, state.blockMinutes, state.intensity);
    renderRotation(lastRotation, players);
    seedInput.value = '';
    rotationCard.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (e) { alert(e.message); }
}

function applySeed(seed, players) {
  const rng = createSeededRng(seed);
  lastRotation = buildRotation(players, state.blockMinutes, state.intensity, rng);
  renderRotation(lastRotation, players);
  seedInput.value = String(seed);
}

document.querySelector('#addPlayer').addEventListener('click', () => {
  state.players.push({ id: crypto.randomUUID(), name:'New player', positions:['F'], skill:60, present:true });
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
  localStorage.removeItem(STORAGE_KEY); state = { players: defaultPlayers.map(p=>({...p,id:crypto.randomUUID()})), blockMinutes:4, intensity:100 }; saveState(); renderRoster();
  intensityInput.value = '100'; intensityValueEl.textContent = intensityLabel(100);
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
document.querySelector('#copyRotation').addEventListener('click', async () => {
  if (!lastRotation) return;
  const players = state.players.filter(p=>p.present);
  const lines = lastRotation.result.map((b,i)=>`${blockLabel(i,lastRotation.blockMinutes)}: ${b.lineup.map(p=>p.name).join(', ')}`);
  lines.push('', 'Minutes:');
  players.sort((a,b)=>lastRotation.minutes[b.id]-lastRotation.minutes[a.id]).forEach(p=>lines.push(`${p.name}: ${lastRotation.minutes[p.id]} min`));
  await navigator.clipboard.writeText(lines.join('\n'));
  const btn = document.querySelector('#copyRotation'); const old = btn.textContent; btn.textContent='Copied'; setTimeout(()=>btn.textContent=old,1200);
});

// --- Rotation-as-image export -----------------------------------------
// Draws the rotation table + minutes grid onto a plain <canvas> using the
// in-memory rotation data (no DOM screenshot library needed), then either
// copies the resulting PNG to the clipboard or falls back to a download.

function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderRotationCanvas(rotation, players) {
  const theme = {
    bg: '#0b1020', card: '#121a2b', line: '#26324b',
    text: '#f6f7fb', muted: '#91a0b8', rowAlt: '#0f1727',
  };
  const fontFamily = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
  const titleFont = `700 22px ${fontFamily}`;
  const subFont = `400 13px ${fontFamily}`;
  const headFont = `600 12px ${fontFamily}`;
  const cellFont = `500 14px ${fontFamily}`;
  const cardNameFont = `700 15px ${fontFamily}`;

  const scale = 2;
  const width = 860;
  const padding = 28;
  const contentWidth = width - padding * 2;
  const blockColWidth = 110;
  const gapCol = 20;
  const listColWidth = (contentWidth - blockColWidth - gapCol) / 2;
  const lineHeight = 18;
  const rowVPad = 16;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = cellFont;
  const subFontCanvas = `600 12.5px ${fontFamily}`;
  const rows = [];
  rotation.result.forEach((block, i) => {
    const label = blockLabel(i, rotation.blockMinutes);
    const lineupText = block.lineup.map(p => p.name).join(' · ');
    const benchText = block.bench.length ? block.bench.map(p => p.name).join(', ') : '—';
    const lineupLines = wrapText(measure, lineupText, listColWidth - 16);
    const benchLines = wrapText(measure, benchText, listColWidth - 16);
    const lineCount = Math.max(lineupLines.length, benchLines.length, 1);
    rows.push({ type: 'block', label, lineupLines, benchLines, height: lineCount * lineHeight + rowVPad });

    if (i < rotation.result.length - 1) {
      const { out, inn } = computeSubs(block, rotation.result[i + 1]);
      if (out.length || inn.length) {
        measure.font = subFontCanvas;
        const outText = out.length ? `OUT: ${out.map(p => p.name).join(', ')}` : '';
        const inText = inn.length ? `IN: ${inn.map(p => p.name).join(', ')}` : '';
        const outLines = outText ? wrapText(measure, outText, contentWidth - 16) : [];
        const inLines = inText ? wrapText(measure, inText, contentWidth - 16) : [];
        measure.font = cellFont;
        const totalLines = outLines.length + inLines.length;
        rows.push({ type: 'sub', outLines, inLines, height: totalLines * 16 + 12 });
      }
    }
  });

  const titleTop = padding;
  const tableTop = titleTop + 54;
  const tableHeaderHeight = 30;
  const tableHeight = tableHeaderHeight + rows.reduce((s, r) => s + r.height, 0);

  const sorted = [...players].sort((a, b) => rotation.minutes[b.id] - rotation.minutes[a.id] || b.skill - a.skill);
  const cardGap = 10;
  const cardW = 150;
  const cardH = 46;
  const cols = Math.max(1, Math.floor((contentWidth + cardGap) / (cardW + cardGap)));
  const minuteRows = sorted.length ? Math.ceil(sorted.length / cols) : 0;
  const minutesTop = tableTop + tableHeight + 34;
  const minutesLabelHeight = sorted.length ? 24 : 0;
  const minutesHeight = minuteRows ? minuteRows * cardH + (minuteRows - 1) * cardGap : 0;

  const totalHeight = minutesTop + minutesLabelHeight + minutesHeight + padding;

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
  ctx.fillText('Rotation', padding, titleTop);
  ctx.font = subFont;
  ctx.fillStyle = theme.muted;
  ctx.fillText(summary.textContent || '', padding, titleTop + 30);

  let y = tableTop;
  ctx.font = headFont;
  ctx.fillStyle = theme.muted;
  ctx.fillText('BLOCK', padding, y);
  ctx.fillText('LINEUP', padding + blockColWidth, y);
  ctx.fillText('BENCH', padding + blockColWidth + listColWidth + gapCol, y);
  y += tableHeaderHeight;
  ctx.strokeStyle = theme.line;
  ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();

  let blockIdx = 0;
  rows.forEach((row) => {
    if (row.type === 'sub') {
      ctx.fillStyle = '#0a1220';
      ctx.fillRect(padding, y, width - padding * 2, row.height);
      ctx.font = subFontCanvas;
      let lineY = y + 6;
      ctx.fillStyle = '#ff8a8a';
      row.outLines.forEach(line => { ctx.fillText(line, padding, lineY); lineY += 16; });
      ctx.fillStyle = '#6bdc9c';
      row.inLines.forEach(line => { ctx.fillText(line, padding, lineY); lineY += 16; });
      y += row.height;
      ctx.strokeStyle = theme.line;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    if (blockIdx % 2 === 1) {
      ctx.fillStyle = theme.rowAlt;
      ctx.fillRect(padding, y, width - padding * 2, row.height);
    }
    blockIdx++;
    const textY = y + rowVPad / 2;
    ctx.font = cellFont;
    ctx.fillStyle = theme.text;
    ctx.fillText(row.label, padding, textY);
    row.lineupLines.forEach((line, li) => ctx.fillText(line, padding + blockColWidth, textY + li * lineHeight));
    ctx.fillStyle = theme.muted;
    row.benchLines.forEach((line, li) => ctx.fillText(line, padding + blockColWidth + listColWidth + gapCol, textY + li * lineHeight));
    y += row.height;
    ctx.strokeStyle = theme.line;
    ctx.beginPath(); ctx.moveTo(padding, y); ctx.lineTo(width - padding, y); ctx.stroke();
  });

  if (sorted.length) {
    ctx.font = headFont;
    ctx.fillStyle = theme.muted;
    ctx.fillText('MINUTES', padding, minutesTop);
    const gridTop = minutesTop + minutesLabelHeight;
    sorted.forEach((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cardWidth = cardW - cardGap;
      const x = padding + col * (cardW + cardGap);
      const cy = gridTop + row * (cardH + cardGap);
      roundRect(ctx, x, cy, cardWidth, cardH, 10);
      ctx.fillStyle = theme.rowAlt;
      ctx.fill();
      ctx.fillStyle = theme.text;
      ctx.font = cardNameFont;
      ctx.fillText(p.name, x + 12, cy + 10);
      ctx.font = subFont;
      ctx.fillStyle = theme.muted;
      ctx.fillText(`${rotation.minutes[p.id]} min`, x + 12, cy + 28);
    });
  }

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
  try {
    const canvas = renderRotationCanvas(lastRotation, players);
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
      const canvas = renderRotationCanvas(lastRotation, players);
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

renderRoster();
