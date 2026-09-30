# Shot Details Engineering Plan

## Purpose

Add optional structured context to field-goal events without slowing down the existing one-click event-entry workflow. The first release focuses only on shots because location and shot context provide the clearest analytical value.

The feature remains browser-only, compatible with static GitHub Pages hosting, and shared by tracker reports and the read-only Review view.

## Product outcome

A coach can:

1. Record a made or missed 2PT or 3PT shot exactly as today.
2. Optionally open quick shot details after the event is saved.
3. Tap or click a half-court map to record the shot location.
4. Add pressure, offensive phase, contextual tags, and creation type.
5. Correct or clear those details later through the event editor.
6. See compact shot-detail badges in the tracker and Review timelines.
7. Filter shots and inspect shot charts and efficiency splits.

Ignoring or dismissing shot details must leave a valid basic shot event. Free throws remain outside this feature.

## Scope decisions

### Included

- Team and opponent 2PT and 3PT events.
- Optional normalized half-court coordinates.
- Automatically derived zone, side, approximate distance, and expected 2PT/3PT value.
- Pressure:
  - `open`
  - `lightly_contested`
  - `contested`
  - `heavily_contested`
- Offensive phase:
  - `half_court`
  - `transition`
- Additional context tags:
  - `second_chance`
- Creation:
  - `catch_and_shoot`
  - `pull_up`
  - `drive`
  - `cut`
  - `post_up`
  - `putback`
  - `other`
- Timeline presentation and filtering.
- Team, opponent, and player shot charts.
- Efficiency splits by zone, pressure, phase, context, and creation.
- Read-only display and filtering in Review mode.
- Backup, import, reload, and existing-game compatibility.

### Excluded

- Free-throw location or pressure.
- Full-court tracking.
- Possession creation or automatic event grouping.
- Automatic video or computer-vision location detection.
- Defender identity, nearest-defender distance, or shot-clock data.
- Detailed turnover, rebound, foul, assist, steal, block, substitution, or timeout fields.
- Public/cloud analytics or cross-device synchronization.

Turnover, rebound, and foul details may become separate follow-up features after shot-detail usage is evaluated. Detailed metadata for the remaining event types is intentionally deferred.

## Data contract

Field-goal events may contain:

```json
{
  "type": "shot",
  "shotValue": 3,
  "made": true,
  "shotDetails": {
    "location": {
      "x": 0.18,
      "y": 0.72
    },
    "pressure": "open",
    "phase": "transition",
    "contexts": ["second_chance"],
    "creation": "cut"
  }
}
```

Rules:

- `shotDetails` is optional.
- Every nested field is optional and may be entered independently.
- `location.x` and `location.y` are finite normalized values from `0` through `1`.
- Coordinates use one standardized offensive half-court orientation with the attacking basket in the same place for team and opponent shots.
- Left and right are interpreted from the shooting offense's perspective.
- `contexts` contains unique supported values.
- `shotDetails` is invalid on free throws and non-shot events.
- Zone, side, distance, and expected point value are derived from coordinates and are not persisted.
- Changing an event away from a field goal removes `shotDetails`.

Separating `phase` from `contexts` avoids false exclusivity: an attempt can be either half-court or transition while also being a second-chance attempt.

## Schema compatibility

The game schema moves from version 1 to version 2.

- Add a pure `upgradeGame` path that clones a version-1 game, assigns schema version 2, and leaves existing events unchanged.
- Upgrade stored version-1 games in memory when they are read.
- Do not persist an upgraded game merely because tracker or Review mode opened it.
- Persist version 2 only after a normal mutation or explicit import.
- Accept version-1 game backups, upgrade them in memory, validate version 2, and then import them.
- Export only version-2 games after the feature ships.
- Preserve the existing backup-envelope version unless the envelope itself changes.
- Reject unknown future schema versions explicitly.

In-memory upgrade is required so opening an older game in Review mode continues to perform zero IndexedDB writes.

## Court geometry

Use a reusable inline SVG half court with a stable logical coordinate system representing a regulation 50-by-47-foot half court.

