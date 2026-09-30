import { GameBackupError, parseGameBackup } from './game-backup.js';
import { isSafeSharedGameName } from './review-route.js';

export const MAX_SHARED_GAME_BYTES = 1024 * 1024;

export class SharedGameError extends Error {
  constructor(message, code = 'shared-game-error') {
    super(message);
    this.name = 'SharedGameError';
    this.code = code;
  }
}

export function sharedGameUrl(snapshotName, pageUrl = location.href) {
  if (!isSafeSharedGameName(snapshotName)) {
    throw new SharedGameError('The published game name is invalid.', 'invalid-name');
  }
  return new URL(`../games/${snapshotName}.json`, pageUrl);
}

export async function loadSharedGame(snapshotName, {
  fetchFn = fetch,
  pageUrl = location.href
} = {}) {
  const url = sharedGameUrl(snapshotName, pageUrl);
  let response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/json' }
    });
  } catch {
    throw new SharedGameError('The shared game could not be downloaded.', 'network-error');
  }
  if (response.status === 404) {
    throw new SharedGameError('The shared game file was not found.', 'not-found');
  }
  if (!response.ok) {
    throw new SharedGameError(`The shared game request failed with status ${response.status}.`, 'request-failed');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SHARED_GAME_BYTES) {
    throw new SharedGameError('The shared game file is too large.', 'too-large');
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SHARED_GAME_BYTES) {
    throw new SharedGameError('The shared game file is too large.', 'too-large');
  }
  try {
    return parseGameBackup(text);
  } catch (error) {
    if (error instanceof GameBackupError) {
      throw new SharedGameError(error.message, 'invalid-backup');
    }
    throw error;
  }
}
