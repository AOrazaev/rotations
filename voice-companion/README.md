# Bask Voice Companion

This directory contains the local-only voice companion feasibility spike. It does not yet interpret transcripts or modify stats games.

## Checkpoint 0 workbench

Requirements:

- Windows 11
- Python 3.12
- Chrome or Edge

Run from PowerShell:

```powershell
Set-Location 'C:\path\to\rotations'
.\voice-companion\scripts\run.ps1
```

The command prints a random pairing token and starts:

```text
http://127.0.0.1:8766/
```

Paste the token into the workbench and choose **Check service**.

The service binds to loopback only. API requests require the pairing token in
`X-Bask-Voice-Token`, and browser requests must come from the workbench,
configured development origins, or the production GitHub Pages origin.

## API

```text
GET  /v1/health
GET  /v1/capabilities
POST /v1/voice-command
POST /v1/interpret-command
POST /v1/warmup
POST /v1/cancel
```

Health and capability responses expose the protocol version, readiness,
configured models, request limits, security mode, active processing count, and
uptime. Voice requests use bounded `multipart/form-data` containing `context`
JSON and an `audio` file.

Only one voice request is processed at a time by default. Additional requests
receive `429 service_busy`.

## Configure local transcription

Install the balanced local transcription profile from Windows PowerShell:

```powershell
Set-Location 'C:\path\to\rotations'
.\voice-companion\scripts\install-transcription.ps1 -Profile balanced
```

This creates `voice-companion/.venv`, installs `faster-whisper`, and downloads
`base.en` under:

```text
%LOCALAPPDATA%\BaskVoiceCompanion\models\
```

The installer intentionally uses `py -3.12`. Python 3.13 may work for parts of
the stack, but Python 3.12 has broader Windows AI-runtime and binary-wheel
compatibility and is the supported companion version.

Available profiles:

- `lightweight`: `tiny.en`, CPU, `int8`
- `balanced`: `base.en`, automatic device selection, `int8`
- `high_accuracy`: `small.en`, CUDA, `float16`

Install all three:

```powershell
.\voice-companion\scripts\install-transcription.ps1 -AllProfiles
```

The package index is configurable for corporate environments:

```powershell
.\scripts\install-transcription.ps1 `
  -PackageIndexUrl 'https://approved.example/simple' `
  -TrustedHost 'approved.example'
```

Then start the selected profile:

```powershell
.\voice-companion\scripts\run.ps1 `
  -Token manual-test-token `
  -Profile balanced
```

An external transcription CLI remains available through
`BASK_VOICE_TRANSCRIBE_COMMAND` and `-Transcriber external-command`.

For browser automation only, a fixed transcript can be enabled without model weights:

```powershell
$env:BASK_VOICE_TRANSCRIPT_FIXTURE = 'Seven assist and thirteen makes two in transition'
.\scripts\run.ps1
```

This mode is visibly reported as `fixture` and must not be used for transcription measurements.

## Configure command interpretation

Install the CPU llama.cpp runtime and official Qwen3 4B Q4_K_M model:

```powershell
.\voice-companion\scripts\install-interpretation.ps1
```

Qwen3 is the selected default command model. To reproduce the Phi-4-mini
comparison download without changing the service default:

```powershell
.\voice-companion\scripts\install-interpretation.ps1 `
  -ModelCandidate phi4mini
```

Phi-4-mini uses the community `bartowski` Q4_K_M GGUF of Microsoft's
MIT-licensed model. It passed 4/8 shared corpus cases on the reference laptop,
compared with Qwen3's 8/8, and was not faster.

The model is stored outside the repository under:

```text
%LOCALAPPDATA%\BaskVoiceCompanion\models\
```

Start transcription and interpretation together:

```powershell
.\voice-companion\scripts\run.ps1 `
  -Token manual-test-token `
  -Profile balanced `
  -CommandInterpreter llama-cpp
```

Use the workbench's **Transcript interpretation** section to exercise Qwen
without recording audio. When transcription succeeds but interpretation fails,
the API returns the transcript in `partialResult` and the workbench keeps it
visible under **Latest transcript**.

Choose **Warm models** after connecting to load both models before the first
live command. The workbench reports model identities, warmup timing, detected
CPU/memory/CUDA capabilities, and the recommended profile. Explicit command-line
device, compute-type, model-path, context-size, and GPU-layer settings override
the recommendation.

Export a support report with **Export diagnostics**. The report intentionally
omits audio, transcripts, tokens, rosters, usernames, and model paths.

Run the shared transcript-to-proposal corpus:

```powershell
$env:PYTHONPATH = "$PWD\voice-companion\src"
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_commands `
  --output .\command-evaluation.json
```

Evaluate an alternate model by supplying its full path with `--model`.

Processing defaults to a 120-second timeout and can be cancelled from the
workbench. Override the timeout when starting the service:

```powershell
.\voice-companion\scripts\run.ps1 `
  -ProcessingTimeoutSeconds 60
```

## Tests

```powershell
$env:PYTHONPATH = "$PWD\src"
python -m unittest discover tests
```

The tests use a fixture transcriber and do not require model weights.

From the repository root, run the workbench browser test:

```powershell
npm run test:voice-workbench
```
