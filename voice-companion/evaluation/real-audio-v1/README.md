# Real audio evaluation set v1

This set contains eight short English basketball-stat recordings collected
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

Run the complete audio-to-events evaluation from the repository root:

```powershell
$env:PYTHONPATH = "$PWD\voice-companion\src"
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --output .\real-audio-evaluation.json
```

The evaluator reports raw transcription matches separately from
active-lineup-normalized transcription and exact semantic event arrays.

`baseline-balanced.json` records the first balanced-profile run with
`base.en` and `Qwen3-4B-Q4_K_M.gguf`:

- 6/8 raw transcript matches.
- 7/8 roster-normalized transcript matches.
- 7/8 exact semantic event arrays.
- 0 processing errors.

The remaining failure is `number-70-miss-opponent-rebound`: Whisper produced
`seven T`, and both #7 and #70 were active, so conservative normalization did
not guess.
