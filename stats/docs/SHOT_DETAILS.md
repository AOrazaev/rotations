# Shot details and shot reports

Shot details add optional location and context to 2PT and 3PT events. Recording a field goal still saves the event immediately; the details panel is an optional follow-up and can be ignored without losing the shot.

## Record a shot

1. Select our player or the opponent side.
2. Record a made or missed 2PT or 3PT shot.
3. Optionally place the shot on the half court.
4. Optionally tag:
   - Pressure: Open, Lightly contested, Contested, or Heavily contested
   - Phase: Half court or Transition
   - Context: Second chance
   - Creation: Catch-and-shoot, Pull-up, Drive, Cut, Post-up, Putback, or Other
5. Choose **Done** or continue recording events.

The court supports pointer and keyboard input. Focus it and press Enter or Space to place the first marker. Arrow keys move it by 1%; Shift+Arrow moves it by 5%. Delete or Backspace clears it.

If the selected location clearly disagrees with the recorded 2PT or 3PT value, the application asks whether to change the event. Locations close to the line do not trigger a suggestion.

## Correct an existing shot

Choose **Edit event** from a field goal in the timeline. Location and structured tags can be added, changed, or cleared before choosing **Save correction**. Changing made to missed, or missed to made, preserves shot details.

Changing an enriched field goal into a free throw or non-shot event requires confirmation because those event types cannot retain shot details.

## Timeline badges and filters

Enriched field goals show compact badges in this order:

1. Derived court zone
2. Pressure
3. Phase
4. Context
5. Creation

Timeline filters can combine shot zone, pressure, phase, context, and creation with the existing side, event-type, player, and comment filters. Open **Detailed shot filters** to access the shot dimensions; the section expands automatically when any are active. Applied filters appear as removable chips above the timeline. Values within one group use OR; different groups use AND. **No location** and **Not tagged** choices keep partially tagged and legacy shots visible.

## Shot reports

Open the **Shots** report to inspect:

- Team, opponent, or individual-player field goals
- Made and missed shot locations
- Zone makes/attempts and FG% on a color-coded half court
- Pressure, phase, context, and creation efficiency splits
- Overall makes, attempts, FG%, points per attempt, plotted shots, and no-location totals
- Result, period, pressure, phase, context, and creation filters

Zone colors compare points per attempt:

- Red: below 0.80
- Yellow: 0.80 through 1.09
- Green: 1.10 or higher

Color strength increases with attempts. Select a chart marker, zone, or linked split value to inspect its source events. Review mode seeks three seconds before the selected play.

Periods are derived from ordered **Period end** timeline markers. Without period markers, the report offers only **All periods**.

## Storage and compatibility

Shot details are stored in the game backup as schema version 2. Version-1 games and backups remain supported and are upgraded in memory when read. Merely opening a legacy game or Review route does not rewrite it; a later normal tracker mutation persists the current schema.

Review mode displays badges, filters, charts, and source navigation without exposing editing controls or writing to IndexedDB.

## GitHub Pages release checklist

After deploying the branch from the repository root:

1. Open the root planner and `/stats/` directly.
2. Create or import a game with an embeddable YouTube recording.
3. Record a basic field goal and confirm it saves before adding details.
4. Add a location with pointer input and another with keyboard input.
5. Add and correct structured tags, then reload and confirm they persist.
6. Exercise both choices in a clear 2PT/3PT location mismatch.
7. Export the game, delete it, re-import the backup, and confirm badges and reports return.
8. Filter the timeline by a tagged value and an untagged value.
9. Inspect team, opponent, and player shot reports, including period filtering and no-location totals.
10. Open Review mode and confirm editing controls are absent.
11. Select timeline events, shot markers, zones, and split values and confirm real YouTube playback seeks to the expected pre-roll.
12. Reload the Review URL and confirm the same game and shot details return.
13. Repeat court entry and report inspection at a narrow mobile width and confirm there is no horizontal page overflow.

YouTube availability and embedding permission are external to the application. Games and Review routes remain local to the current browser and deployment origin.
