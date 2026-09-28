# Stats Game Data Contract v1

## Scope

This document is the product and data contract for the first Stats and Video Review MVP. The machine-readable structural contract is [`game-schema-v1.json`](game-schema-v1.json).

Version 1 supports post-game review of one continuous YouTube video. YouTube elapsed time is canonical; an official basketball game clock is neither required nor inferred.

## Screen flow

```text
Games
  -> New game
      -> Import planner roster or create standalone roster
      -> Enter game details and YouTube URL
      -> Select starting five
  -> Review workspace
      -> Video
      -> Current lineup
      -> Team/opponent event entry
      -> Chronological event list
  -> Reports
      -> Team comparison
      -> Player box score
      -> Lineups and plus/minus
```

The review workspace is the primary MVP experience. Event entry and correction happen against the recording, not against a live game clock.

## Game identity and roster snapshot

Each game has a stable ID and owns a complete player snapshot. A game created from the planner copies player data; it does not retain live references to planner state.

Required player fields:

- `id`: stable within the game
- `name`: display name at the time of the game
- `number`: jersey number or an empty string

Optional planner metadata such as positions and skill may be copied for context, but statistics never depend on it.

`startingLineupIds` contains exactly five unique game player IDs.

## Video contract

```js
{
  provider: "youtube",
  videoId: "dQw4w9WgXcQ",
  sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  startSeconds: 100,
  endSeconds: 200
}
```

- `videoId` is the normalized YouTube video ID.
- `sourceUrl` preserves what the user entered.
- `startSeconds` marks when the tracked game begins in the recording.
- `endSeconds` is nullable until the user marks the end of the tracked game.
- On-court video duration is available only over a known interval. Before `endSeconds` is set, reports may show provisional duration through the latest event.
- The app does not upload, proxy, or persist video content.

## Canonical event order

Events are ordered by:

1. `videoSeconds` ascending
2. `sequence` ascending

`sequence` is a unique, monotonically allocated insertion number and is the tie-breaker for events at the same video position. Editing a timestamp can move an event earlier or later without changing its sequence.

Every event contains:

- Stable ID
- Sequence number
- YouTube timestamp
- Side: `team`, `opponent`, or `system`
- Event type and type-specific fields
- Optional non-empty `coachComment`
- Our active five-player lineup
- Creation and optional update timestamps

## Event types

### Shot

```js
{
  side: "team",
  type: "shot",
  playerId: "p1",
  shotValue: 3,
  made: true
}
```

`shotValue` is:

- `1`: free throw
- `2`: 2-point field goal
- `3`: 3-point field goal

Team shots require `playerId`. Opponent shots use `playerId: null`.

### Rebound

```js
{
  side: "opponent",
  type: "rebound",
  playerId: null,
  reboundKind: "defensive"
}
```

`reboundKind` is `offensive` or `defensive`, from the event side's perspective.

### Other statistical events

The following use `side: "team"` or `side: "opponent"`:

- `assist`
- `steal`
- `block`
- `turnover`
- `foul`

Team events require a game player ID. Opponent events are team-level and use `playerId: null`.

Related facts remain separate events. For example, a team turnover and opponent steal may share `relatedEventId`, but recording either one does not automatically invent the other.

### Substitution

```js
{
  side: "team",
  type: "substitution",
  playerId: null,
  playerOutId: "p5",
  playerInId: "p6",
  lineupIds: ["p1", "p2", "p3", "p4", "p6"]
}
```

- `playerOutId` must be on court immediately before the event.
- `playerInId` must be on the bench immediately before the event.
- `lineupIds` is the lineup immediately after the substitution.
- A substitution exchanges exactly one player and preserves a five-player lineup.

### Timeout

Timeouts use `type: "timeout"`, belong to `side: "team"` or `side: "opponent"`, and use `playerId: null`.

### Period end

Period boundaries use `side: "system"`, `type: "period_end"`, `playerId: null`, and a non-empty freeform `periodLabel`, such as `End of Q1`, `Halftime`, or `End of overtime`.

### Note

Notes use `side: "system"`, `type: "note"`, `playerId: null`, and a non-empty `note`.

### Coach comment

Any event may include an optional non-empty `coachComment`. It adds coaching context to the timeline but has no statistical or lineup effect.

## Lineup semantics

