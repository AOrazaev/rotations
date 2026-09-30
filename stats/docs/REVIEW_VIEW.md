# Read-only Review view

Review view is a presentation-focused workspace for watching a saved game, following its event timeline, inspecting reports, and discussing player feedback without exposing tracker mutation controls.

## Open a game

1. Open `/stats/` in the browser that contains the saved game.
2. Find an active game in the Games list.
3. Choose **View**.

The browser opens:

```text
/stats/?mode=review&game=<game-id>
```

Reloading that URL reopens the same game. Choose **Exit review** to return to normal tracker mode.

## What Review view allows

- Play, pause, and seek the attached YouTube recording.
- Use Space to play or pause and Left/Right Arrow to seek three seconds.
- Follow the current event as playback advances. Desktop layouts scroll within the timeline automatically.
- Manually scroll the desktop event list; this pauses automatic scrolling until **Follow playback** is selected.
- Keep the video in place on mobile while the active event continues to update, then choose **Jump to current event** to scroll there explicitly.
- Filter the timeline, remove applied filters directly from the chips above it, and switch between earliest-first and latest-first ordering. Less common shot dimensions are grouped under **Detailed shot filters**.
- Inspect team, player, lineup, score-progression, shot-analysis, and source-event reports.
- Filter team, opponent, and player shot maps by period, result, pressure, phase, context, and creation.
- Select shot markers, efficiency zones, and linked split values to navigate to source plays.
- Select a player, inspect summary statistics, and move through attributed feedback moments.
- Copy selected feedback for Telegram or as a YouTube timestamp comment.

Review mode does not expose setup, event entry, correction, deletion, coach-comment editing, archive, restore, import, export, or backup controls. Its filters, selected reports, playback position, and feedback selection are browser presentation state and do not modify the saved game.

## Share a published game

A Shared Review link uses the same read-only workspace but loads a public JSON backup from the deployment instead of IndexedDB. It can be opened in another browser or on another device.

1. Export the game backup from tracker mode.
2. Save it in the repository as `games/<safe-name>.json`.
3. Commit and push the file, then wait for GitHub Pages to deploy it.
4. Share:

```text
https://aorazaev.github.io/rotations/stats/?mode=shared&game=<safe-name>
```

The safe name:

- Must start with a lowercase letter or number.
- May contain lowercase letters, numbers, `_`, and `-`.
- Must not include `.json`, whitespace, slashes, or URL schemes.
- Must be no more than 80 characters.

`games/game-20260927.json`, for example, uses:

```text
https://aorazaev.github.io/rotations/stats/?mode=shared&game=game-20260927
```

Shared Review accepts only same-deployment files under `/games/`. The response is limited to 1 MiB and must be a valid Basketball Stats backup. The game is parsed and rendered in memory; it is not imported into IndexedDB, and reloading the URL fetches the published file again.

Anything committed under `/games/` is public repository and GitHub Pages content. Review the exported game and remove private player information or comments before publishing it. To revise a snapshot, replace the JSON file and redeploy; to preserve an immutable historical link, publish revisions under new names.

## Player feedback attribution

A commented event appears for a player when any of these rules apply:

- The event directly names the player.
- The player enters or leaves in a substitution event.
- The comment contains an exact, case-insensitive `@NUMBER` mention.
- The comment contains a case-insensitive `@team` mention.

For example, `@2` applies to jersey 2 but not jersey 20.

## Browser-local route limitation

Games are stored in IndexedDB under the current browser and site origin. A Review URL identifies one of those local records; it does not contain or upload the game.

Consequently, the URL will not open the game in:

- Another browser or device
- A private browsing profile
- A profile whose site data was cleared
- A deployment with a different origin

Export a JSON backup from tracker mode and import it into the destination browser before using Review there.

Alternatively, publish the backup under `/games/` and use a Shared Review link as described above.

## Archived and unavailable games

Archived games cannot open directly in Review view. Exit to tracker mode, enable archived games, restore the game, and choose **View** again.

Missing, malformed, corrupt, archived, and storage-failure routes show an explicit message instead of falling back to an empty or editable workspace. Shared Review also reports unsafe names, missing files, download failures, oversized responses, and invalid backup files explicitly.

## GitHub Pages release check

The application uses checked-in HTML, CSS, and JavaScript directly; Review view requires no backend or build step. After deploying:

1. Open `/stats/` and load or import a game with an embeddable YouTube recording.
2. Choose **View** and confirm real video playback.
3. Play timeline and feedback moments.
4. Inspect shot badges and team, opponent, and player shot reports.
5. Exercise period and detail filters, then select a marker or zone and confirm three-second pre-roll.
6. Reload the Review URL and confirm the same game and shot details return.
7. Exit Review and reopen the game in tracker mode.
8. Open a published Shared Review link in a clean browser profile, exercise playback and reports, reload it, and confirm no local game was created.

YouTube availability and embedding permission remain external to the application.
