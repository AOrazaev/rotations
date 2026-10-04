# Bask Voice Companion

This directory contains the local-only voice companion used by the GitHub
Pages basketball tracker. Faster Whisper transcribes microphone recordings and
Qwen converts normalized transcripts into reviewable basketball events. Audio,
rosters, transcripts, and models remain on the local Windows machine.

## Repository quick start

Requirements:

- Windows 11
- Python 3.12 with the `py` launcher
- Chrome or Edge
- Current Microsoft Visual C++ x64 redistributable

From a fresh clone, install the balanced transcription profile, CPU command
runtime, and default Qwen model:

```powershell
Set-Location 'C:\path\to\rotations'

.\voice-companion\scripts\prepare-gaming-pc.ps1 `
  -CommandRuntime cpu

.\voice-companion\scripts\run.ps1
```

The launcher uses the pinned dependencies in
`requirements-transcription.txt` and `requirements-interpretation.txt`. It
requires the repository-managed Python 3.12 environment and fails with setup
instructions rather than falling back to an unrelated system Python.
PyAV is pinned alongside Faster Whisper because PyAV 19 is not compatible with
the decoder API used by Faster Whisper 1.2.1.

The command starts Faster Whisper with the balanced profile and the fact DSL V2
command interpreter. It prints a random pairing token and serves the workbench:

```text
http://127.0.0.1:8766/
```

Paste the token into the workbench and choose **Check service**.

Use the CUDA 12.4 llama.cpp wheel on a compatible machine:

```powershell
.\voice-companion\scripts\prepare-gaming-pc.ps1 `
  -CommandRuntime cuda124
```

The older structured-JSON interpreter remains available explicitly:

```powershell
.\voice-companion\scripts\run.ps1 `
  -CommandInterpreter llama-cpp
```

## Podman CPU and NVIDIA GPU containers

Podman provides an optional reproducible Linux runtime for technical users.
The native PowerShell workflow remains supported. The CPU image is the
validated fallback, and the separate CUDA 12.4 image is available for gaming
PCs with NVIDIA CDI passthrough.

Requirements:

- Podman Desktop with its Podman engine and WSL2 machine configured.
- `podman version` and `podman machine list` working in a new PowerShell window.
- Enough Podman-machine memory for the Whisper and Qwen models.

Build the CPU image, create its persistent data volume, and download the
balanced Whisper and Qwen models:

```powershell
Set-Location 'C:\path\to\rotations'
.\voice-companion\scripts\prepare-podman.ps1
```

Start the service:

```powershell
.\voice-companion\scripts\run-podman.ps1
```

The runtime container executes as a non-root user with all Linux capabilities
dropped, a read-only application filesystem, and a temporary `/tmp`. Models,
Hugging Face caches, and saved evaluation samples persist in the
`bask-voice-companion-data` Podman volume.

The service listens on `0.0.0.0` only inside authenticated container mode.
The launcher publishes it exclusively as `127.0.0.1:8766` on Windows; do not
replace that publish address with an all-interface binding.

Podman 6 on the WSL2 provider currently has a Windows-localhost forwarding
regression. The launcher therefore creates an authenticated SSH local tunnel
to the running Podman machine, bound only to Windows `127.0.0.1`, and removes
the tunnel when the container exits. Windows OpenSSH Client is required. Once
the upstream forwarding issue is fixed, bypass the compatibility tunnel with:

```powershell
.\voice-companion\scripts\run-podman.ps1 -UseSshTunnel:$false
```

Useful variations:

```powershell
# Use a different host port.
.\voice-companion\scripts\run-podman.ps1 -Port 8877

# Rebuild without redownloading models.
.\voice-companion\scripts\prepare-podman.ps1 -SkipModelDownload

# Use the lightweight Whisper profile.
.\voice-companion\scripts\prepare-podman.ps1 -Profile lightweight
.\voice-companion\scripts\run-podman.ps1 -Profile lightweight

# Run the complete real-audio corpus inside the CPU image.
.\voice-companion\scripts\evaluate-podman.ps1 `
  -Output .\podman-real-audio-evaluation.json
```