The initial geometry uses NBA court markings: the basket center is 5.25 feet from the baseline, the restricted-area radius is 4 feet, the three-point arc radius is 23.75 feet, and corner threes are 22 feet from the basket with straight lines through 14 feet from the baseline.

The geometry module owns:

- Coordinate normalization and clamping.
- Conversion between SVG/pointer coordinates and normalized storage coordinates.
- Basket, backboard, paint, restricted area, free-throw circle, sidelines, baseline, corner-three lines, and three-point arc.
- Approximate distance from the basket.
- Zone and side classification.
- Expected 2PT or 3PT value.

Initial derived zones:

- Restricted area
- Paint, non-restricted
- Short midrange
- Long midrange
- Left corner three
- Right corner three
- Above-break three, left
- Above-break three, center
- Above-break three, right

Zone boundary behavior must be deterministic and covered with geometry tests.

## Shot-value consistency

The map must never silently rewrite a recorded shot.

- If the selected location clearly conflicts with `shotValue`, show the derived value and ask whether to change the event.
- Allow the coach to keep the original value because video perspective and line proximity can be ambiguous.
- Use a small tolerance around the three-point line before showing a mismatch warning.
- Do not apply location/value checks to free throws.

## Capture experience

Basic event capture remains one click and persists immediately.

After recording a field goal:

- Show a compact, non-blocking **Add shot details** panel for the newly created event.
- Keep the event saved if the panel is skipped or dismissed.
- Present the half-court map first, followed by one-tap chips for pressure, phase, contexts, and creation.
- Allow fields to be entered in any order.
- Provide **Clear location**, **Clear details**, and **Done** actions.
- Close or retarget the panel safely when another event is recorded.
- Surface save failures without presenting unsaved details as successful.

Desktop uses an inline detail panel near event entry. Mobile uses a full-width sheet or stacked panel with the court map sized for accurate touch input.

The shared map supports:

- Pointer click or tap to place a marker.
- Pointer drag or another click to correct it.
- A visible marker with a larger invisible touch target.
- Keyboard placement and arrow-key adjustment.
- An announced derived zone, distance, and expected shot value.

## Correction workflow

The existing event editor gains the same reusable shot-detail component when editing a 2PT or 3PT shot.

- Existing coordinates and tags populate the controls.
- Changing shot result does not clear details.
- Changing between 2PT and 3PT runs the consistency check.
- Changing to a free throw or non-shot event clears shot details after explicit confirmation when data would be lost.
- Failed storage leaves the original event and details unchanged.

## Timeline and Review presentation

Shot descriptions retain the existing player, result, value, and score text.

When details exist, show a compact secondary line or badges, for example:

```text
Left corner 3 · Open · Transition · Catch-and-shoot
```

Requirements:

- Omit missing dimensions without placeholders.
- Do not overload the primary event description.
- Keep badges readable at narrow widths.
- Add filters for derived zone, pressure, phase, context, and creation.
- Preserve earliest/latest ordering, playback following, comments, and zero-write Review behavior.
- Review mode displays details and filters but never renders editing controls.

## Reports

### Shot chart

- Half-court plot with made and missed markers.
- Team, opponent, and selected-player views.
- Marker selection seeks to the existing three-second pre-roll in Review mode.
- Filters for pressure, phase, context, creation, player, and result.
- Multiple shots at the same location remain discoverable rather than fully overlapping.
- Accessible event list or focusable markers exposes equivalent information.

### Efficiency splits

For each supported dimension, report:

- Made
- Attempted
- Percentage
- Points per attempt
- Source-event navigation

Primary report sections:

- Zone
- Pressure
- Half court versus transition
- Second chance
- Creation type

Missing details belong to an explicit **Not tagged** bucket so partial adoption does not disappear from totals.

## Milestones

### Milestone 0: Contract, geometry, and migration fixtures

**Status:** Complete.

Deliver:

- Final version-2 event contract and enum values.
- Version-1 to version-2 in-memory upgrader.
- Regulation half-court geometry constants.
- Pure coordinate, distance, zone, side, and shot-value derivation helpers.
- Fixtures covering old games, partial details, complete details, boundary locations, and invalid values.

