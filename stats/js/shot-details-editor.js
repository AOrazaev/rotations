import { createShotCourt } from './shot-court.js';

const FIELD_OPTIONS = [
  {
    field: 'pressure',
    label: 'Pressure',
    multiple: false,
    options: [
      ['open', 'Open'],
      ['lightly_contested', 'Lightly contested'],
      ['contested', 'Contested'],
      ['heavily_contested', 'Heavily contested']
    ]
  },
  {
    field: 'phase',
    label: 'Phase',
    multiple: false,
    options: [
      ['half_court', 'Half court'],
      ['transition', 'Transition']
    ]
  },
  {
    field: 'contexts',
    label: 'Context',
    multiple: true,
    options: [
      ['second_chance', 'Second chance']
    ]
  },
  {
    field: 'creation',
    label: 'Creation',
    multiple: false,
    options: [
      ['catch_and_shoot', 'Catch-and-shoot'],
      ['pull_up', 'Pull-up'],
      ['drive', 'Drive'],
      ['cut', 'Cut'],
      ['post_up', 'Post-up'],
      ['putback', 'Putback'],
      ['other', 'Other']
    ]
  }
];

function normalizeDetails(details) {
  if (!details) return null;
  const normalized = structuredClone(details);
  if (!normalized.location) delete normalized.location;
  if (!normalized.pressure) delete normalized.pressure;
  if (!normalized.phase) delete normalized.phase;
  if (!normalized.creation) delete normalized.creation;
  if (!Array.isArray(normalized.contexts) || !normalized.contexts.length) delete normalized.contexts;
  return Object.keys(normalized).length ? normalized : null;
}

export function createShotDetailsEditor({
  element,
  documentObject = document,
  details = null,
  shotValue = null,
  disabled = false,
  onChange = () => {}
}) {
  if (!element) throw new Error('Shot details editor host element is required.');

  element.classList.add('shot-details-editor');
  const courtHost = documentObject.createElement('div');
  courtHost.className = 'shot-court';
  courtHost.id = `${element.id || 'shotDetails'}Court`;
  const groups = documentObject.createElement('div');
  groups.className = 'shot-detail-groups';
  const actions = documentObject.createElement('div');
  actions.className = 'shot-detail-actions';
  const clearLocation = documentObject.createElement('button');
  clearLocation.type = 'button';
  clearLocation.className = 'secondary small';
  clearLocation.dataset.shotDetailsAction = 'clear-location';
  clearLocation.textContent = 'Clear location';
  const clearDetails = documentObject.createElement('button');
  clearDetails.type = 'button';
  clearDetails.className = 'secondary small';
  clearDetails.dataset.shotDetailsAction = 'clear-details';
  clearDetails.textContent = 'Clear details';
  actions.append(clearLocation, clearDetails);
  element.replaceChildren(courtHost, groups, actions);

  let currentDetails = normalizeDetails(details);
  let currentDisabled = Boolean(disabled);
  const buttonsByField = new Map();

  for (const definition of FIELD_OPTIONS) {
    const fieldset = documentObject.createElement('fieldset');
    fieldset.className = 'shot-detail-group';
    const legend = documentObject.createElement('legend');
    legend.textContent = definition.label;
    fieldset.appendChild(legend);
    const fieldButtons = [];
    for (const [value, label] of definition.options) {
      const button = documentObject.createElement('button');
      button.type = 'button';
      button.className = 'shot-detail-chip';
      button.dataset.shotDetailField = definition.field;
      button.dataset.value = value;
      button.textContent = label;
      button.setAttribute('aria-pressed', 'false');
      fieldset.appendChild(button);
      fieldButtons.push(button);
    }
    groups.appendChild(fieldset);
    buttonsByField.set(definition.field, fieldButtons);
  }

  const court = createShotCourt({
    element: courtHost,
    documentObject,
    location: currentDetails?.location || null,
    shotValue,
    disabled,
    onChange(location) {
      const next = normalizeDetails(currentDetails) || {};
      if (location) next.location = location;
      else delete next.location;
      currentDetails = normalizeDetails(next);
      render();
      onChange(editor.getDetails(), { field: 'location' });
    }
  });

  function selectedValues(field) {
    if (field === 'contexts') return new Set(currentDetails?.contexts || []);
    return new Set(currentDetails?.[field] ? [currentDetails[field]] : []);
  }

  function render() {
    for (const definition of FIELD_OPTIONS) {
      const selected = selectedValues(definition.field);
      for (const button of buttonsByField.get(definition.field)) {
        const active = selected.has(button.dataset.value);
        button.classList.toggle('selected', active);
        button.setAttribute('aria-pressed', String(active));
        button.disabled = currentDisabled;
      }
    }
    clearLocation.disabled = currentDisabled || !currentDetails?.location;
    clearDetails.disabled = currentDisabled || !currentDetails;
  }

  function updateField(field, value) {
    const definition = FIELD_OPTIONS.find(item => item.field === field);
    if (!definition) return;
    const next = normalizeDetails(currentDetails) || {};
    if (definition.multiple) {
      const values = new Set(next[field] || []);
      if (values.has(value)) values.delete(value);
      else values.add(value);
      if (values.size) next[field] = [...values];
      else delete next[field];
    } else if (next[field] === value) {
      delete next[field];
    } else {
      next[field] = value;
    }
    currentDetails = normalizeDetails(next);
    render();
    onChange(editor.getDetails(), { field });
  }

  function handleClick(event) {
    const chip = event.target.closest('[data-shot-detail-field]');
    if (chip && !currentDisabled) {
      updateField(chip.dataset.shotDetailField, chip.dataset.value);
      return;
    }
    const action = event.target.closest('[data-shot-details-action]')?.dataset.shotDetailsAction;
    if (!action || currentDisabled) return;
    if (action === 'clear-location') {
      court.setLocation(null);
      const next = normalizeDetails(currentDetails) || {};
      delete next.location;
      currentDetails = normalizeDetails(next);
      render();
      onChange(editor.getDetails(), { field: 'location' });
    } else if (action === 'clear-details') {
      currentDetails = null;
      court.setLocation(null);
      render();
      onChange(null, { field: 'all' });
    }
  }

  element.addEventListener('click', handleClick);

  const editor = {
    getDetails: () => normalizeDetails(currentDetails),
    setDetails(nextDetails) {
      currentDetails = normalizeDetails(nextDetails);
      court.setLocation(currentDetails?.location || null);
      render();
    },
    setShotValue(nextShotValue) {
      court.setShotValue(nextShotValue);
    },
    setDisabled(nextDisabled) {
      currentDisabled = Boolean(nextDisabled);
      court.setDisabled(currentDisabled);
      render();
    },
    focusMap() {
      court.focus();
    },
    destroy() {
      element.removeEventListener('click', handleClick);
      court.destroy();
      element.replaceChildren();
    }
  };

  render();
  return editor;
}
