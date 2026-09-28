# Stats and Video Review MVP Engineering Plan

## Purpose

Build a statistics and video-review application for recorded basketball games. The app will remain a static, browser-only GitHub Pages application with no backend, accounts, database server, or video upload.

The stats app is a separate application boundary from the rotation planner, but initially lives in the same repository and GitHub Pages deployment:

```text
https://<owner>.github.io/<repo>/         Rotation Planner
https://<owner>.github.io/<repo>/stats/   Stats and Video Review
```

The planner answers, "Who should play each block?" The stats app answers, "What happened, who was involved, and where is it in the recording?"

## Application boundary

Proposed repository structure:

```text
rotations/
├── index.html                 Existing rotation planner
├── styles.css
├── js/                        Existing planner code
├── stats/
│   ├── index.html             Stats application entry point
│   ├── styles.css             Stats-specific styles
│   ├── docs/
│   │   └── MVP_ENGINEERING_PLAN.md
│   └── js/
│       ├── app.js             Bootstrap and page coordination
│       ├── game-model.js      Game/event schema and validation
│       ├── game-store.js      IndexedDB persistence
│       ├── event-reducer.js   Derived score and statistics
│       ├── youtube-player.js  YouTube IFrame API adapter
│       ├── game-setup.js
│       ├── event-entry.js
│       ├── event-list.js
│       ├── lineup.js
│       └── report.js
├── shared/
│   └── js/
│       ├── roster-transfer.js
│       └── ids.js
└── tests/
    ├── logic.spec.js          Existing planner tests
    ├── ui.spec.js
    ├── stats-logic.spec.js
    └── stats-ui.spec.js
```

Boundary rules:

- The stats app may depend on small, explicit modules under `shared/`.
- The stats app must not import planner UI, global state, or files under the planner's `js/` directory.
- The planner must continue working independently if the stats app is unavailable.
- A game owns a snapshot of its roster. Later planner roster edits must not rewrite historical games.
- Stats-specific styling remains under `stats/`; shared theme tokens may be extracted later if both apps genuinely need them.
- Preserve the existing zero-build GitHub Pages deployment.

## MVP user outcome

A user can:

1. Create a game from the planner roster or a standalone roster.
2. Paste an embeddable YouTube URL.
3. Select the starting five.
4. Watch the recording and record events at the current YouTube timestamp.
5. Record equivalent events for the opponent without identifying individual opponent players.
6. Record substitutions and maintain the active lineup.
7. Edit, delete, and undo events.
8. Jump from any event to its location in the video or preview from a few seconds before it.
9. View team, opponent, player, and lineup statistics.
10. Reload without losing work.
11. Export a game to JSON and restore it through JSON import.

The YouTube timeline is the canonical clock. A basketball game clock is not required and will usually be unavailable.

## MVP event taxonomy

Both sides support:

- 2-point shot made/missed
- 3-point shot made/missed
- Free throw made/missed
- Offensive rebound
- Defensive rebound
- Assist
- Steal
- Block
- Turnover
- Personal foul

Additional game events:

- Substitution for our team
- Optional note

Our events may identify a player. Opponent events are attributed only to the opponent team.

Related events remain separate facts. For example, our turnover does not automatically create an opponent steal, and our missed shot does not automatically create an opponent rebound. The UI may suggest a related event, but it must not invent one.

## Event model

Events are the source of truth. Scores and statistics are derived from the ordered event log rather than stored as independently editable totals.

Example team event:

```js
{
  id: "event-id",
  sequence: 42,
  side: "team",
  type: "shot",
  value: 3,
  made: true,
  playerId: "player-7",
  relatedPlayerId: "player-13",
  videoSeconds: 842.6,
  lineupIds: ["p1", "p2", "p3", "p4", "p5"],
  createdAt: "2026-09-28T07:30:00Z",
  updatedAt: null
}
```

Example opponent event:

```js
{
  id: "event-id",
  sequence: 43,
  side: "opponent",
  type: "shot",
  value: 3,
  made: false,
  playerId: null,
  videoSeconds: 854.1,
  lineupIds: ["p1", "p2", "p3", "p4", "p5"],
  createdAt: "2026-09-28T07:30:12Z",
  updatedAt: null
}
```

Every scoring event, including opponent scoring, captures our active lineup so player and lineup plus/minus can be derived.

