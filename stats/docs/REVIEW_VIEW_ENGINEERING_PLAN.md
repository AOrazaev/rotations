# Stats Review View Engineering Plan

## Purpose

Add a focused, read-only Review view to Stats & Video Review. The existing workspace is optimized for a coach who is creating or correcting the event timeline. Review view is for watching the recording, inspecting the resulting statistics, and discussing selected moments without exposing data-entry and game-management controls.

Review view remains part of the existing static GitHub Pages application. It uses the same validated game model, IndexedDB store, video adapter, timeline rendering, reducers, and reports.

## Product outcome

A coach can:

1. Open a saved game in Review view.
2. Watch the attached YouTube recording.
3. Navigate the event timeline and source events with the existing three-second pre-roll.
4. Filter and reorder the timeline.
5. Inspect team, player, and lineup reports.
6. Select a player and review that player's commented moments.
7. Copy player feedback for Telegram or as a YouTube timestamp comment.
8. Exit Review view and return to the normal stats workspace.

Review view must not create, edit, delete, archive, import, or otherwise persist game data.

## Scope decisions

### Included

- Same-browser viewing of games already stored in IndexedDB.
- A dedicated read-only application mode.
- Direct routing to a saved game.
- Video playback and keyboard shortcuts.
- Event timeline playback, filtering, and ordering.
- Team, player, lineup, and player-feedback reports.
- Responsive desktop, tablet, and mobile layouts.
- Clipboard copy actions that do not modify the saved game.

### Excluded

- A second-screen or live-updating display.
- Synchronization between tracker and Review view tabs.
- Polling, `BroadcastChannel`, or other background update mechanisms.
- Public or cross-device share links.
- Cloud storage, accounts, permissions, or access control.
- Portable HTML report generation.
- Editing comments or any other game data.

Review view displays the latest saved snapshot when it is opened or reloaded. It does not need to reflect changes made elsewhere while it remains open.

## Read-only semantics

Review view is a product capability boundary, not a security boundary. A user who owns the browser data can exit Review view and use the normal workspace.

Read-only behavior must be enforced by application composition rather than CSS alone:

- Do not initialize event-entry, event-correction, game-setup, backup-import, archive, or delete interactions.
- Do not render mutation controls.
- Do not call `saveGame`, `deleteGame`, or any import operation during Review view interaction.
- Continue to allow non-persistent state such as selected filters, timeline order, selected player, and video playback position.
- Clipboard operations are allowed because they do not change the stored game.

Automated tests must instrument the store and verify that ordinary Review view interactions perform no writes.

## Routing

Use the existing stats application entry point with explicit query parameters:

```text
/stats/?mode=review&game=<game-id>
```

Routing requirements:

- Encode the game ID when generating the URL.
- Load and validate the requested game before rendering Review view.
- Remove unrelated planner-import parameters.
- Preserve the route across reload.
- Show an actionable state when `mode=review` has no game ID.
- Show an actionable state when the requested game does not exist or is invalid.
- Provide an **Exit review** action that returns to the normal `/stats/` workspace.
- Archived games remain unavailable until restored through the normal workspace.

A game ID in the URL is only a local reference. It does not make the game available in another browser or device.

## Application structure

Prefer a mode-aware composition of the existing application over a separate duplicated page.

Shared surfaces:

- Game validation and IndexedDB reads
- YouTube adapter and video controller
- Event timeline formatting and playback
- Event filters and timeline ordering
- Event reducer and derived reports
- Player feedback attribution and copy formatting

Tracker-only surfaces:

- Game setup and roster editing
- Event entry and substitutions
- Event correction, deletion, and comment editing
- Undo
- Backup import/export and archive/delete controls

Review-only coordination should remain small. It should load one game, initialize the shared read-only renderers, expose navigation, and tear down video/listeners cleanly when leaving the mode.

## Milestones

### Milestone 0: Review contract and fixtures

Deliver:

- Final visible-surface inventory.
- Routing and missing-game behavior.
- Read-only invariants.
- Desktop, mobile, and archived-game behavior.
- A representative fixture with scoring, substitutions, comments, mentions, and report data.

Verification:

