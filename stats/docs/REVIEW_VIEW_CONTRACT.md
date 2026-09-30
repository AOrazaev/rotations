# Stats Review View Contract

## Status and scope

This contract defines the first local Review view release. It supplements the version 1 game data contract without changing the stored game schema.

Review view reads one validated game from the existing `basketball-stats` IndexedDB database. It is a read-only presentation mode within the current `/stats/` application, not a separate deployment and not an access-control boundary.

## Route contract

The canonical route is:

```text
/stats/?mode=review&game=<encoded-game-id>
```

| State | Required behavior |
|---|---|
| Valid active game | Render Review view for the requested game |
| Missing `game` parameter | Explain that a saved game must be selected and provide **Exit review** |
| Empty or malformed game ID | Show an invalid-review-link message without rendering a partial workspace |
| Unknown game ID | Explain that the game is not available in this browser |
| Invalid stored game | Report that the saved data cannot be reviewed safely |
| Archived game | Explain that the game must be restored in the normal workspace |
| IndexedDB failure | Surface the storage error and provide **Exit review** |

The URL identifies browser-local data only. Copying it to another browser or device does not transfer the game.

Reloading a valid route must reopen the same saved snapshot. Review view does not monitor or synchronize changes made after it loads.

## Visible surface inventory

### Header

- Review view label
- Game title
- Opponent name when present
- Read-only explanation
- **Exit review**

### Video

- YouTube player
- Current video timestamp
- Play and pause
- Space to play or pause
- Left Arrow to seek backward three seconds
- Right Arrow to seek forward three seconds
- Actionable unavailable-video and embedding errors

### Score and timeline

- Current derived score
- Event timestamps and descriptions
- Coach comments as display-only content
- Timestamp playback with the existing three-second pre-roll
- Timeline starts earliest-first and can be toggled to latest-first
- Current playback event highlighting and automatic timeline following
- Manual scrolling pauses following until the coach selects Follow playback or plays a timeline event
- Side, event-type, player, comment, and `@team` filters
- Filter reset and filtered-empty states

The timeline must not show comment, edit, delete, or undo controls.

### Reports

- Team comparison
- Player box scores, including plus/minus, EFF, TS%, and video elapsed time
- Lineup results
- Score progression
- Source-event inspection and timestamp playback

### Player feedback

- Player selector
- Selected-player statistical summary
- Player-attributed commented moments
- Feedback selection checkboxes
- Previous and next feedback navigation
- Timestamp playback
- Copy for Telegram
- Copy for YouTube
- Empty state when no feedback applies

Feedback attribution continues to use direct player attribution, substitution involvement, exact case-insensitive `@NUMBER`, and case-insensitive `@team`.

## Action classification

Every Review view action is classified below. No required workflow depends on a tracker-only mutation.

| Action | Visible | Persistent game write | Notes |
|---|---:|---:|---|
| Exit review | Yes | No | Navigates to normal `/stats/` |
| Play, pause, or seek video | Yes | No | Player state only |
| Use Space or Arrow shortcuts | Yes | No | Ignored while editing form controls |
| Play a timeline timestamp | Yes | No | Seeks to three-second pre-roll |
| Pause or resume timeline following | Yes | No | In-memory presentation state |
| Change timeline order | Yes | No | In-memory presentation state |
| Apply or reset timeline filters | Yes | No | In-memory presentation state |
| Open a report source list | Yes | No | In-memory presentation state |
| Play a report source event | Yes | No | Seeks to three-second pre-roll |
| Select a feedback player | Yes | No | In-memory presentation state |
| Select feedback moments | Yes | No | In-memory sharing selection |
| Move to previous/next feedback moment | Yes | No | Selection and video state only |
| Copy Telegram feedback | Yes | No | Clipboard side effect only |
| Copy YouTube feedback | Yes | No | Clipboard side effect only |
| Edit setup or roster | No | Not allowed | Tracker-only |
| Enter events or substitutions | No | Not allowed | Tracker-only |
| Add or edit coach comments | No | Not allowed | Tracker-only |
| Correct, delete, or undo events | No | Not allowed | Tracker-only |
| Import or export backups | No | Not allowed | Tracker-only for this mode |
| Archive, restore, or delete games | No | Not allowed | Tracker-only |

Review-mode automated tests must replace or instrument `saveGame` and `deleteGame` and confirm that all visible interactions leave them unused.

## Layout behavior

### Desktop

- Video and score are the primary content.
- Timeline and reports are reachable without setup or event-entry panels.
- Review navigation remains visible and keyboard accessible.
- Tables may scroll within their own containers, but the page must not gain unintended horizontal overflow.

### Tablet

- Video remains above review navigation and content.
- Timeline and report controls wrap without overlapping.
- Touch targets retain the existing minimum control sizing.

### Mobile

- Header, video, score, navigation, timeline, and reports form one vertical flow.
- Report tables use contained horizontal scrolling.
- Timeline actions remain aligned with their events.
- No hidden tracker panel may leave empty layout columns or inaccessible focus targets.

## Archived-game behavior

Archived games are intentionally unavailable in Review view. The route shows the game title when safely readable, explains that archived games must be restored, and provides **Exit review**. Review view must not expose a restore action because restoration is a persistent game-management operation.

## Fixture contract

[`fixtures/review-view-game-v1.json`](fixtures/review-view-game-v1.json) is the Review view contract fixture. It is based on the existing representative game and adds coaching context without changing statistical results.

| Requirement | Fixture evidence |
|---|---|
| Team and opponent scoring | `e1`, `e4`, `e8`, and `e12` |
| Missed shot and rebound | `e2` and `e3` |
| Lineup change | Substitution `e7` |
| Direct player feedback | Comment on `e1` for Alex |
| Exact jersey mention | `@2` comment on opponent event `e4` for Blake |
| Team-wide feedback | `@team` comment on opponent rebound `e6` |
| Substitution feedback | Comment on `e7`, attributable to Emery and Flynn |
| Same-timestamp ordering | `e8` and `e9` |
| Reports and source navigation | Same expected report as `representative-game-v1.expected.json` |

The fixture must pass version 1 game validation and produce the unchanged hand-calculated report. Coach comments affect presentation and feedback only; they do not affect statistics or lineup replay.

## Non-goals

- Live or second-screen synchronization
- Public URLs or cross-device access
- Authentication or authorization
- Cloud persistence
- Editing any saved game field
- Exporting a portable viewer