The image has separate CPU and CUDA 12.4 targets while keeping the same API,
persistent volume, and launch contract.

### Podman NVIDIA GPU runtime

Requirements:

- NVIDIA Pascal-or-newer GPU with the current Windows driver and WSL2 CUDA
  support.
- The WSL2 Podman machine; Hyper-V GPU passthrough is not supported.
- Approximately 9 GB of Podman image storage for the CUDA target, excluding
  models.

Install NVIDIA Container Toolkit inside the running Podman machine, generate
its CDI device specification, and verify `nvidia-smi` in a test container:

```powershell
.\voice-companion\scripts\prepare-podman-gpu.ps1
```

This modifies the Podman machine rather than Windows. Rerun it after replacing
the GPU, changing MIG configuration, or updating drivers if CDI becomes stale.

Build the CUDA 12.4 companion image. The balanced profile runs `base.en` with
CUDA `float16`; the high-accuracy profile downloads and runs `small.en`:

```powershell
.\voice-companion\scripts\prepare-podman.ps1 `
  -Runtime cuda124 `
  -Profile balanced

# Optional larger Whisper model.
.\voice-companion\scripts\prepare-podman.ps1 `
  -Runtime cuda124 `
  -Profile high_accuracy
```

Start the GPU service:

```powershell
.\voice-companion\scripts\run-podman.ps1 `
  -Runtime cuda124 `
  -Profile balanced
```

The launcher passes the CDI device `nvidia.com/gpu=all`, uses CUDA `float16`
for Faster Whisper, and offloads all supported Qwen layers with
`--command-gpu-layers -1`. Before opening the service it verifies that
CTranslate2 sees at least one CUDA device and that llama.cpp was built with GPU
offload. GPU setup failures stop startup rather than silently using CPU.

Podman 6 on WSL can fail GPU containers before startup with
`controller pids is not available`. GPU verification, service, and evaluation
commands therefore use `--cgroups=disabled`, the upstream per-container
workaround for the WSL cgroup-delegation regression. The companion does not
configure container CPU, memory, or PID limits, so this does not remove limits
the workflow otherwise depended on. CPU containers retain normal cgroup
management.

Run the real-audio corpus on GPU with:

```powershell
.\voice-companion\scripts\evaluate-podman.ps1 `
  -Runtime cuda124 `
  -Profile balanced `
  -Output .\podman-gpu-real-audio-evaluation.json
