import { validateGame } from './game-model.js';

export const GAME_BACKUP_VERSION = 1;
export const GAME_BACKUP_APPLICATION = 'basketball-stats';

export class GameBackupError extends Error {
  constructor(message, code = 'invalid-backup') {
    super(message);
    this.name = 'GameBackupError';
    this.code = code;
  }
}

function isValidTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function createGameBackup(game, exportedAt = new Date().toISOString()) {
  validateGame(game);
  if (!isValidTimestamp(exportedAt)) {
    throw new GameBackupError('Backup export time must be a valid timestamp.');
  }
  return {
    backupVersion: GAME_BACKUP_VERSION,
    application: GAME_BACKUP_APPLICATION,
    exportedAt,
    game: structuredClone(game)
  };
}

export function serializeGameBackup(game, exportedAt) {
  return `${JSON.stringify(createGameBackup(game, exportedAt), null, 2)}\n`;
}

export function parseGameBackup(value) {
  let backup = value;
  if (typeof value === 'string') {
    try {
      backup = JSON.parse(value);
    } catch {
      throw new GameBackupError('The selected file is not valid JSON.', 'malformed-json');
    }
  }
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new GameBackupError('The selected file is not a game backup.');
  }
  if (backup.backupVersion !== GAME_BACKUP_VERSION) {
    throw new GameBackupError(`Unsupported backup version: ${backup.backupVersion}.`, 'unsupported-version');
  }
  if (backup.application !== GAME_BACKUP_APPLICATION) {
    throw new GameBackupError('The selected file was not created by Basketball Stats.', 'wrong-application');
  }
  if (!isValidTimestamp(backup.exportedAt)) {
    throw new GameBackupError('The backup export timestamp is invalid.');
  }
  try {
    validateGame(backup.game);
  } catch (error) {
    throw new GameBackupError(error.message || 'The backup contains an invalid game.', 'invalid-game');
  }
  return structuredClone(backup.game);
}

export function gameBackupFileName(game) {
  const base = String(game.title || 'basketball-game')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'basketball-game';
  return `${base}-backup.json`;
}
