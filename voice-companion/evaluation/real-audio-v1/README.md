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

The default `both` mode runs the interpreter twice for every case: once with
the transcribed audio and once with the curated transcript. Run only one stage
when comparing a transcription or command-model change:

```powershell
# Audio -> transcription -> events
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --mode end-to-end `
  --output .\real-audio-end-to-end.json

# Curated transcript -> events; Whisper is not loaded
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --mode interpretation-only `
  --output .\real-audio-interpretation-only.json
```

Transcript equality remains diagnostic only. Exact semantic event arrays are
the pass criterion for both paths. In paired mode, an end-to-end event failure
is classified as `transcription` when curated-transcript interpretation passes;
otherwise it is classified as `interpretation`.

`baseline-balanced.json` records the sixteen-case balanced-profile run with
`base.en` and `Qwen3-4B-Q4_K_M.gguf`:

- 12/16 raw transcript matches.
- 13/16 roster-normalized transcript matches.
- 14/16 exact semantic event arrays.
- 0 processing errors.

The refreshed reports are functional accuracy snapshots. Another companion
process may have been active during collection, so their latency fields are not
valid performance measurements and must be regenerated on an otherwise idle
machine before making profile or hardware decisions.

`baseline-balanced-interpretation-only.json` runs the same command model
against curated transcripts without loading Whisper:

- 16/16 exact semantic event arrays.
- 0 interpretation errors.
- `number-70-makes-two-assist-number-60` passes, confirming that its `seven
  two` failure is caused by transcription.
- `number-60-defensive-rebound` passes because explicit offensive or defensive
  wording now repairs a missing or contradictory `reboundKind` before strict
  validation.

The new `number-7-miss-number-70-rebound-turnover` case passes with all three
events after adding support for Whisper's two-word `turn over` phrasing.
Remaining end-to-end weaknesses are the `seven T` and `seven two`
transcriptions of jersey #70 when both #7 and #70 are active. They remain known
transcription failures rather than targets for ambiguous roster-based
correction.
