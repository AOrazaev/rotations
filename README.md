# Basketball Rotation Planner and Stats Review

A browser-only basketball toolkit designed for static hosting on GitHub Pages. It has no backend, accounts, runtime dependencies, or build step.

- `/` — plan balanced 40-minute rotations from the available roster.
- `/stats/` — review a recorded game, capture timestamped events, and generate reports and player feedback.

## Rotation planner

- Edit player names, jersey numbers, positions, skill ratings, and attendance.
- Set optional minimum/maximum minutes and maximum consecutive blocks.
- Choose 4- or 5-minute blocks and adjust competitive intensity.
- Generate, regenerate, manually swap, undo, redo, and print rotations.
- Send the available roster and optional planned rotation into Stats & Video Review.

## Stats and Video Review

- Create standalone games or import the current planner roster.
- Attach an embeddable YouTube recording and capture events at its current timestamp.
- Record team and opponent shots, rebounds, assists, steals, blocks, turnovers, fouls, timeouts, period markers, notes, and substitutions.
- Correct, delete, filter, reorder, and replay timeline events with a three-second pre-roll.
- Optionally enrich field goals with court location, pressure, phase, second-chance context, and creation type.
- Track the active lineup and derive team, player, lineup, plus/minus, EFF, and TS% reports from the event log.
- Inspect team, opponent, and player shot maps with period filters, color-coded zone efficiency, detail splits, and source-play navigation.
- Add coach comments and copy selected player feedback for Telegram or as a YouTube timestamp comment.
- Open any active saved game in a read-only Review view with playback-following timeline navigation and player-focused feedback.
- Publish a backup under `/games/` and share a read-only game URL that works across browsers and devices.
- Export versioned JSON backups, import them without overwriting existing games, and archive or restore games.

Video shortcuts are available outside form fields:

| Key | Action |
|---|---|
| `Space` | Play or pause |
| `←` | Seek back 3 seconds |
| `→` | Seek forward 3 seconds |

### Read-only Review view

Choose **View** on an active saved game to open:

```text
/stats/?mode=review&game=<game-id>
```

Review view removes setup, event-entry, correction, comment, archive, import, and backup controls. It keeps video playback, timeline filtering and ordering, reports, player summaries, feedback navigation, and clipboard actions. The timeline starts earliest-first and highlights the current playback event. On desktop it follows playback until you manually scroll it; choose **Follow playback** or play a timeline timestamp to resume following. On mobile, highlighting does not move the page away from the video; choose **Jump to current event** when you want to move to the active timeline entry.

Review URLs identify a game in IndexedDB in the **same browser and site origin**. They are reload-safe, but they are not public or cross-device sharing links. Another browser, device, private window, cleared site-data profile, or different deployment origin will not have that game. Export a JSON backup to move a game elsewhere.

Archived games cannot open in Review view. Return to normal tracker mode, restore the game, and choose **View** again. See [`stats/docs/REVIEW_VIEW.md`](stats/docs/REVIEW_VIEW.md) for the complete workflow and limitations.

### Shared Review links

To publish a game for link-only viewing:

1. Export its JSON backup from tracker mode.
2. Add the file as `games/<safe-name>.json`, where the name uses only lowercase letters, numbers, `_`, or `-`, starts with a letter or number, and is at most 80 characters.
3. Commit and push the file so GitHub Pages deploys it.
4. Share:

```text
https://aorazaev.github.io/rotations/stats/?mode=shared&game=<safe-name>
```

For example, `games/game-20260927.json` is opened by:

```text
https://aorazaev.github.io/rotations/stats/?mode=shared&game=game-20260927
```

The page downloads and validates the backup from the same deployment's `/games/` directory, then renders it entirely in memory using the read-only Review workspace. It does not import or save the game to IndexedDB. Published backups are public repository and GitHub Pages content; do not publish private player information or comments.

Shared Review timeline filters are represented in the URL. Apply side, event type, player, comment, zone, pressure, phase, context, or creation filters, then choose **Copy filtered link** beside the applied-filter chips. Opening that link restores the filters, and later filter changes keep the address bar synchronized. Invalid values and player IDs absent from the published game are removed automatically.

See [`stats/docs/SHOT_DETAILS.md`](stats/docs/SHOT_DETAILS.md) for shot entry, correction, filters, reports, compatibility, and deployment verification.

## Run locally

Serve the repository root so browser modules, IndexedDB, and both applications use the same origin:

```bash
python3 -m http.server 8000
```

Open:

- <http://localhost:8000/> for the rotation planner
- <http://localhost:8000/stats/> for Stats & Video Review

## Storage, backups, and privacy

By default, all working data remains in the current browser:

- The planner stores its roster, settings, and latest rotation in `localStorage`.
- Stats & Video Review stores games and event timelines in IndexedDB database `basketball-stats`.
- A short-lived `localStorage` handoff transfers a planner roster into a new stats game.

Nothing is uploaded to an application server. Clearing site data or using another browser/device removes access to local data, so export JSON backups for games that must be retained or moved. Imported backups are validated and never overwrite a game with the same ID.

The exception is a backup you intentionally commit under `/games/` for Shared Review. That file becomes public static content and is downloaded by viewers without being persisted as a local game.

## Tests

[Playwright](https://playwright.dev/) drives Chromium against the unbuilt static files:

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

The suite covers the planner algorithm and UI, the stats data contract and IndexedDB store, YouTube integration through a fake player, event entry and correction, lineup replay, shot details and reports, responsive layout, backup recovery, shared static-game loading, the complete MVP workflow, and end-to-end tracker and read-only Review release gates. GitHub Actions runs the suite on every push and pull request.

## Deploy to GitHub Pages

The repository is ready for GitHub Pages **Deploy from a branch** with the repository root as the publishing directory. Configure the source branch in **Settings → Pages**; no build or deployment workflow is required. Keep the root files plus the `js/`, `shared/`, and `stats/` directories together so relative URLs continue to work.

After publishing, manually confirm:

1. The root planner and `/stats/` load without a build step.
2. An embeddable YouTube video plays in tracker and Review modes.
3. **View** opens a saved game and a direct reload preserves its Review route.
4. Shot entry works with pointer and keyboard input and survives reload plus backup recovery.
5. Team, opponent, and player shot reports reconcile with the timeline and support period filtering.
6. Timeline playback-following, source-play navigation, feedback navigation, and **Exit review** work.
7. A published `/games/*.json` backup opens through `?mode=shared&game=<safe-name>` in a clean browser and survives reload.

YouTube availability and embedding permissions are external to this application.
