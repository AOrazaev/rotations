import {
  GameValidationError,
  validateGame
} from './game-model.js';

export const STATS_DATABASE_NAME = 'basketball-stats';
export const STATS_DATABASE_VERSION = 2;
const GAMES_STORE = 'games';

export class GameStoreError extends Error {
  constructor(message, { code = 'storage-error', cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'GameStoreError';
    this.code = code;
  }
}

export class StoredGameCorruptionError extends GameStoreError {
  constructor(gameId, issues) {
    super(`Stored game ${gameId} is invalid: ${issues.join(' ')}`, { code: 'corrupt-game' });
    this.name = 'StoredGameCorruptionError';
    this.gameId = gameId;
    this.issues = issues;
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
  });
}

function deleteStoredKey(store, gameId) {
  return new Promise((resolve, reject) => {
    const lookup = store.getKey(gameId);
    lookup.onerror = () => reject(lookup.error || new Error('IndexedDB lookup failed.'));
    lookup.onsuccess = () => {
      if (lookup.result === undefined) {
        resolve(false);
        return;
      }
      const deletion = store.delete(gameId);
      deletion.onsuccess = () => resolve(true);
      deletion.onerror = () => reject(deletion.error || new Error('IndexedDB delete failed.'));
    };
  });
}

function clone(value) {
  return structuredClone(value);
}

function migrateDatabase(database, transaction, oldVersion) {
  let games;
  if (oldVersion < 1) {
    games = database.createObjectStore(GAMES_STORE, { keyPath: 'id' });
  } else {
    games = transaction.objectStore(GAMES_STORE);
  }
  if (oldVersion < 2 && !games.indexNames.contains('updatedAt')) {
    games.createIndex('updatedAt', 'updatedAt');
  }
}

export class GameStore {
  constructor({
    databaseName = STATS_DATABASE_NAME,
    indexedDBObject = globalThis.indexedDB
  } = {}) {
    if (!indexedDBObject) {
      throw new GameStoreError('IndexedDB is not available in this browser.', { code: 'unavailable' });
    }
    this.databaseName = databaseName;
    this.indexedDB = indexedDBObject;
    this.database = null;
    this.openPromise = null;
  }

  async open() {
    if (this.database) return this.database;
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = this.indexedDB.open(this.databaseName, STATS_DATABASE_VERSION);
      } catch (error) {
        reject(new GameStoreError('Could not open local game storage.', { code: 'open-failed', cause: error }));
        return;
      }

      request.onupgradeneeded = event => {
        try {
          migrateDatabase(request.result, request.transaction, event.oldVersion);
        } catch (error) {
          request.transaction.abort();
        }
      };
      request.onerror = () => {
        reject(new GameStoreError('Could not open local game storage.', {
          code: 'open-failed',
          cause: request.error
        }));
      };
      request.onblocked = () => {
        reject(new GameStoreError('Local game storage upgrade is blocked by another open tab.', {
          code: 'upgrade-blocked'
        }));
      };
      request.onsuccess = () => {
        this.database = request.result;
        this.database.onversionchange = () => this.close();
        resolve(this.database);
      };
    });

    this.openPromise.catch(() => {
      this.openPromise = null;
    });
    return this.openPromise;
  }

  close() {
    if (this.database) this.database.close();
    this.database = null;
    this.openPromise = null;
  }

  async saveGame(game) {
    validateGame(game);
    const database = await this.open();
    const transaction = database.transaction(GAMES_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const result = await requestResult(transaction.objectStore(GAMES_STORE).put(clone(game)));
      await completion;
      return result;
    } catch (error) {
      throw new GameStoreError(`Could not save game ${game.id}.`, {
        code: 'write-failed',
        cause: error
      });
    }
  }

  async getGame(gameId) {
    const database = await this.open();
    const transaction = database.transaction(GAMES_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    let game;
    try {
      game = await requestResult(transaction.objectStore(GAMES_STORE).get(gameId));
      await completion;
    } catch (error) {
      throw new GameStoreError(`Could not read game ${gameId}.`, {
        code: 'read-failed',
        cause: error
      });
    }
    if (game === undefined) return null;
    try {
      validateGame(game);
    } catch (error) {
      if (error instanceof GameValidationError) throw new StoredGameCorruptionError(gameId, error.issues);
      throw error;
    }
    return clone(game);
  }

  async listGames() {
    const database = await this.open();
    const transaction = database.transaction(GAMES_STORE, 'readonly');
    const completion = transactionComplete(transaction);
    let games;
    try {
      games = await requestResult(transaction.objectStore(GAMES_STORE).getAll());
      await completion;
    } catch (error) {
      throw new GameStoreError('Could not list saved games.', {
        code: 'read-failed',
        cause: error
      });
    }

    for (const game of games) {
      try {
        validateGame(game);
      } catch (error) {
        if (error instanceof GameValidationError) throw new StoredGameCorruptionError(game?.id || '(unknown)', error.issues);
        throw error;
      }
    }
    return games
      .map(clone)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async deleteGame(gameId) {
    const database = await this.open();
    const transaction = database.transaction(GAMES_STORE, 'readwrite');
    const completion = transactionComplete(transaction);
    try {
      const deleted = await deleteStoredKey(transaction.objectStore(GAMES_STORE), gameId);
      await completion;
      return deleted;
    } catch (error) {
      throw new GameStoreError(`Could not delete game ${gameId}.`, {
        code: 'delete-failed',
        cause: error
      });
    }
  }
}

export function deleteStatsDatabase(databaseName = STATS_DATABASE_NAME, indexedDBObject = globalThis.indexedDB) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDBObject.deleteDatabase(databaseName);
    } catch (error) {
      reject(new GameStoreError('Could not delete local game storage.', {
        code: 'delete-database-failed',
        cause: error
      }));
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new GameStoreError('Could not delete local game storage.', {
      code: 'delete-database-failed',
      cause: request.error
    }));
    request.onblocked = () => reject(new GameStoreError('Deleting local game storage is blocked by another open tab.', {
      code: 'delete-database-blocked'
    }));
  });
}
