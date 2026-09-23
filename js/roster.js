// Roster list rendering (compact chip view / edit-mode form fields) and the
// compact<->edit mode toggle.

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
