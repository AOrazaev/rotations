# Voice Companion Checkpoint 2

## Status

In progress. The local transcription runtime, profiles, model installer, model
download helper, evaluation command, and adapter tests are implemented.

Real-model installation and transcription remain to be completed from the
native Windows clone. The WSL-hosted working copy encountered TLS handshake
failures while pip contacted the configured Microsoft package feed and public
`files.pythonhosted.org`.

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

## Windows continuation

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

- Install `faster-whisper` successfully in the Python 3.12 environment.
- Download and verify at least the balanced `base.en` model.
- Complete one real native-Windows transcription through the workbench.
- Run the evaluation command against representative English commands.
- Record gaming-PC and productivity-laptop latency and resource measurements.
- Document the chosen initial transcription profile from measured results.