```

After startup, `/v1/warmup` and `/v1/diagnostics` should report a CUDA device,
Faster Whisper device `cuda`, compute type `float16`, and command-model GPU
layers `-1`. Full device execution must be validated on the gaming PC; the
CUDA image itself can be built on a machine without an NVIDIA GPU.

The initial balanced-profile CPU baseline is stored as
`evaluation/real-audio-v1/baseline-balanced-81-fact-dsl-podman-cpu.json`:

- 70/81 raw transcript matches.
- 78/81 normalized transcript matches.
- 79/81 exact semantic event arrays.
- 0 processing errors.
- 8.8-second median end-to-end latency.
- 77.9-second maximum latency.

The two event misses are the accepted ambiguous #70 transcriptions `seven T`
and `seven two` while both #7 and #70 are active. The container run is
functionally consistent with the known transcription limitations, but its
development-machine timing is not a release benchmark.

## Local workbench and security

The service binds to loopback only. API requests require the pairing token in
`X-Bask-Voice-Token`, and browser requests must come from the workbench,
configured development origins, or the production GitHub Pages origin.

For a simpler local-only setup, explicitly disable token authentication:

```powershell
.\voice-companion\scripts\run.ps1 -DisableAuthentication
```

Leave the token field empty when connecting. This mode still binds to loopback
and validates browser origins, but any allowed page or local process can call
the companion, so token authentication remains the default.

## Evaluation samples

The stats tracker can explicitly save a completed recording as an evaluation
sample. Its default-off **Save accepted voice commands locally** setting can
also retain recordings automatically when a draft is accepted. This preference
is stored in the browser, and nothing is uploaded automatically. Before manual
or automatic saving, correct the expected transcript and proposed events to the
expected result.

Each sample stores the audio, original and corrected transcript, original and
corrected proposal, request context, warnings, model/profile metadata, timings,
outcome, and whether it was manually saved or automatically collected under:

```text
%LOCALAPPDATA%\BaskVoiceCompanion\evaluation-samples
```

Use **Saved evaluation samples** in the tracker to review, export, or delete
samples. Automatically collected items are candidate labels, not curated
ground truth. Review them before adding them to a committed evaluation set.
Export produces one ZIP containing the audio and JSON metadata.

Audio interfaces that expose a mono microphone as one side of a stereo stream
are normalized automatically before transcription. The companion selects the
dominant left or right channel when the other side is effectively silent;
otherwise it performs a normal stereo-to-mono mix. The selected mode is reported
as `processor.audioChannelMode`.

The tracker's **Voice settings** dialog provides a **Channel handling** override:
**Automatic** (recommended), **Left only**, **Right only**, or **Mix both**.
Automatic keeps the dominant-channel behavior while explicit selections are
useful for unusual interface routing.

After transcription, the companion conservatively resolves common spoken
teen/tens jersey confusions such as **fifteen** versus **fifty**. It only changes
the transcript when the spoken number is absent, its counterpart is uniquely
present in the active lineup, and the number is used as the subject of a
supported statistic. The response includes a warning whenever this
roster-aware normalization is applied.

Interpretation also grounds explicit active-lineup subjects independently. For
example, `number five assist, number thirteen makes three` must attribute the
assist to #5 and the shot to #13 even if the local command model repeats one
player across both events. Action-first clauses such as `steal by thirteen` and
`defensive rebound by opponent` receive the same grounding before strict roster
validation. Unspoken model events and shot phases such as transition or half
court are removed rather than accepted. Explicitly grounded simple events such
as `opponent foul` can be recovered when the command model omits them entirely;
relational events such as assists remain strict rather than being guessed.

Voice commands support player statistics plus team-level timeouts. Commands
such as `opponent timeout` produce a playerless opponent timeline event.

Substitution-only commands are resolved deterministically from the roster and
active lineup without asking the command model to guess direction. Supported
phrases include `number 7 subs for 13`, `7 in for 13`, and
`sub 13 out for 7`; each means #7 enters and #13 exits. The companion rejects
mixed substitution-and-stat commands and lineup-inconsistent directions.

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
  -Profile balanced
```

The compact fact interpreter is the default. The structured-JSON V1 backend
can be selected for comparison or fallback without changing the API contract:

```powershell
.\voice-companion\scripts\run.ps1 `
  -Token manual-test-token `
  -Profile balanced `
  -CommandInterpreter llama-cpp
```

The default interpreter asks the same Qwen model for compact typed
basketball facts, then resolves jerseys and constructs events deterministically.
Responses and diagnostics identify the selected backend as
`processor.commandInterpreter`.
Compare either backend against curated transcripts:

```powershell
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --mode interpretation-only `
  --interpreter structured-json-v1 `
  --output .\structured-json-evaluation.json

.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --mode interpretation-only `
  --interpreter fact-dsl-v2 `
  --output .\fact-dsl-evaluation.json
```

On the initial 27-case interpretation-only comparison, both backends produced
27/27 exact event arrays with zero errors. The compact fact backend reduced
median interpretation latency from 18.9 seconds to 4.2 seconds and p90 latency
among model-invoked cases from 87.5 seconds to 22.6 seconds. These are
functional development-machine measurements with observed contention outliers,
not release performance claims.

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

Run the committed 81-recording real-audio evaluation set with the default fact
DSL interpreter:

```powershell
$env:PYTHONPATH = "$PWD\voice-companion\src"
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --output .\real-audio-evaluation.json
```

The set lives under `voice-companion/evaluation/real-audio-v1`. Its manifest
uses synthetic player identities and manually curated transcripts/events.
Reports score raw transcription, active-lineup-aware transcript normalization,
and exact end-to-end semantic event arrays separately.

Select the structured-JSON interpreter explicitly when comparing backends:

```powershell
.\voice-companion\.venv\Scripts\python.exe `
  -m voice_companion.evaluate_real_samples `
  --interpreter structured-json-v1 `
  --mode interpretation-only `
  --output .\structured-json-evaluation.json
