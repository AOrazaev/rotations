# Voice Companion Checkpoint 4

## Status

Complete. The standalone companion is independently useful, diagnosable, and
stable on the capable laptop and gaming PC. The accepted initial configuration
uses CPU transcription and CPU Qwen3 interpretation; GPU acceleration remains
an optional optimization.

## Implemented

- `POST /v1/warmup`.
- Lazy transcription and command-model loading through one bounded processing
  slot.
- Per-model and total warmup timing.
- Actionable warmup error responses.
- Hardware detection without hostname, username, or other user identity data.
- Logical processor, physical-memory, CUDA-device, NVIDIA GPU, platform, and
  architecture reporting.
- Lightweight, balanced, or high-accuracy profile recommendation.
- Existing command-line transcription device, compute type, command-model path,
  context size, and GPU-layer overrides remain authoritative.
- Workbench **Warm models** control.
- Prominent loading, ready, and failure banners.
- Model identities and recommended profile in the readiness display.
- Collapsible raw warmup diagnostics.
- Reproducible gaming-PC setup and validation scripts.
- One redacted validation report containing dual-model warmup, repeated corpus
  accuracy and latency, process memory, and NVIDIA telemetry.

## Native Windows baseline

Validation machine:

- 12th Gen Intel Core i7-1265U.
- 12 logical processors.
- 31.8 GB physical memory.
- No CUDA device.
- Recommended profile: `balanced`.

Cold balanced-profile warmup:

| Component | Time |
| --- | ---: |
| faster-whisper `base.en` | 11,932 ms |
| Qwen3 4B Q4_K_M | 4,489 ms |
| Total | 16,422 ms |

Warmed service process:

- Working set: approximately 4,193 MB.
- Private memory: approximately 4,408 MB.

The Python virtual-environment launcher creates a small wrapper process; the
measurements above use the child Python process that owns the loaded models.

## Manual acceptance

The initial warmup implementation returned complete JSON but did not make the
state transition visually obvious when models were already warm. The workbench
now:

1. Shows a blue loading banner immediately.
2. Changes the button label to **Warming...**.
3. Shows a green **Models ready** banner with model names and elapsed time.
4. Changes the button label to **Models ready**.

The user confirmed the revised readiness UI with `everything ready`.

## Corpus baseline

The shared version-1 command corpus currently contains eight cases covering:

- Made field goal.
- Multi-event transition score and assist.
- Missed free throw.
- Team defensive rebound.
- Opponent defensive rebound.
- Opponent missed free throw.
- Turnover.
- Ambiguous shot language.

Qwen3 4B Q4_K_M laptop result:

| Measurement | Result |
| --- | ---: |
| Exact event arrays | 8 / 8 |
| Warning expectations | 8 / 8 |
| Errors | 0 |
| Median latency | 8,098 ms |
| Cold maximum latency | 40,889 ms |

The report is stored as a session artifact rather than committed generated
output. The corpus and reusable runner are committed.

Phi-4-mini-instruct Q4_K_M laptop comparison:

| Measurement | Result |
| --- | ---: |
| Exact event arrays | 4 / 8 |
| Warning expectations | 4 / 8 |
| Errors | 4 |
| Median latency | 8,624 ms |
| Cold maximum latency | 35,920 ms |

Phi-4-mini failed team free-throw grounding, rebound-kind extraction, and the
ambiguous-command safety case. It was neither more accurate nor faster than
Qwen3 on this machine. Qwen3 4B Q4_K_M remains the initial balanced-profile
command model.

## Diagnostics and resilience

- Authenticated `/v1/diagnostics` output excludes authorization tokens, audio,
  transcripts, rosters, model directories, and model file paths.
- The workbench downloads the redacted report as
  `bask-voice-diagnostics.json`.
- Active command generation can be cancelled by request ID.
- A configurable processing timeout cancels command generation and returns
  `408 processing_timeout`.
- A cancelled request returns `409 request_cancelled`.
- Out-of-memory failures return `507 model_out_of_memory`.
- Runtime interpretation failures do not require a service restart; a
  subsequent request can succeed.
- The Windows Playwright workbench test passes.

Real laptop resilience measurements:

| Measurement | Result |
| --- | ---: |
| Real cancellation | Successful |
| One-second automatic timeout | Successful |
| Ready after timeout without restart | Yes |
| Repeated warm requests | 10 |
| Repeated-request median | 4,873.5 ms |
| Repeated-request range | 4,064–5,595 ms |
| Working-set change | +7.9 MB |
| Private-memory change | +12.8 MB |

## Gaming-PC acceptance

Validation machine:

- 20 logical processors.
- 63.8 GB physical memory.
- NVIDIA GeForce RTX 4070 with 12 GB VRAM.
- faster-whisper `base.en`, CPU `int8`.
- Qwen3 4B Q4_K_M, CPU-only.

The CUDA llama.cpp wheel could not load its native CUDA 12.4 dependencies on
the validation installation. The CPU fallback was accepted because it met the
accuracy, latency, and stability gates without requiring machine-level CUDA or
cuDNN setup.

Seven-round, 56-command result:

| Measurement | Result |
| --- | ---: |
| Exact event arrays | 56 / 56 |
| Warning expectations | 56 / 56 |
| Errors | 0 |
| Dual-model warmup | 1,952 ms |
| Median interpretation latency | 3,725 ms |
| P95 interpretation latency | 6,099 ms |
| Maximum interpretation latency | 8,548 ms |
| Round-median range | 3,650–3,766 ms |

The first round brought model pages into the process working set. From the end
of round 1 through round 7:

- Working set increased approximately 11.8 MB.
- Private memory increased approximately 11.8 MB.
- Both measurements peaked in round 6 and declined before the final sample.
- No command failures or latency degradation were observed.

Direct CPU temperature was not available through the bounded diagnostic
interface. Stable per-round latency over the approximately 34-minute run
showed no evidence of material thermal throttling.

## Exit decision

- Qwen3 4B Q4_K_M remains the initial command model.
- The accepted laptop profile is balanced CPU execution.
- The accepted gaming-PC baseline is balanced CPU execution.
- CUDA acceleration is deferred and does not block stats integration.
- Checkpoint 5 stats recording and proposal-preview work may begin.
