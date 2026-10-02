# Voice Companion Checkpoint 3

## Status

In progress. Structured command interpretation works end to end through the
standalone Windows workbench with the official Qwen3 4B Q4_K_M GGUF model.

## Implemented

- `llama-cpp-python 0.3.35` local runtime.
- Official Apache-2.0 `Qwen/Qwen3-4B-GGUF` Q4_K_M model.
- User-local command-model storage and download manifest.
- PowerShell runtime and model installer.
- Lazy model loading.
- Deterministic temperature, seed, prompt, and `/no_think` behavior.
- JSON-schema-constrained model output.
- Independent validation of event types, player IDs, event-specific fields,
  confidence, warnings, and request-allowed event types.
- Dynamic few-shot examples grounded in the supplied roster.
- Deterministic score-before-assist ordering.
- Rejection of silently omitted explicitly spoken event types.
- Safe removal of exact duplicate model events with an explicit warning.
- `POST /v1/interpret-command` for transcript-only workbench testing.
- Workbench transcript fixtures, structured proposal display, warnings, and raw
  response inspection.
- Successful transcription remains available as `partialResult` when later
  interpretation fails.
- Persistent **Latest transcript** workbench panel.

## Native Windows observations

Validation machine:

- 12th Gen Intel Core i7-1265U.
- 31.8 GB RAM.
- Intel Iris Xe integrated graphics.
- CPU-only llama.cpp execution.

Initial Qwen3 measurements:

| Command | Result | Latency |
| --- | --- | ---: |
| `Seven assist and thirteen makes two in transition` | Correct shot and assist | 31.7–33.6 seconds cold |
| `Number twenty five misses free throw` | Correct missed free throw | 10.3 seconds warm |
| `He made it` | Correct warning with no proposal | 4.6–5.6 seconds warm |

The 4B model is accurate on the initial examples but currently too slow for a
final laptop profile without further optimization or a smaller-model
comparison.

## Manual acceptance

The first custom-roster command exposed three diagnosable issues:

```text
Assist by number 31, number 13 makes 3
```

- Qwen emitted an empty optional `shotDetails` object.
- Qwen duplicated the shot event.
- Qwen placed the assist before the shot.

The service now removes empty optional shot details, safely deduplicates exact
events with a warning, and normalizes score-before-assist ordering. The command
then returned a made three-point shot for player 13 followed by an assist for
player 31.

A microphone retry exposed `three-pointer` being transcribed as `full pointer`.
Basketball hotwords were expanded with two- and three-point phrases. The user
then confirmed this result:

```text
Transcript: assist by number 31 number 13 makes three pointer
Proposal: succeeded without an error
```

The user also confirmed that the transcript remains visible when interpretation
returns an error.

## Remaining gates

- Build and score a representative transcript corpus.
- Compare Phi-4-mini against the same corpus.
- Measure peak RAM and warm latency across the corpus.
- Investigate smaller command models and llama.cpp tuning for laptop latency.
- Run automated workbench coverage when Node/npm is available on Windows.
- Choose the initial command model using measured accuracy, latency, resource
  use, licensing, and deployment complexity.