- Every visible action is classified as persistent or non-persistent.
- No required workflow depends on tracker-only controls.
- The existing representative game fixture can express the complete Review view scenario.

### Milestone 1: Entry and routing

Deliver:

- A **View** action for eligible saved games.
- Review-mode query parsing.
- Direct game loading from IndexedDB.
- Loading, invalid-route, missing-game, and unavailable-game states.
- An **Exit review** action.
- Reload-safe routing.

Verification:

- View opens the selected saved game.
- Reload returns to the same game in Review view.
- Missing or malformed parameters produce an actionable message.
- A nonexistent or archived game does not open a partial workspace.
- Normal `/stats/` startup and planner handoff remain unchanged.

### Milestone 2: Read-only boundary

Deliver:

- Mode-aware controller composition.
- No game setup, event entry, correction, deletion, comment editing, undo, backup, archive, or import controls.
- No mutation handlers registered in Review mode.
- Shared non-persistent timeline and report interactions.
- Clean controller teardown when exiting Review view.

Verification:

- Review view can play events, change filters, change timeline order, select reports, and select players.
- Instrumented store methods confirm zero saves, deletes, or imports during those interactions.
- Direct DOM manipulation cannot reveal an initialized mutation workflow.
- Tracker mode retains all existing editing behavior.

### Milestone 3: Review-focused layout

Deliver:

- A compact Review view header with game, opponent, and exit context.
- Video and current score as the primary surface.
- Clear navigation between Timeline, Team, Players, Lineups, and Feedback.
- Existing timestamp playback and source-event navigation.
- Existing Space and Arrow video shortcuts.
- Responsive desktop, tablet, and mobile layouts.
- A distraction-free presentation without setup or capture panels.

Verification:

- All report content remains reachable at supported viewport sizes.
- The page has no unintended horizontal overflow.
- Timeline and report timestamps seek to the expected three-second pre-roll.
- Keyboard shortcuts do not intercept form controls such as filters or player selection.
- Focus order and accessible names describe the Review view controls.

### Milestone 4: Player-focused review

Deliver:

- A player selector using the saved game roster.
- The selected player's summary statistics.
- Commented moments attributed through:
  - Direct player attribution
  - Substitution involvement
  - Exact `@NUMBER` mentions
  - Case-insensitive `@team` mentions
- Previous/next navigation through selected feedback moments.
- Timestamp playback for each moment.
- Telegram and YouTube copy formats.
- An explicit empty state for players without feedback.

Verification:

- The event set matches the existing player-feedback attribution rules.
- Previous/next navigation follows canonical event order.
- Every moment seeks to the correct pre-roll timestamp.
- Copy output remains identical to the normal report workflow.
- Selecting a player or feedback moment does not modify the game.

### Milestone 5: Release hardening

Deliver:

- Complete Playwright Review view scenario.
- Regression coverage for normal tracker mode.
- Responsive and keyboard coverage.
- Store write-invariant coverage.
- User documentation and route limitations.
- GitHub Pages compatibility without a build step.

Verification:

- Full planner and stats test suites pass.
- Review view works after a direct page reload.
- Normal tracking, editing, backup, and recovery workflows remain green.
- The static application works without a backend.
- A manual deployed-site check confirms real YouTube playback.

## Release scenario

The release gate must complete this workflow:

1. Create or import a game with at least six players.
2. Attach a YouTube recording.
3. Record team and opponent scoring events.
4. Record a substitution.
5. Add direct, `@NUMBER`, and `@team` coach comments.
6. Open the game in Review view.
7. Confirm tracker and game-management controls are absent.
8. Play timeline events and report source events.
9. Filter and reorder the timeline.
10. Inspect team, player, and lineup reports.
11. Select a player and navigate through that player's feedback moments.
12. Copy Telegram and YouTube feedback formats.
13. Reload and return to the same Review view game.
14. Confirm no persistent store methods were called.
15. Exit Review view and confirm normal tracker mode still opens the game.

## Future extensions

The following ideas require separate product and engineering decisions:

- Public or cross-device review links
- Cloud persistence and access control
- Portable read-only report packages
- Live second-screen synchronization
- Player-specific redacted exports

They are not prerequisites for the local Review view and should not add complexity to this feature.