- For a non-substitution event, `lineupIds` is our active lineup at the event.
- For a substitution, `lineupIds` is our active lineup immediately after the exchange.
- Every lineup contains exactly five unique IDs from the game roster.
- Starting lineup plus ordered substitution events is the authoritative lineup history.
- Stored lineup snapshots are materialized audit data and must match that history.
- Editing, deleting, or moving a substitution recomputes all subsequent lineup snapshots before saving.
- If a stored snapshot does not match the derived lineup, the game is invalid and must not be reported as trustworthy.

## Statistical semantics

Team totals are derived symmetrically for `team` and `opponent`:

- Points: sum of `shotValue` for made shots
- Field goals: made/attempted shots where `shotValue` is 2 or 3
- 2PT: made/attempted shots where `shotValue` is 2
- 3PT: made/attempted shots where `shotValue` is 3
- FT: made/attempted shots where `shotValue` is 1
- OREB/DREB: rebound events by kind
- AST/STL/BLK/TO/PF: count of the corresponding events

Our player totals are the same calculations filtered by `playerId`.

- EFF: `PTS + OREB + DREB + AST + STL + BLK - missed FG - missed FT - TO`
- TS%: `PTS / (2 × (FGA + 0.44 × FTA)) × 100`; players without a field-goal or free-throw attempt have no TS% value

Plus/minus changes only on made shots:

- Team made shot: add its value to every player in `lineupIds`.
- Opponent made shot: subtract its value from every player in `lineupIds`.

Lineup plus/minus applies the same calculation to the five-player lineup key.

Video participation time is derived from:

- `video.startSeconds` to the first substitution
- Consecutive substitution intervals
- Final substitution to `video.endSeconds`

It is labeled as video elapsed time, never official playing time.

## Report traceability

| Report field | Source |
|---|---|
| Score and score progression | Made `shot` events |
| Team/opponent shooting percentages | Made and missed `shot` events grouped by `side` and `shotValue` |
| Team/opponent rebounds and other totals | Corresponding statistical events grouped by `side` |
| Player box score | Team statistical events grouped by `playerId` |
| Player EFF and TS% | Contributing player statistical and shot events |
| Player plus/minus | Made shots and each event's `lineupIds` |
| Lineup plus/minus | Made shots grouped by normalized `lineupIds` |
| Video participation time | Video start/end plus substitution events |
| Planned versus actual lineup | Optional `plannedRotation` snapshot versus derived lineup history |
| Video navigation | Event `videoSeconds` |

Every aggregate report value must expose or be traceable to its contributing events.

## Validation beyond JSON Schema

JSON Schema validates shape. Application validation must additionally enforce:

- All referenced player IDs exist in `players`.
- Player IDs, event IDs, and event sequence numbers are unique.
- `video.endSeconds`, when present, is not before `video.startSeconds`.
- Event timestamps are within the tracked video interval when an end is known.
- Team statistical events reference a player; opponent events do not.
- Only team substitutions are allowed.
- Starting and event lineups contain five valid, unique players.
- Substitution transitions and stored lineup snapshots are consistent.
- `relatedEventId`, when present, references another event in the game.

Invalid imported or stored games must produce an actionable error and must not replace valid existing data.

## Persistence and handoff

- Stats games are stored in IndexedDB database `basketball-stats`.
- Every persisted and exported game includes `schemaVersion: 1`.
- JSON import validates before writing.
- Planner handoff uses the temporary key `basketball-stats-handoff-v1`.
- Consuming a handoff creates an independent game snapshot and removes the temporary record.

## MVP non-goals

- Live-game-to-video synchronization
- Official basketball clock or official minutes
- Automatic event detection
- Shot charts and possession analytics
- Multiple or edited video segments
- Cloud accounts, synchronization, or collaboration
- Individual opponent player statistics
- Video upload, proxying, or storage
- PWA/offline video support

## Contract verification fixture

[`fixtures/representative-game-v1.json`](fixtures/representative-game-v1.json) exercises:

- Team and opponent makes and misses
- Team and opponent percentages
- Rebounds and other box-score events
- A substitution and two lineup intervals
- Player and lineup plus/minus
- Video timestamps and participation duration
- A related-event reference
- A system note

Its hand-calculated results are recorded in [`fixtures/representative-game-v1.expected.json`](fixtures/representative-game-v1.expected.json).
