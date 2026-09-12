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

let state = loadState();
let lastRotation = null;

const rosterEl = document.querySelector('#roster');
const playerTemplate = document.querySelector('#playerTemplate');
const rotationCard = document.querySelector('#rotationCard');
const rotationBody = document.querySelector('#rotationBody');
const minutesGrid = document.querySelector('#minutesGrid');
const summary = document.querySelector('#rotationSummary');

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.players?.length) return saved;
  } catch (_) {}
  return { players: defaultPlayers, blockMinutes: 4, mode: 'competitive' };
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

function buildRotation(players, blockMinutes, mode) {
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

  // Target shares are soft constraints, not exact minute contracts.
  let weights;
  if (mode === 'equal') weights = Object.fromEntries(players.map(p => [p.id, 1]));
  else if (mode === 'balanced') weights = Object.fromEntries(players.map(p => [p.id, 0.75 + 0.5*norm(p)]));
  else weights = Object.fromEntries(players.map(p => [p.id, 0.55 + 0.9*norm(p)]));

  const totalWeight = Object.values(weights).reduce((a,b)=>a+b,0);
  const targetBlocks = Object.fromEntries(players.map(p => [p.id, (blocks*5)*(weights[p.id]/totalWeight)]));

  for (let b=0; b<blocks; b++) {
    const closing = b === blocks-1;
    let best = null, bestScore = -Infinity;

    for (const lineup of combos) {
      let score = 0;
      const ids = new Set(lineup.map(p=>p.id));
      const skillScore = lineup.reduce((s,p)=>s+p.skill,0);
      score += skillScore * (mode === 'competitive' ? 1.5 : mode === 'balanced' ? 1.0 : 0.45);

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

      if (closing && mode !== 'equal') {
        score += skillScore * 2.2;
        if (hasRole(lineup,'C') && hasRole(lineup,'G')) score += 30;
      }

      // Reduce excessive lineup repetition.
      if (result.length) {
        const overlap = result[result.length-1].lineup.filter(p=>ids.has(p.id)).length;
        if (overlap === 5) score -= 35;
      }

      if (score > bestScore) { bestScore = score; best = lineup; }
    }

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

function renderRotation(rotation, players) {
  rotationBody.innerHTML = '';
  rotation.result.forEach((block, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${blockLabel(i, rotation.blockMinutes)}</td>
      <td class="lineup">${block.lineup.map(p=>escapeHtml(p.name)).join(' · ')}</td>
      <td class="bench">${block.bench.length ? block.bench.map(p=>escapeHtml(p.name)).join(', ') : '—'}</td>`;
    rotationBody.appendChild(tr);
  });

  const sorted = [...players].sort((a,b)=>rotation.minutes[b.id]-rotation.minutes[a.id] || b.skill-a.skill);
  minutesGrid.innerHTML = sorted.map(p => `<div class="minute-card"><strong>${escapeHtml(p.name)}</strong><span>${rotation.minutes[p.id]} min · Skill ${p.skill} · ${p.positions.join('/') || '—'}</span></div>`).join('');
  summary.textContent = `${players.length} players · ${rotation.blockMinutes}-minute blocks · ${document.querySelector('#mode').selectedOptions[0].text}`;
  rotationCard.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function generate() {
  state.blockMinutes = Number(document.querySelector('#blockMinutes').value);
  state.mode = document.querySelector('#mode').value;
  saveState();
  const players = state.players.filter(p=>p.present);
  try {
    lastRotation = buildRotation(players, state.blockMinutes, state.mode);
    renderRotation(lastRotation, players);
    rotationCard.scrollIntoView({behavior:'smooth', block:'start'});
  } catch (e) { alert(e.message); }
}

document.querySelector('#addPlayer').addEventListener('click', () => {
  state.players.push({ id: crypto.randomUUID(), name:'New player', positions:['F'], skill:60, present:true });
  saveState(); renderRoster();
});
document.querySelector('#generate').addEventListener('click', generate);
document.querySelector('#blockMinutes').value = String(state.blockMinutes || 4);
document.querySelector('#mode').value = state.mode || 'competitive';
document.querySelector('#resetApp').addEventListener('click', () => {
  if (!confirm('Reset roster and settings to defaults?')) return;
  localStorage.removeItem(STORAGE_KEY); state = { players: defaultPlayers.map(p=>({...p,id:crypto.randomUUID()})), blockMinutes:4, mode:'competitive' }; saveState(); renderRoster(); rotationCard.classList.add('hidden');
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

renderRoster();
