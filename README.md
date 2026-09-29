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
- Export versioned JSON backups, import them without overwriting existing games, and archive or restore games.

Video shortcuts are available outside form fields:

| Key | Action |
|---|---|
| `Space` | Play or pause |
| `←` | Seek back 3 seconds |
| `→` | Seek forward 3 seconds |

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

The suite covers the planner algorithm and UI, the stats data contract and IndexedDB store, YouTube integration through a fake player, event entry and correction, lineup replay, reports and feedback, responsive layout, backup recovery, and the complete MVP release workflow. GitHub Actions runs the suite on every push and pull request.

## Deploy to GitHub Pages

The repository is ready for GitHub Pages **Deploy from a branch** with the repository root as the publishing directory. Configure the source branch in **Settings → Pages**; no build or deployment workflow is required. Keep the root files plus the `js/`, `shared/`, and `stats/` directories together so relative URLs continue to work.

After publishing, manually confirm both the root planner URL and `/stats/`, including playback of an embeddable YouTube video. YouTube availability and embedding permissions are external to this application.