Events with identical video timestamps retain a stable insertion sequence. Editing or deleting an earlier substitution must recalculate later lineup attribution and all dependent reports.

## Timing and video behavior

- `videoSeconds` is the precise event reference.
- Official player minutes are not claimed.
- Participation duration is reported as on-court video elapsed time.
- Clicking an event timestamp seeks directly to the event.
- Preview seeks to a configurable pre-roll, initially three seconds, and starts playback.
- Event timestamps can be adjusted by `-5s`, `-1s`, `+1s`, and `+5s`.
- A user can replace an event timestamp with the player's current video position.
- YouTube may seek to a nearby keyframe, so frame-perfect seeking is not promised.

The YouTube integration should be behind a small adapter:

```js
player.getCurrentSeconds()
player.seekTo(seconds)
player.play()
player.pause()
```

Automated tests use a fake adapter. A manual checkpoint validates the real YouTube IFrame API on the deployed static site.

## Persistence and planner handoff

Use separate storage:

```text
Planner:
localStorage["basketball-rotation-planner-v1"]

Stats:
IndexedDB database "basketball-stats"

Temporary handoff:
localStorage["basketball-stats-handoff-v1"]
```

When starting from the planner:

1. The planner writes a versioned, validated handoff snapshot.
2. It navigates to `stats/?import=planner`.
3. The stats app consumes the handoff.
4. It creates an independent game and roster snapshot in IndexedDB.
5. It removes the temporary handoff.

The stats app must also support standalone game creation without the planner.

## Derived MVP reports

Team comparison:

- Score
- Field goals made/attempted/percentage
- 2-point shots made/attempted/percentage
- 3-point shots made/attempted/percentage
- Free throws made/attempted/percentage
- Offensive and defensive rebounds
- Assists
- Steals
- Blocks
- Turnovers
- Personal fouls

Our roster:

- Player box score
- Player plus/minus
- On-court video elapsed time

Lineups:

- Lineup plus/minus
- Lineup video elapsed time
- Planned versus actual lineup information when a rotation was imported

Reports should link back to their source events so a user can inspect the corresponding plays.

## Engineering milestones

### Milestone 0: Product and data contract

**Status: complete.** The versioned contract and verification fixtures are:

- [`GAME_DATA_CONTRACT_V1.md`](GAME_DATA_CONTRACT_V1.md)
- [`game-schema-v1.json`](game-schema-v1.json)
- [`fixtures/representative-game-v1.json`](fixtures/representative-game-v1.json)
- [`fixtures/representative-game-v1.expected.json`](fixtures/representative-game-v1.expected.json)

Deliver:

- Final event taxonomy
- Versioned game and event schema
- Timing semantics
- Screen flow
- Explicit MVP non-goals

Verification:

- A representative game containing our events, opponent events, substitutions, corrections, and notes can be expressed entirely by the schema.
- Every proposed report value is traceable to source events.
- Later planner roster changes cannot affect the fixture game.

### Milestone 1: YouTube integration spike

**Status: complete.** The implementation is under `stats/`, with the isolated adapter in `stats/js/youtube-player.js` and automated/fake-player plus opt-in real-player coverage in `tests/stats-youtube.spec.js`.

Deliver:

- Parse supported YouTube URLs.
- Embed a video with the YouTube IFrame API.
- Read the current playback timestamp.
- Seek to an event.
- Preview from three seconds before an event.
- Surface invalid URLs, API failures, and embedding-disabled videos.

Verification:

- On a static server and GitHub Pages, load a known embeddable video, capture a timestamp, navigate elsewhere, and jump back to the captured play.
- Automated adapter tests pass with a fake player.
- A manual test confirms the real player integration.

This milestone is first because YouTube is the largest external dependency.

### Milestone 2: Event and statistics engine

**Status: complete.** Implemented by `stats/js/game-model.js`, `stats/js/event-reducer.js`, and `tests/stats-logic.spec.js`.

Deliver a pure reducer:

```text
Game snapshot + ordered events
    -> current score
    -> team and opponent totals
    -> player box score
    -> active lineup
    -> player and lineup plus/minus
```

Verification:

- A fixed event fixture produces hand-calculated expected results.
- Tests cover makes, misses, percentages, related events, substitutions, identical timestamps, edits, and deletions.
- Opponent misses contribute to opponent attempts and percentages.
- Opponent scoring changes plus/minus for our active lineup.

