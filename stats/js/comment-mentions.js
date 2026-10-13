function commentMentions(comment) {
  return [...String(comment || '').matchAll(/@([A-Za-z0-9]+)/g)]
    .map(match => match[1].toLowerCase());
}

export function commentMentionsPlayer(comment, player) {
  return Boolean(
    player?.number
    && commentMentions(comment).includes(String(player.number).toLowerCase())
  );
}

export function commentMentionsTeam(comment) {
  return commentMentions(comment).includes('team');
}
