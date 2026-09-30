export function parseStatsRoute(search = '') {
  const params = new URLSearchParams(search);
  if (params.get('mode') !== 'review') return { mode: 'tracker' };

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