```

Processing defaults to a 120-second timeout and can be cancelled from the
workbench. Override the timeout when starting the service:

```powershell
.\voice-companion\scripts\run.ps1 `
  -ProcessingTimeoutSeconds 60
```

## Gaming-PC Checkpoint 4 validation

On a fresh Windows clone with Python 3.12, current NVIDIA drivers, the CUDA
12.4 runtime/toolkit, and the current Microsoft Visual C++ x64 redistributable,
run:

```powershell
.\voice-companion\scripts\prepare-gaming-pc.ps1
.\voice-companion\scripts\validate-checkpoint-4.ps1
```

The setup script installs the balanced faster-whisper model, Qwen3 Q4_K_M, and
the CUDA 12.4 llama.cpp wheel. It now verifies that the native llama.cpp DLL can
load before reporting success.

## Repository update and troubleshooting

After pulling repository changes, rerun the setup command to apply pinned
dependency updates and download any missing models:

```powershell
.\voice-companion\scripts\prepare-gaming-pc.ps1 `
  -CommandRuntime cpu
```

Common failures:

- **Missing `.venv`:** run `prepare-gaming-pc.ps1`; `run.ps1` intentionally
  does not fall back to system Python.
- **Wrong Python version:** remove the disposable `voice-companion\.venv`
  directory and rerun setup with Python 3.12 installed.
- **llama.cpp native DLL failure:** install the current Visual C++ x64
  redistributable. For CUDA, also install the CUDA 12.4 runtime, then open a new
  PowerShell window.
- **CUDA setup unavailable:** rerun with `-CommandRuntime cpu`.
- **Port 8766 already in use:** stop the existing companion or start with
  `-Port <unused-port>`.
- **Pairing fails:** use the token printed by the current companion process and
  confirm the tracker is loaded from an allowed origin.
- **Model load failure:** rerun the relevant installer with
  `-ForceModelDownload`; use `-ForceRuntimeReinstall` for a broken llama.cpp
  wheel.

The virtual environment is disposable. Models and local evaluation samples are
stored outside the repository under `%LOCALAPPDATA%\BaskVoiceCompanion\`.

To keep transcription on CPU while testing Qwen on the GPU, run:

```powershell
.\voice-companion\scripts\validate-checkpoint-4.ps1 `
  -TranscriptionDevice cpu `
  -TranscriptionComputeType int8
```

This configuration does not require cuDNN. Full faster-whisper GPU execution
with CTranslate2 4.8 requires CUDA 12 and cuDNN 9.

If the CUDA runtime cannot be installed immediately, replace the broken CUDA
wheel with the CPU wheel and validate in CPU mode:

```powershell
.\voice-companion\scripts\prepare-gaming-pc.ps1 `
  -CommandRuntime cpu `
  -ForceRuntimeReinstall

.\voice-companion\scripts\validate-checkpoint-4.ps1 `
  -CommandGpuLayers 0 `
  -TranscriptionDevice cpu `
  -TranscriptionComputeType int8
```

The validation command takes at least 30 minutes by default. It runs seven
rounds of the eight-case corpus with five-minute gaps and records:

- Redacted hardware and package information.
- faster-whisper and Qwen warmup, selected transcription device/compute type,
  and per-command interpretation latency.
- Exact events, warnings, and errors for all 56 commands.
- Process working-set and private-memory samples.
- NVIDIA memory, temperature, utilization, and performance-state samples.

The console reports model warmup, every command result, round summaries,
elapsed time, and a countdown during each five-minute gap.

The command prints the path of one JSON report under
`voice-companion\validation-results\`. Return that file for review. It contains
only the committed curated transcripts, not microphone audio, tokens, model
paths, hostnames, or usernames.

For a quick installation check instead of the checkpoint soak:

```powershell
.\voice-companion\scripts\validate-checkpoint-4.ps1 `
  -Repetitions 1 `
  -DelayBetweenRoundsSeconds 0
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
