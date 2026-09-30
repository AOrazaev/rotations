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
- Track the active lineup and derive team, player, lineup, plus/minus, EFF, and TS% reports from the event log.
- Add coach comments and copy selected player feedback for Telegram or as a YouTube timestamp comment.
- Open any active saved game in a read-only Review view with playback-following timeline navigation and player-focused feedback.
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

Review view removes setup, event-entry, correction, comment, archive, import, and backup controls. It keeps video playback, timeline filtering and ordering, reports, player summaries, feedback navigation, and clipboard actions. The timeline starts earliest-first, highlights the current playback event, and follows playback until you manually scroll it; choose **Follow playback** or play a timeline timestamp to resume following.

Review URLs identify a game in IndexedDB in the **same browser and site origin**. They are reload-safe, but they are not public or cross-device sharing links. Another browser, device, private window, cleared site-data profile, or different deployment origin will not have that game. Export a JSON backup to move a game elsewhere.

Archived games cannot open in Review view. Return to normal tracker mode, restore the game, and choose **View** again. See [`stats/docs/REVIEW_VIEW.md`](stats/docs/REVIEW_VIEW.md) for the complete workflow and limitations.

## Run locally

Serve the repository root so browser modules, IndexedDB, and both applications use the same origin:

```bash
python3 -m http.server 8000
```

Open:

- <http://localhost:8000/> for the rotation planner
- <http://localhost:8000/stats/> for Stats & Video Review

## Storage, backups, and privacy

All data remains in the current browser:

- The planner stores its roster, settings, and latest rotation in `localStorage`.
- Stats & Video Review stores games and event timelines in IndexedDB database `basketball-stats`.
- A short-lived `localStorage` handoff transfers a planner roster into a new stats game.

Nothing is uploaded to an application server. Clearing site data or using another browser/device removes access to local data, so export JSON backups for games that must be retained or moved. Imported backups are validated and never overwrite a game with the same ID.

## Tests

[Playwright](https://playwright.dev/) drives Chromium against the unbuilt static files:

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

The suite covers the planner algorithm and UI, the stats data contract and IndexedDB store, YouTube integration through a fake player, event entry and correction, lineup replay, reports and feedback, responsive layout, backup recovery, the complete MVP workflow, and the end-to-end read-only Review release gate. GitHub Actions runs the suite on every push and pull request.

## Deploy to GitHub Pages

The repository is ready for GitHub Pages **Deploy from a branch** with the repository root as the publishing directory. Configure the source branch in **Settings → Pages**; no build or deployment workflow is required. Keep the root files plus the `js/`, `shared/`, and `stats/` directories together so relative URLs continue to work.

After publishing, manually confirm:

1. The root planner and `/stats/` load without a build step.
2. An embeddable YouTube video plays in tracker and Review modes.
3. **View** opens a saved game and a direct reload preserves its Review route.
4. Timeline playback-following, reports, feedback navigation, and **Exit review** work.

YouTube availability and embedding permissions are external to this application.
