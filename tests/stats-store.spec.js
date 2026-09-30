const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/stats/');
});

async function runWithFixture(page, callbackSource) {
  return page.evaluate(async source => {
    const legacyGame = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    const { normalizeGame } = await import('/stats/js/game-model.js');
    const game = normalizeGame(legacyGame);
    const storeModule = await import('/stats/js/game-store.js');
    const databaseName = `basketball-stats-test-${crypto.randomUUID()}`;
    const store = new storeModule.GameStore({ databaseName });
    try {
      return await (0, eval)(source)({ game, store, storeModule, databaseName });
    } finally {
      store.close();
      await storeModule.deleteStatsDatabase(databaseName);
    }
  }, callbackSource);
}

test('save and read survive closing and reopening the store', async ({ page }) => {
  const result = await runWithFixture(page, `async ({ game, store, storeModule, databaseName }) => {
    await store.saveGame(game);
    const firstRead = await store.getGame(game.id);
    store.close();
    const reopened = new storeModule.GameStore({ databaseName });
    const secondRead = await reopened.getGame(game.id);
    reopened.close();
    return { firstRead, secondRead };
  }`);

  const fixture = await page.evaluate(async () => {
    const game = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    const { normalizeGame } = await import('/stats/js/game-model.js');
    return normalizeGame(game);
  });
  expect(result.firstRead).toEqual(fixture);
  expect(result.secondRead).toEqual(fixture);
});

test('saved games survive a browser page reload', async ({ page }) => {
  const databaseName = `basketball-stats-reload-${Date.now()}-${Math.random()}`;
  const fixture = await page.evaluate(async name => {
    const legacyGame = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    const { normalizeGame } = await import('/stats/js/game-model.js');
    const game = normalizeGame(legacyGame);
    const { GameStore } = await import('/stats/js/game-store.js');
    const store = new GameStore({ databaseName: name });
    await store.saveGame(game);
    store.close();
    return game;
  }, databaseName);

  await page.reload();

  const restored = await page.evaluate(async name => {
    const { GameStore, deleteStatsDatabase } = await import('/stats/js/game-store.js');
    const store = new GameStore({ databaseName: name });
    try {
      return await store.getGame('game-representative-v1');
    } finally {
      store.close();
      await deleteStatsDatabase(name);
    }
  }, databaseName);
  expect(restored).toEqual(fixture);
});

test('updates replace a game atomically and invalid updates preserve the stored version', async ({ page }) => {
  const result = await runWithFixture(page, `async ({ game, store }) => {
    await store.saveGame(game);
    const updated = structuredClone(game);
    updated.title = 'Updated title';
    updated.updatedAt = '2026-09-28T08:00:00Z';
    await store.saveGame(updated);

    const invalid = structuredClone(updated);
    invalid.startingLineupIds = ['p1', 'p1', 'p2', 'p3', 'p4'];
    let error;
    try { await store.saveGame(invalid); }
    catch (caught) { error = { name: caught.name, issues: caught.issues }; }
    return { stored: await store.getGame(game.id), error };
  }`);

  expect(result.stored.title).toBe('Updated title');
  expect(result.error.name).toBe('GameValidationError');
  expect(result.error.issues).toContain('Starting lineup must contain five unique game players.');
});

test('list order is stable and deleting one game does not affect another', async ({ page }) => {
  const result = await runWithFixture(page, `async ({ game, store }) => {
    const older = structuredClone(game);
    older.id = 'game-b';
    older.updatedAt = '2026-09-28T07:00:00Z';
    const newerA = structuredClone(game);
    newerA.id = 'game-a';
    newerA.updatedAt = '2026-09-28T09:00:00Z';
    const newerC = structuredClone(game);
    newerC.id = 'game-c';
    newerC.updatedAt = '2026-09-28T09:00:00Z';
    await store.saveGame(older);
    await store.saveGame(newerC);
    await store.saveGame(newerA);
    const before = (await store.listGames()).map(item => item.id);
    const deleted = await store.deleteGame('game-a');
    const missing = await store.deleteGame('missing');
    const after = (await store.listGames()).map(item => item.id);
    return { before, deleted, missing, after };
  }`);

  expect(result.before).toEqual(['game-a', 'game-c', 'game-b']);
  expect(result.deleted).toBe(true);
  expect(result.missing).toBe(false);
  expect(result.after).toEqual(['game-c', 'game-b']);
});

test('saved games are independent snapshots of planner and returned objects', async ({ page }) => {
  const result = await runWithFixture(page, `async ({ game, store }) => {
    await store.saveGame(game);
    game.players[0].name = 'Planner changed';
    const firstRead = await store.getGame(game.id);
    firstRead.players[0].name = 'Caller changed';
    const secondRead = await store.getGame(game.id);
    return { firstReadName: firstRead.players[0].name, secondReadName: secondRead.players[0].name };
  }`);

  expect(result.firstReadName).toBe('Caller changed');
  expect(result.secondReadName).toBe('Alex');
});

test('corrupted stored records are detected and can still be deleted for recovery', async ({ page }) => {
  const result = await runWithFixture(page, `async ({ game, store, databaseName }) => {
    await store.saveGame(game);
    store.close();
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const corrupted = structuredClone(game);
    corrupted.startingLineupIds = ['p1', 'p1', 'p2', 'p3', 'p4'];
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('games', 'readwrite');
      transaction.objectStore('games').put(corrupted);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    let error;
    try { await store.getGame(game.id); }
    catch (caught) {
      error = { name: caught.name, code: caught.code, gameId: caught.gameId, issues: caught.issues };
    }
    const deleted = await store.deleteGame(game.id);
    const afterDelete = await store.getGame(game.id);
    return { error, deleted, afterDelete };
  }`);

  expect(result.error.name).toBe('StoredGameCorruptionError');
  expect(result.error.code).toBe('corrupt-game');
  expect(result.error.gameId).toBe('game-representative-v1');
  expect(result.error.issues).toContain('Starting lineup must contain five unique game players.');
  expect(result.deleted).toBe(true);
  expect(result.afterDelete).toBeNull();
});