Verification:

- Existing version-1 games and backups load without writes.
- Unknown schema versions fail explicitly.
- Coordinate round-trips remain within a defined tolerance.
- Zone and three-point boundary cases are deterministic.
- Existing reports are unchanged when no details exist.

### Milestone 1: Reusable court map

**Status:** Complete.

Deliver:

- Responsive SVG half-court component.
- Pointer placement and correction.
- Keyboard placement and arrow-key adjustment.
- Marker clearing.
- Derived zone, distance, and expected-value status.
- Desktop and mobile sizing.

Verification:

- Pointer coordinates map correctly after responsive scaling.
- Touch targets remain usable on narrow screens.
- Keyboard users can place, move, and clear a marker.
- The map causes no page overflow and requires no external assets or build step.

### Milestone 2: Optional capture and correction

**Status:** Complete.

Deliver:

- Non-blocking post-shot detail panel.
- Pressure, phase, context, and creation chips.
- Incremental persistence with explicit failures.
- Shot-value mismatch confirmation.
- Shared detail editor in event correction.
- Data-loss confirmation when changing event type.

Verification:

- Basic shot entry remains one click.
- Skipping details produces the existing event shape and statistics.
- Every optional field can be independently added, changed, or cleared.
- Failed writes preserve the original event.
- Free throws and non-shot events cannot retain shot details.

### Milestone 3: Timeline, filters, and Review

**Status:** Complete.

Deliver:

- Compact shot-detail badges.
- Filters for all stored and derived dimensions.
- Read-only details in Review mode.
- Playback navigation from filtered results.
- Backup and reload preservation.

Verification:

- Details remain correct under timeline reordering and filtering.
- Review interactions perform zero store writes.
- Existing comments, score labels, playback following, and accessibility remain intact.
- Version-1 and untagged events display normally.

### Milestone 4: Shot chart and analytical reports

**Status:** Complete.

Deliver:

- Team, opponent, and player shot charts.
- Made/missed visual distinction.
- Focusable or equivalently accessible source events.
- Zone, pressure, phase, context, and creation efficiency splits.
- **Not tagged** totals.
- Report-source playback.

Verification:

- Chart and split totals reconcile with the existing field-goal report.
- Player totals reconcile with team totals.
- Filters produce deterministic event sets.
- Marker and report navigation seek to the expected pre-roll.
- Dense and duplicate locations remain usable.

### Milestone 5: Release hardening

Deliver:

- Complete shot-details release scenario.
- Version-1 store and backup regression coverage.
- Tracker and Review responsive coverage.
- Keyboard and pointer coverage.
- Updated user documentation.
- GitHub Pages verification checklist.

Verification:

- Full planner and stats suites pass.
- Existing one-click entry, editing, reports, backup, and Review workflows remain green.
- Direct Review reload preserves shot details.
- Review continues to perform zero persistent writes.
- A deployed-site check confirms real YouTube playback and court-map interaction.

## Release scenario

The release gate must:

1. Load a version-1 game and upgrade it in memory without writing.
2. Record a basic field goal without details.
3. Record field goals with map location and every context category.
4. Correct and clear selected details.
5. Exercise a 2PT/3PT location mismatch and both confirmation choices.
6. Reload and verify persistence.
7. Export and re-import a version-2 backup.
8. Inspect timeline badges and filters.
9. Open Review mode and confirm editing controls are absent.
10. Inspect team, opponent, and player shot charts.
11. Verify analytical splits reconcile with existing totals.
12. Navigate chart and report source events with pre-roll.
13. Confirm Review interactions make zero store writes.
14. Verify desktop and mobile court-map interaction.

## Deferred follow-up features

After real usage of shot details is evaluated, consider separate plans for:

1. Turnover type and forced/unforced context.
2. Contested rebounds and box-out results.
3. Foul category and shooting result.

Detailed assist, steal, block, substitution, and timeout metadata remains deferred unless coaches demonstrate a clear reporting need.
