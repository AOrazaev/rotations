# Real audio evaluation set v1

This set contains sixteen short English basketball-stat recordings collected
during local voice companion development. The recording owner explicitly
approved committing the audio to this repository.

The manifest uses synthetic player IDs and names. Ground-truth transcripts and
events were manually curated from the intended spoken commands rather than
copied blindly from the originally saved proposals, several of which captured
known model failures.

Coverage includes:

- Single-player made and missed shots.
- Teen/tens jersey-number confusion.
- Opponent shots, rebounds, fouls, and timeout.
- Assist/scorer attribution.
- Four-event command grounding.
- Transition shot-phase attribution.
- Deterministic substitutions.
- Opponent turnover and standalone foul commands.
- Multi-event miss, offensive rebound, and turnover sequencing.
- Two-word `turn over` recovery when the command model omits the event.

Run the complete audio-to-events evaluation from the repository root:

```powershell
$env:PYTHONPATH = "$PWD\voice-companion\src"
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --output .\real-audio-evaluation.json
```

The evaluator reports raw transcription matches separately from
active-lineup-normalized transcription and exact semantic event arrays.

`baseline-balanced.json` records the sixteen-case balanced-profile run with
`base.en` and `Qwen3-4B-Q4_K_M.gguf`:

- 13/16 raw transcript matches.
- 14/16 roster-normalized transcript matches.
- 14/16 exact semantic event arrays.
- 1 processing error.

The new `number-7-miss-number-70-rebound-turnover` case passes with all three
events after adding support for Whisper's two-word `turn over` phrasing.
Remaining weaknesses are the `seven two` transcription of jersey #70 and an
occasional command-model rebound response that omits `reboundKind`. The
`number-70-miss-opponent-rebound` event array is correct, but strict transcript
matching still rejects Whisper's `defensively rebound` wording.
