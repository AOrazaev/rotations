export function isSafeSharedGameName(value) {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9_-]{0,79})$/.test(value);
}

export function parseStatsRoute(search = '') {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  if (mode === 'shared') {
    if (!params.has('game')) {
      return { mode: 'shared', status: 'missing-game', snapshotName: null };
    }
    const snapshotName = params.get('game');
    if (!isSafeSharedGameName(snapshotName)) {
      return { mode: 'shared', status: 'invalid-game', snapshotName: null };
    }
    return { mode: 'shared', status: 'ready', snapshotName };
  }
  if (mode !== 'review') return { mode: 'tracker' };

  if (!params.has('game')) {
    return { mode: 'review', status: 'missing-game', gameId: null };
  }

  const gameId = params.get('game');
  if (!gameId || gameId !== gameId.trim() || /[\u0000-\u001f\u007f]/.test(gameId)) {
    return { mode: 'review', status: 'invalid-game', gameId: null };
  }

  return { mode: 'review', status: 'ready', gameId };
}

export function buildReviewUrl(gameId, pathname = '/stats/') {
  const params = new URLSearchParams({
    mode: 'review',
    game: String(gameId)
  });
  return `${pathname}?${params}`;
}

export function buildSharedReviewUrl(snapshotName, pathname = '/stats/') {
  const params = new URLSearchParams({
    mode: 'shared',
    game: String(snapshotName)
  });
  return `${pathname}?${params}`;
}