### Milestone 3: Local persistence

**Status: complete.** Implemented by `stats/js/game-store.js` and `tests/stats-store.spec.js`.

Deliver:

- IndexedDB game storage
- Schema versioning
- Runtime validation
- Historical roster snapshots
- Safe handling of stale or corrupted data

Verification:

- Create a game, reload, and recover identical players, events, video reference, and derived statistics.
- Corrupted records produce an actionable error and are not rendered as valid games.

### Milestone 4: Game setup workflow

**Status: complete.** Implemented by `stats/js/game-setup.js`, `stats/js/roster-transfer.js`, the planner handoff action, and `tests/stats-setup.spec.js`.

Deliver:

- Create from planner roster
- Create standalone roster
- Game metadata
- YouTube URL attachment
- Starting-five selection

Verification:

- A UI test creates and reloads a complete game setup.
- A planner roster edit after game creation does not modify the saved game.
- Starting a standalone game requires no planner data.

### Milestone 5: Timestamped event entry

Deliver:

- Select our team or opponent.
- Select our player when applicable.
- Choose an event.
- Save it at the current YouTube timestamp.
- Keep recent actions and undo visible.

Verification:

- Record made and missed shots for both sides.
- Verify score, attempts, percentages, side attribution, player attribution, lineup snapshot, and timestamp.
- Opponent event entry does not require an opponent player.

### Milestone 6: Event review and video navigation

Deliver:

- Chronological event list
- Direct seek
- Pre-roll preview
- Timestamp adjustment
- Event editing
- Delete
- Undo

Verification:

- Every event can seek exactly or preview with pre-roll.
- Editing or deleting an event immediately recalculates all reports.
- Timestamp corrections persist after reload.

### Milestone 7: Substitutions and lineup tracking

Deliver:

- Current lineup display
- Valid substitutions
- Lineup snapshot on all events
- Optional planned-lineup reference

Verification:

- Exactly five players are active after setup.
- A substitution exchanges one on-court player with one bench player.
- Duplicate or otherwise invalid substitutions are blocked.
- Editing or deleting an earlier substitution correctly recalculates all later lineup state.

### Milestone 8: MVP reports

Deliver:

- Team versus opponent comparison
- Our player box scores
- Player plus/minus
- Lineup plus/minus
- Score progression
- On-court video elapsed time
- Links from report data to source events/video

Verification:

- A known fixture matches hand-calculated team, opponent, player, and lineup results.
- Report links navigate to the expected plays.

### Milestone 9: Backup and recovery

Deliver:

- JSON export
- JSON import
- Import validation
- Archive/delete game

Verification:

- Export a game, remove local data, import the file, and recover identical events, lineups, video references, and reports.
- Invalid files do not modify existing data.

### Milestone 10: GitHub Pages release

Deliver:

- Responsive UI
- Keyboard and basic accessibility support
- Documentation
- CI coverage
- Static deployment

Verification:

- Full stats test suite passes.
- Existing planner tests remain green.
- The end-to-end MVP workflow succeeds on the deployed GitHub Pages URL.
- The app remains functional without a build step or backend.

## Final release scenario

The release gate must complete this workflow:

1. Import eight players from the planner.
2. Create a game and choose five starters.
3. Attach a YouTube video.
4. Record our made 2-point shot and assist.
5. Record an opponent missed 3-point shot.
6. Record our defensive rebound.
7. Record an opponent made 3-point shot.
8. Make a substitution.
9. Record our made 3-point shot.
10. Jump to and preview each recorded event.
11. Correct one timestamp and one event.
12. Reload and verify persistence.
13. Verify score, shooting percentages, player statistics, active lineup, and plus/minus.
14. Export the game.
15. Delete local data.
16. Import the game and verify an identical report.

## MVP non-goals

- Live-game-to-video synchronization
- Official basketball game clock
- Official player minutes
- Automatic event detection from video
- Shot charts
- Possession-level analytics
- Multiple or edited video segments
- Cloud synchronization or accounts
- Collaborative editing
- Individual opponent player statistics
- Direct video upload or storage
- PWA or offline video support

These exclusions keep the MVP focused while preserving extension points for richer analytics, live tracking, multiple video segments, and cloud synchronization later.
