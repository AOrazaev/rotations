# Bask Voice Companion

This directory contains the local-only voice companion feasibility spike. It does not yet interpret transcripts or modify stats games.

## Checkpoint 0 workbench

Requirements:

- Windows 11
- Python 3.11 or newer
- Chrome or Edge

Run from PowerShell:

```powershell
$repo = '\\wsl.localhost\Ubuntu\home\orazaev\proj\bask\rotations'
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File "$repo\voice-companion\scripts\run.ps1"
```

The command prints a random pairing token and starts:

```text
http://127.0.0.1:8766/
```

Paste the token into the workbench and choose **Check service**.

## Configure local transcription

Checkpoint 0 intentionally does not choose or download a speech model automatically. Configure any local transcription CLI that writes only the transcript to standard output:

```powershell
$env:BASK_VOICE_TRANSCRIBE_COMMAND = 'your-local-transcriber --audio {audio}'
.\scripts\run.ps1
```

`{audio}` is replaced with a temporary audio path. The file is deleted after the command succeeds or fails. The command must not write extra diagnostics to standard output; use standard error for diagnostics.

The final transcription runtime will be selected from measured gaming-PC and laptop results, not assumed by the spike.

For browser automation only, a fixed transcript can be enabled without model weights:

```powershell
$env:BASK_VOICE_TRANSCRIPT_FIXTURE = 'Seven assist and thirteen makes two in transition'
.\scripts\run.ps1
```

This mode is visibly reported as `fixture` and must not be used for transcription measurements.

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
