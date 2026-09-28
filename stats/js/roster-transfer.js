export const PLANNER_HANDOFF_KEY = 'basketball-stats-handoff-v1';
export const PLANNER_HANDOFF_VERSION = 1;
export const PLANNER_HANDOFF_MAX_AGE_MS = 60 * 60 * 1000;

export class PlannerHandoffError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PlannerHandoffError';
    this.code = code;
  }
}

function normalizePlayer(player) {
  return {
    id: String(player.id),
    name: String(player.name || '').trim(),
    number: String(player.number || ''),
    positions: Array.isArray(player.positions) ? [...player.positions] : [],
    skill: Number.isFinite(Number(player.skill)) ? Number(player.skill) : null,
  };
}

export function validatePlannerHandoff(value, now = Date.now()) {
  if (!value || typeof value !== 'object') {
    throw new PlannerHandoffError('Planner handoff is malformed.', 'malformed');
  }
  if (value.version !== PLANNER_HANDOFF_VERSION) {
    throw new PlannerHandoffError('Planner handoff version is not supported.', 'unsupported');
  }
  const createdAt = Date.parse(value.createdAt);
  if (!Number.isFinite(createdAt)) {
    throw new PlannerHandoffError('Planner handoff has an invalid timestamp.', 'malformed');
  }
  if (now - createdAt > PLANNER_HANDOFF_MAX_AGE_MS || createdAt - now > 5 * 60 * 1000) {
    throw new PlannerHandoffError('Planner handoff has expired. Return to the planner and try again.', 'stale');
  }
  if (!Array.isArray(value.players) || value.players.length < 5) {
    throw new PlannerHandoffError('Planner handoff requires at least five available players.', 'invalid-roster');
  }
  const players = value.players.map(normalizePlayer);
  const ids = players.map(player => player.id);
  if (players.some(player => !player.id || !player.name) || new Set(ids).size !== ids.length) {
    throw new PlannerHandoffError('Planner handoff contains invalid or duplicate players.', 'invalid-roster');
  }

  let plannedRotation = null;
  if (value.plannedRotation != null) {
    const blocks = value.plannedRotation.blocks;
    const blockMinutes = Number(value.plannedRotation.blockMinutes);
    const playerIds = new Set(ids);
    if (!Number.isFinite(blockMinutes) || blockMinutes <= 0 || !Array.isArray(blocks) || !blocks.every(block =>
      Array.isArray(block.lineupIds)
      && block.lineupIds.length === 5
      && new Set(block.lineupIds).size === 5
      && block.lineupIds.every(id => playerIds.has(id))
    )) {
      throw new PlannerHandoffError('Planner handoff contains an invalid rotation.', 'invalid-rotation');
    }
    plannedRotation = {
      blockMinutes,
      blocks: blocks.map(block => ({ lineupIds: [...block.lineupIds] })),
    };
  }

  return { players, plannedRotation };
}

export function consumePlannerHandoff(storage = localStorage, now = Date.now()) {
  const raw = storage.getItem(PLANNER_HANDOFF_KEY);
  if (raw == null) {
    throw new PlannerHandoffError('No planner roster is waiting to be imported.', 'missing');
  }
  storage.removeItem(PLANNER_HANDOFF_KEY);
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PlannerHandoffError('Planner handoff is malformed.', 'malformed');
  }
  return validatePlannerHandoff(value, now);
}
