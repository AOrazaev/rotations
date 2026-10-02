# Voice Companion Checkpoint 4

## Status

In progress. The standalone workbench now exposes explicit model warmup,
hardware/profile diagnostics, and clear readiness feedback.

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

## Remaining gates

- Add the shared local transcript/proposal corpus runner.
- Add redacted diagnostic export.
- Exercise reproducible timeout, cancellation, model-load, and out-of-memory
  failures.
- Measure repeated-request memory behavior.
- Run a longer session and record resource and thermal observations.
- Compare model/profile results using the same corpus.
- Run automated browser coverage when Node/npm is available on Windows.
