# Voice Companion Checkpoint 2

## Status

In progress. The local transcription runtime, profiles, model installer, model
download helper, evaluation command, and adapter tests are implemented.

Native Windows installation, balanced-model download, model loading, evaluation,
localhost API transcription, and a microphone/workbench transcription are
verified. A representative multi-command corpus, automated Windows browser
coverage, and broader target-hardware measurements remain open.

## Implemented

- Python 3.12 companion requirement.
- `faster-whisper` optional dependency.
- Lazy faster-whisper model loading.
- Temporary-audio cleanup after success or failure.
- User-local model storage.
- Local pre-downloaded model discovery.
- Lightweight profile:
  - `tiny.en`
  - CPU
  - `int8`
- Balanced profile:
  - `base.en`
  - Automatic device selection
  - `int8`
- High-accuracy profile:
  - `small.en`
  - CUDA
  - `float16`
- Native PowerShell installer for dependencies and selected models.
- Standalone model-download helper and installed-model manifest.
- Evaluation CLI with exact-match and latency reporting.
- Workbench transcription runtime/model-state presentation.
- Unit tests using a fake model factory.
- Basketball-specific faster-whisper hotwords for player numbers and supported
  stat vocabulary.

## Native Windows validation

Validated on October 2, 2026:

- Python `3.12.10`.
- `faster-whisper 1.2.1`.
- `ctranslate2 4.8.2`.
- PyAV `18.1.0`.
- Balanced `base.en` model downloaded under the user-local model directory.
- Model files verified and loaded with the balanced `auto`/`int8` profile.
- All 21 companion unit tests passed.
- Real faster-whisper evaluation completed with a locally generated 3.559-second
  speech sample.
- The localhost `/v1/voice-command` endpoint processed the same WAV file and
  returned a real model transcript.
- A live microphone recording completed through the browser workbench.
- All 23 companion unit tests passed after number normalization and basketball
  vocabulary coverage were added.

Validation machine:

- 12th Gen Intel Core i7-1265U.
- 10 physical cores and 12 logical processors.
- 31.8 GB RAM.
- Intel Iris Xe integrated graphics.

Observed balanced-profile results:

| Measurement | Result |
| --- | ---: |
| Cold evaluation latency | 2,835 ms |
| Warm evaluation latency | 1,090 ms |
| First localhost API transcription | 2,835 ms |
| Audio duration | 3.559 seconds |
| Expected speech | `Seven assist and thirteen makes two in transition.` |
| Transcript | `7. Assist and 13 makes 2 in transition` |
| Language probability | 1.0 |

The transcript preserved the basketball meaning and player numbers. Evaluation
normalization now treats English number words from zero through ninety-nine as
equivalent to numeric digits, so both measured cases passed normalized exact
matching.

The first live microphone attempt used the command `number 25 misses free
throw` and returned `Number 45, this is pretty throw.` Static faster-whisper
hotwords were then added for player numbers and basketball stat vocabulary. A
control evaluation returned `number 25 misses free throw`, and the repeated
live workbench recording returned the same correct transcript.

Native Windows browser automation was not rerun because Node/npm was not
available on `PATH`. This does not affect the verified Python service and HTTP
transcription path. Manual browser workbench acceptance passed.

## Windows setup

From a native Windows clone:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File ".\voice-companion\scripts\install-transcription.ps1" `
  -Profile balanced
```

If the default package route remains unavailable, pass an approved package
mirror:

```powershell
.\voice-companion\scripts\install-transcription.ps1 `
  -Profile balanced `
  -PackageIndexUrl "https://approved.example/simple" `
  -TrustedHost "approved.example"
```

After installation:

```powershell
.\voice-companion\scripts\run.ps1 `
  -Token manual-test-token `
  -Profile balanced
```

Open `http://127.0.0.1:8766/`, record representative commands, and capture cold
and warm latency plus recognition errors.

## Remaining exit gates

- Run the evaluation command against a representative multi-command corpus.
- Record peak RAM usage for the balanced profile.
- Record gaming-PC latency and resource measurements.
- Rerun browser automation when Node/npm is available in the Windows
  development environment.
- Document the chosen initial transcription profile from measured results.