test('version-one databases migrate to the current version without losing games', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const game = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    const { GameStore, STATS_DATABASE_VERSION, deleteStatsDatabase } = await import('/stats/js/game-store.js');
    const databaseName = `basketball-stats-migration-${crypto.randomUUID()}`;
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('games', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const transaction = legacy.transaction('games', 'readwrite');
      transaction.objectStore('games').put(game);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    legacy.close();

    const store = new GameStore({ databaseName });
    try {
      const loaded = await store.getGame(game.id);
      const database = await store.open();
      const inspection = database.transaction('games', 'readonly');
      const objectStore = inspection.objectStore('games');
      const hasUpdatedAtIndex = objectStore.indexNames.contains('updatedAt');
      const storedGame = await new Promise((resolve, reject) => {
        const request = objectStore.get(game.id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        inspection.oncomplete = resolve;
        inspection.onerror = () => reject(inspection.error);
        inspection.onabort = () => reject(inspection.error);
      });
      return {
        loaded,
        storedSchemaVersion: storedGame.schemaVersion,
        version: database.version,
        hasUpdatedAtIndex,
        expectedVersion: STATS_DATABASE_VERSION
      };
    } finally {
      store.close();
      await deleteStatsDatabase(databaseName);
    }
  });

  expect(result.loaded.id).toBe('game-representative-v1');
  expect(result.loaded.schemaVersion).toBe(2);
  expect(result.storedSchemaVersion).toBe(1);
  expect(result.version).toBe(result.expectedVersion);
  expect(result.hasUpdatedAtIndex).toBe(true);
});

test('storage initialization failures expose an actionable error code', async ({ page }) => {
  const error = await page.evaluate(async () => {
    const { GameStore } = await import('/stats/js/game-store.js');
    const store = new GameStore({
      indexedDBObject: {
        open() { throw new Error('simulated failure'); }
      }
    });
    try { await store.open(); }
    catch (caught) {
      return {
        name: caught.name,
        code: caught.code,
        message: caught.message,
        cause: caught.cause?.message
      };
    }
  });

  expect(error).toEqual({
    name: 'GameStoreError',
    code: 'open-failed',
    message: 'Could not open local game storage.',
    cause: 'simulated failure'
  });
});

test('game backups round-trip exact validated snapshots and reject invalid envelopes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const legacyGame = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    const { normalizeGame } = await import('/stats/js/game-model.js');
    const game = normalizeGame(legacyGame);
    const {
      createGameBackup,
      parseGameBackup,
      serializeGameBackup,
      gameBackupFileName
    } = await import('/stats/js/game-backup.js');
    const exportedAt = '2026-09-28T16:00:00Z';
    const serialized = serializeGameBackup(game, exportedAt);
    const backup = createGameBackup(game, exportedAt);
    const restored = parseGameBackup(serialized);
    const failures = [];
    for (const value of [
      '{broken',
      { ...backup, backupVersion: 99 },
      { ...backup, application: 'another-app' },
      { ...backup, game: { ...backup.game, startingLineupIds: ['p1', 'p1', 'p2', 'p3', 'p4'] } }
    ]) {
      try {
        parseGameBackup(value);
      } catch (error) {
        failures.push({ name: error.name, code: error.code });
      }
    }
    return {
      backup,
      restored,
      filename: gameBackupFileName(game),
      failures
    };
  });

  const fixture = await page.evaluate(async () => {
    const game = await fetch('/stats/docs/fixtures/representative-game-v1.json').then(response => response.json());
    const { normalizeGame } = await import('/stats/js/game-model.js');
    return normalizeGame(game);
  });
  expect(result.backup).toMatchObject({
    backupVersion: 1,
    application: 'basketball-stats',
    exportedAt: '2026-09-28T16:00:00Z'
  });
  expect(result.restored).toEqual(fixture);
  expect(result.filename).toBe('mvp-contract-verification-game-backup.json');
  expect(result.failures).toEqual([
    { name: 'GameBackupError', code: 'malformed-json' },
    { name: 'GameBackupError', code: 'unsupported-version' },
    { name: 'GameBackupError', code: 'wrong-application' },
    { name: 'GameBackupError', code: 'invalid-game' }
  ]);
});

test('archived games validate and sort after active games', async ({ page }) => {
  const result = await runWithFixture(page, `async ({ game, store }) => {
    const archived = structuredClone(game);
    archived.id = 'archived-game';
    archived.title = 'Archived';
    archived.archivedAt = '2026-09-28T10:00:00Z';
    archived.updatedAt = '2026-09-28T10:00:00Z';
    const active = structuredClone(game);
    active.id = 'active-game';
    active.title = 'Active';
    await store.saveGame(archived);
    await store.saveGame(active);
    const games = await store.listGames();
    const invalid = structuredClone(active);
    invalid.id = 'invalid-archive';
    invalid.archivedAt = 'not-a-date';
    let invalidIssues = [];
    try { await store.saveGame(invalid); }
    catch (error) { invalidIssues = error.issues; }
    return { games: games.map(item => ({ id: item.id, archivedAt: item.archivedAt })), invalidIssues };
  }`);

  expect(result.games).toEqual([
    { id: 'active-game', archivedAt: undefined },
    { id: 'archived-game', archivedAt: '2026-09-28T10:00:00Z' }
  ]);
  expect(result.invalidIssues).toContain('Archived time must be a valid timestamp when present.');
});
