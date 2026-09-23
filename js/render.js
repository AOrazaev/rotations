// On-page rendering of a built rotation: the per-player minutes grid and
// the on-court/bench timeline.

function renderRotation(rotation, players) {
  const sorted = [...players].sort((a,b)=>rotation.minutes[b.id]-rotation.minutes[a.id] || b.skill-a.skill);
  minutesGrid.innerHTML = sorted.map(p => `<div class="minute-card"><strong>${playerLabelHtml(p)}</strong><span>${rotation.minutes[p.id]} min</span></div>`).join('');
  summary.textContent = `${players.length} players · ${rotation.blockMinutes}-minute blocks · ${intensityLabel(state.intensity)}`;
  renderTimeline(rotation, players);
  lastPlayers = players;
  rotationCard.classList.remove('hidden');
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
