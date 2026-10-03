# Local Voice Companion Engineering Plan

## Purpose

Add an optional local voice-capture workflow to Stats & Video Review so a coach can record one or more statistical events without navigating several controls during a game recording.

The browser application remains hosted on GitHub Pages. Audio transcription and natural-language interpretation run in a companion service on the same Windows PC as the browser. Audio, roster context, and transcripts remain local unless a future release explicitly introduces an opt-in remote provider.

Example:

```text
Seven assist and thirteen makes two points in transition
```

The system proposes:

```text
#13 made 2PT · Transition
Assist · #7
Timestamp: 12:43.2
```

The coach confirms, edits, retries, or cancels the proposal before any game data changes.

## Product outcome

A coach can:

1. Start a short voice recording while watching the game video.
2. Capture the video timestamp at the moment recording starts.
3. Speak a compact basketball command using player names or jersey numbers.
4. Process the audio entirely on the local PC.
5. Review the transcript and proposed timeline events.
6. Correct player attribution or event details before saving.
7. Commit all confirmed events as one atomic tracker mutation.
8. Undo the complete voice-command batch immediately if it was incorrect.
9. Continue using all existing manual controls when the companion is unavailable.

Voice capture is an optional input method. It must not become a prerequisite for tracking, Review mode, reports, backups, or shared game links.

## Initial decisions

- Keep the companion source in this repository under `voice-companion/`.
- Keep the browser/service protocol under `contracts/`.
- Give the companion its own localhost web workbench for recording, transcription, interpretation, diagnostics, and evaluation before integrating it with the stats tracker.
- Run the service on loopback only by default.
- Target a Windows gaming PC and a capable Windows laptop.
- Keep the GitHub Pages application usable without installing the companion.
- Capture the event timestamp when recording starts, not when processing finishes.
- Use a local speech-to-text model followed by a local structured-command model.
- Start with a quantized Qwen3 4B Instruct profile for command interpretation.
- Compare Phi-4-mini-instruct against the same evaluation corpus before release.
- Require strict schema-constrained output and browser-side validation.
- Require confirmation before saving during the initial release.
- Keep deterministic parsing and Laya-based typed decisions as later optimization paths.
- Do not commit model weights, generated binaries, virtual environments, or downloaded audio.

Model selection remains evidence-driven. Qwen3 4B is the initial implementation candidate, not a permanent protocol dependency.

## Scope decisions

### Included

- Push-to-talk or explicit start/stop recording.
- Browser microphone capture through `MediaRecorder`.
- A standalone localhost companion workbench that exercises the real service API without loading or modifying a stats game.
- Timestamp capture from the current video position on recording start.
- Localhost health and capability discovery.
- Local speech transcription.
- Local conversion from transcript to a strict event proposal.
- Team and opponent commands.
- Player resolution by jersey number or roster name.
- Multiple events from one command.
- Existing event types:
  - Made and missed 1PT, 2PT, and 3PT shots
  - Offensive and defensive rebounds
  - Assists
  - Steals
  - Blocks
  - Turnovers
  - Personal fouls
- Existing structured shot details when explicitly spoken:
  - Pressure
  - Offensive phase
  - Second-chance context
  - Creation type
- Proposal confidence, warnings, transcript display, and correction.
- Atomic browser-side commit after confirmation.
- Immediate batch undo.
- Gaming-PC and laptop performance profiles.
- Chrome and Edge on Windows as the first supported browser targets.
- Local service packaging, versioning, diagnostics, and update documentation.

### Excluded from the first release

- Cloud transcription or cloud LLM fallback.
- Silent automatic saving.
- Automatic facts that were not spoken.
- Automatic rebound creation after a miss.
- Automatic steal creation after a turnover.
- Automatic assist creation after a made shot.
- Substitutions, period changes, timeouts, notes, and game-management commands.
- Shot-location coordinates inferred from speech.
- Continuous listening or wake-word detection.
- Speaker identification.
- Voice biometrics.
- Mobile-phone localhost hosting.
- LAN access from a phone to a service running on another device.
- A native desktop replacement for the browser application.
- Training or fine-tuning a custom model in the initial release.
- Laya integration in the initial release.

Substitutions and period commands are intentionally deferred because recognition errors would affect lineup attribution and all downstream reports.

## Repository structure

Proposed structure:

```text
rotations/
├── contracts/
│   ├── voice-command-request-v1.schema.json
│   ├── voice-command-response-v1.schema.json
│   └── fixtures/
├── stats/
│   ├── docs/
│   │   └── VOICE_COMPANION_ENGINEERING_PLAN.md
│   └── js/
│       └── voice-companion-client.js
├── voice-companion/
│   ├── README.md
│   ├── pyproject.toml
│   ├── src/
│   ├── web/
│   ├── tests/
│   └── scripts/
└── tests/
```

Boundary rules:

- The browser and service communicate only through the versioned HTTP contract.
- The companion workbench uses the same public service contract as the eventual stats client.
- The browser must not import service implementation code.
- The service must not access IndexedDB or game backups directly.
- The service receives only the context required to interpret the current command.
- Browser-side game validation remains authoritative.
- The existing tracker remains functional when the service is absent, outdated, starting, or unhealthy.
- Model storage lives outside the repository and outside the GitHub Pages deployment.
- The Pages workflow must not publish service environments, downloaded models, or release artifacts.

## System architecture

```text
GitHub Pages tracker
        |
        | 1. Capture video timestamp
        | 2. Record short audio clip
        | 3. Send audio and bounded game context
        v
Local voice companion on 127.0.0.1
        |
        | 4. Transcribe locally
        | 5. Interpret transcript into constrained JSON
        | 6. Return transcript, proposal, confidence, and warnings
        v
Browser proposal controller
        |
        | 7. Resolve and validate against the current game
        | 8. Present editable confirmation
        | 9. Commit one atomic event batch
        v
Existing game store and timeline
```

The service proposes events. The browser owns game semantics, persistence, lineup snapshots, event IDs, sequence values, timestamps, reports, and undo behavior.

## Standalone companion workbench

Before stats integration, the companion serves a localhost-only web interface for developing and evaluating the complete audio-to-proposal pipeline.

The workbench is not a second stats application. It does not open games, access IndexedDB, calculate reports, or persist timeline events.

Required workbench capabilities:

- Show service, protocol, model, and hardware-profile status.
- Record from the browser microphone.
- Upload a supported audio file for repeatable testing.
- Enter or load a small mock roster and current lineup.
- Enter a transcript directly to test interpretation without running transcription.
- Display transcription text, event proposals, confidence, warnings, and processing timings.
- Display the raw schema-conformant response for diagnostics.
- Edit and retry request context.
- Replay committed contract fixtures.
- Run a local evaluation set and summarize exact-match and latency results.
- Switch supported model and hardware profiles.
- Export redacted diagnostic results without audio.
- Surface every error state planned for the stats integration.

The workbench should be the primary development surface through transcription, command interpretation, model comparison, and hardware profiling. Stats integration begins only after the standalone readiness gate passes.

## Local service API

Initial endpoints:

```text
GET  /v1/health
GET  /v1/capabilities
POST /v1/voice-command
```

### Health

`GET /v1/health` reports process and protocol readiness without loading private game data:

```json
{
  "status": "ready",
  "protocolVersion": 1,
  "serviceVersion": "0.1.0",
  "profile": "balanced",
  "transcriptionReady": true,
  "commandModelReady": true
}
```

### Capabilities

`GET /v1/capabilities` reports supported audio formats, language profiles, event types, model identity, and relevant limits.

The browser uses capabilities to decide whether to enable recording. It must not infer support from a successful TCP connection alone.

### Voice command

`POST /v1/voice-command` uses a multipart request containing:

- One bounded audio file.
- One JSON context part.
- A per-session authorization token.

Example context:

```json
{
  "protocolVersion": 1,
  "requestId": "voice-request-id",
  "capturedSeconds": 763.2,
  "language": "en",
  "sideHint": null,
  "roster": [
    {
      "id": "p7",
      "jersey": "7",
      "name": "Alex"
    },
    {
      "id": "p13",
      "jersey": "13",
      "name": "Denis"
    }
  ],
  "currentLineupIds": ["p7", "p13", "p21", "p24", "p30"],
  "allowedEventTypes": [
    "shot",
    "rebound",
    "assist",
    "steal",
    "block",
    "turnover",
    "foul"
  ]
}
```

The context must not include coach comments, unrelated historical events, reports, or the complete game unless a later requirement demonstrates a need.

Example response:

```json
{
  "protocolVersion": 1,
  "requestId": "voice-request-id",
  "transcript": "Seven assist and thirteen makes two in transition",
  "events": [
    {
      "side": "team",
      "type": "shot",
      "playerId": "p13",
      "shotValue": 2,
      "made": true,
      "shotDetails": {
        "phase": "transition"
      },
      "confidence": 0.98
    },
    {
      "side": "team",
      "type": "assist",
      "playerId": "p7",
      "confidence": 0.96
    }
  ],
  "overallConfidence": 0.96,
  "warnings": [],
  "processor": {
    "transcriptionModel": "configured-local-model",
    "commandModel": "qwen3-4b",
    "profile": "balanced"
  },
  "timingMs": {
    "transcription": 620,
    "interpretation": 180,
    "total": 800
  }
}
```

The service response does not contain event IDs, sequence values, lineup snapshots, creation timestamps, or persisted batch metadata. Those are browser responsibilities.

## Command interpretation

The initial interpreter uses a local instruction model with constrained decoding against the response schema.

Requirements:

- Disable conversational prose.
- Require a JSON array of zero or more event proposals.
- Restrict enum values to the existing game contract.
- Restrict player references to the supplied roster.
- Preserve event order from the spoken command when it is meaningful.
- Return warnings instead of guessing unsupported facts.
- Return an empty proposal when the transcript is not a basketball command.
- Never convert uncertainty into a successful-looking event.
- Keep temperature and sampling behavior deterministic.
- Include focused examples covering common command variations.

Examples that should converge on equivalent proposals:

```text
Thirteen makes two, assist seven
Seven assist and thirteen scores two
Two for thirteen from seven
Thirteen makes a transition two, assisted by seven
```

Examples that require clarification:

```text
He made it
Seven to thirteen
Alex got it
They scored
```

The model may identify ambiguity, but the browser decides whether confirmation is allowed.

## Player resolution

Roster grounding is mandatory.

- Prefer exact jersey matches when a number is spoken as a player reference.
- Prefer exact normalized name matches when a name is spoken.
- Reject player IDs absent from the supplied roster.
- Warn when jersey numbers are duplicated or a name match is ambiguous.
- Highlight players absent from the current lineup without automatically rejecting the proposal.
- Distinguish a jersey number from shot value, score value, and event count through command context.
- Preserve the recognized phrase for diagnostics and correction.

The browser repeats player validation because the roster may change while processing is in progress.

## Timestamp and event ordering

- Capture `videoSeconds` before microphone recording begins.
- All events proposed by one command initially receive that captured timestamp.
- Events with identical timestamps retain the spoken proposal order through normal event sequencing.
- Processing latency never changes the captured timestamp.
- The confirmation UI allows replacing the timestamp with the current video position before saving.
- A later release may support explicit relative timing, but the first release does not infer separate timestamps within one utterance.

## Browser experience

### Connection state

The tracker presents a compact voice status:

- Not installed
- Connecting
- Loading models
- Ready
- Recording
- Processing
- Incompatible version
- Error

Connection failures must not produce repeated intrusive notifications or interfere with manual tracking.

### Recording

- Use an explicit microphone button near event entry.
- Capture the timestamp on pointer or keyboard activation.
- Show an unmistakable recording state and elapsed duration.
- Stop on explicit release/stop and enforce a maximum duration.
- Allow cancellation without sending audio.
- Do not continuously listen in the background.
- Prevent overlapping requests.

Push-to-talk and tap-to-start/tap-to-stop should be evaluated with real game workflows before choosing the final default.

### Confirmation

The proposal surface displays:

- Captured timestamp
- Transcript
- Proposed events in sequence
- Per-event player, side, type, and details
- Warnings and ambiguous fields
- Processing failure information

Actions:

- Add all events
- Edit proposal
- Retry recording
- Cancel
- Replace timestamp with current video position

The initial release never auto-confirms, even at high confidence.

## Persistence and undo

Confirmed proposals are converted into normal validated events by the browser.

- Generate normal event IDs and stable sequence values.
- Apply the captured timestamp to every event in the batch.
- Capture the current lineup snapshot through the existing tracker path.
- Validate every event before saving any event.
- Save the resulting game once.
- If any event is invalid or persistence fails, save none of the batch.
- Surface the actual failure rather than partially succeeding.
- Track the event IDs created by the most recent voice mutation in controller state.
- Provide an immediate **Undo voice command** action that removes the complete batch in one save.
- Do not require a game-schema change solely for temporary undo state.

Whether voice provenance should be persisted is deferred. A future schema may add capture source or batch metadata only if reports, auditing, or cross-reload correction requires it.

## Local models and hardware profiles

### Balanced profile

Initial target:

- Capable laptop or gaming PC.
- Quantized local transcription model selected during the feasibility checkpoint.
- Quantized Qwen3 4B Instruct command model.
- Models remain loaded while the service is ready when memory permits.

### High-accuracy profile

Candidate:

- Gaming PC with sufficient dedicated VRAM.
- Larger transcription model.
- Qwen3 8B or another benchmark winner.

This profile is optional and must not define the protocol.

### Lightweight profile

Candidate:

- CPU-only or lower-power laptop operation.
- Smaller transcription model.
- Smaller generative command model or deterministic-only mode.

Laya-based typed decisions and deterministic clause parsing remain stretch-goal candidates for this profile.

### Resource coordination

The service must support configurable placement:

- Both models on GPU.
- Transcription on GPU and command parsing on CPU.
- Sequential GPU loading when memory is constrained.
- CPU-only fallback.

Automatic recommendations may use detected hardware, but the user retains control because performance and power preferences vary.

## Privacy and local data handling

- Bind to `127.0.0.1` by default.
- Do not expose the service on the LAN by default.
- Do not upload audio, transcripts, roster data, or diagnostics.
- Do not retain audio after the request completes.
- Do not persist transcripts by default.
- Allow an explicit diagnostic mode that stores redacted request metadata without audio.
- Clearly identify the active processing profile and whether every component is local.
- Store models under a user-local application directory.
- Verify downloaded model files with pinned checksums.
- Document model licenses and versions.

## Browser and localhost security

The companion must treat arbitrary web pages as untrusted clients.

- Restrict CORS to configured development origins and the production GitHub Pages origin.
- Validate the `Origin` header.
- Support required preflight and private-network access behavior for target browsers.
- Require a random per-installation or per-session token.
- Reject missing, expired, or incorrect tokens.
- Use bounded request sizes and processing timeouts.
- Accept only supported audio MIME types.
- Limit concurrent processing.
- Avoid state-changing `GET` endpoints.
- Reject unexpected fields rather than silently accepting them.
- Return explicit non-success HTTP responses for invalid requests.
- Never execute model-produced commands, paths, or code.

The feasibility checkpoint must prove that the production HTTPS Pages origin can call the loopback service reliably in supported Chrome and Edge versions.

## Error handling

Required explicit states:

- Microphone permission denied
- No microphone available
- Unsupported recording format
- Companion unavailable
- Companion starting or loading models
- Protocol version mismatch
- Unauthorized or unpaired client
- Audio too long or too large
- No speech detected
- Transcription failed
- Command not understood
- Ambiguous player
- Unsupported event type
- Invalid model response
- Request timeout
- Game changed while processing
- Persistence failed

No error may produce a success-shaped empty event or silently fall back to invented data.

## Testing strategy

### Browser tests

- Fake companion client for deterministic UI tests.
- Recording-state tests without requiring a real microphone.
- Timestamp capture at recording start.
- Connection and version states.
- Confirmation, editing, cancel, and retry.
- Atomic batch save and failure rollback.
- Immediate batch undo.
- Manual event controls remain available while disconnected.
- Review and shared modes do not initialize voice capture.

### Workbench tests

- Health, capability, model-loading, and profile states.
- Microphone recording and audio upload.
- Direct transcript interpretation.
- Mock roster and lineup context.
- Transcript, proposal, warning, confidence, timing, and raw-response presentation.
- Fixture replay and evaluation summaries.
- No access to stats IndexedDB or game persistence.
- Diagnostics redact roster and transcript data unless explicitly exported.

### Service tests

- Health and capability contract.
- CORS, origin, authorization, and request limits.
- Supported and rejected audio formats.
- Transcription adapter contract.
- Command-model adapter contract.
- JSON-schema constrained decoding.
- Invalid model output rejection.
- Timeout and cancellation.
- No retained audio after completion.

### Shared contract tests

- Validate request and response fixtures against committed schemas.
- Run equivalent schema fixtures in browser and service test suites.
- Reject unknown protocol versions.
- Preserve backward compatibility within protocol version 1.

### Model evaluation

Model evaluation is separate from deterministic CI.

Maintain a local, explicitly curated corpus containing:

- Clean synthetic commands.
- Real commands from target microphones.
- Gaming-PC and laptop recordings.
- Quiet-room and realistic background-noise samples.
- Jersey-number and player-name variations.
- Single-event and multi-event commands.
- Unsupported and ambiguous speech.
- Corrections based on actual user confirmation.

Measure:

- Transcription word and entity accuracy.
- Exact event-array match.
- Player-resolution accuracy.
- Attribute accuracy.
- Invalid or hallucinated event rate.
- Schema conformance.
- Median and tail latency.
- Peak RAM and VRAM.
- Thermal behavior over repeated commands.

Audio fixtures must be consented, documented, and excluded from the public repository unless they are explicitly approved for publication.

## Provisional performance gates

These are initial targets to validate, not permanent guarantees:

- Health response appears within one second when models are already ready.
- A gaming-PC balanced profile returns a proposal within approximately two seconds for a short command under normal conditions.
- A capable-laptop balanced profile returns a proposal within several seconds without blocking the tracker UI.
- Every accepted service response conforms to the shared schema.
- Common supported commands achieve at least 95% exact event-array accuracy on the release evaluation corpus.
- The system never persists a model proposal that failed browser validation.

Real hardware results may adjust latency targets, but correctness gates should not be weakened to hide model limitations.

## Checkpoints

### Checkpoint 0: Contract and feasibility spike

**Status: implementation scaffold complete; real-model, real-microphone, target-hardware, and deployed GitHub Pages measurements remain open.** The versioned contracts, native-Windows loopback service, security checks, pluggable transcription adapter, localhost workbench, and automated smoke coverage are implemented. See [`VOICE_COMPANION_CHECKPOINT_0.md`](VOICE_COMPANION_CHECKPOINT_0.md) for the remaining exit-gate procedure.

Deliver:

- Confirmed target Windows gaming PC and laptop specifications.
- Browser-to-loopback proof from local development and deployed GitHub Pages.
- Microphone capture proof in Chrome and Edge.
- Local transcription spike using representative short commands.
- Initial request and response JSON schemas.
- Threat model for arbitrary web pages calling the local service.
- Measured latency, RAM, VRAM, and transcription accuracy.

Verification:

- The deployed HTTPS application can call the loopback service reliably.
- A recorded clip reaches the service without leaving the PC.
- The captured timestamp remains the recording-start timestamp.
- The service rejects unapproved origins and missing authorization.
- Realistic audio quality is sufficient to justify further development.

Exit gate:

- Continue only if localhost connectivity and transcription quality are acceptable on both target machines.

### Checkpoint 1: Companion service foundation

**Status: complete.** The companion now has centralized typed settings, versioned health and capability metadata, strict request-context validation, loopback/token/origin security, bounded processing concurrency, adapter interfaces, and a status-aware localhost workbench. Native and browser coverage is documented in [`VOICE_COMPANION_CHECKPOINT_1.md`](VOICE_COMPANION_CHECKPOINT_1.md).

Deliver:

- `voice-companion/` package and development instructions.
- Localhost workbench shell served by the companion.
- Versioned health and capability endpoints.
- Loopback-only binding.
- Origin allowlist, authorization token, limits, and explicit errors.
- Model-adapter interfaces without coupling HTTP handlers to one runtime.
- Contract fixtures shared with browser tests.
- Workbench service-status, capability, and mock-context panels.

Verification:

- Service starts and stops cleanly.
- The workbench detects ready, loading, incompatible, and error states.
- Security and request-limit tests pass.
- The existing GitHub Pages application remains unchanged when the service is absent.
- The workbench cannot access stats IndexedDB or persist game events.

### Checkpoint 2: Local transcription

**Status: in progress.** The Python 3.12 faster-whisper adapter, basketball decoding vocabulary, model profiles, native installer, model-download helper, evaluation command, and unit coverage are implemented. The balanced `base.en` model now passes native Windows model-load, evaluation, localhost API, and microphone/workbench checks. A representative command corpus and broader hardware measurements remain open; see [`VOICE_COMPANION_CHECKPOINT_2.md`](VOICE_COMPANION_CHECKPOINT_2.md).

Deliver:

- Local speech-to-text adapter.
- Supported audio format normalization.
- Configurable model location and download verification.
- Balanced and lightweight transcription profiles.
- No-speech, timeout, cancellation, and cleanup behavior.
- Opt-in local evaluation command.
- Workbench microphone recording, audio upload, transcript display, timing, and retry.

Verification:

- Audio is deleted after each request.
- Transcript output is stable for representative commands.
- Gaming-PC and laptop measurements are recorded.
- Processing does not freeze the workbench or service health endpoint.
- Model-loading failures are actionable.
- Transcription can be developed and evaluated without running the stats application.

### Checkpoint 3: Structured command interpretation

**Status: complete.** The Qwen3 4B Q4_K_M llama.cpp adapter, strict output validation, roster grounding, transcript-only endpoint, proposal workbench, partial-result diagnostics, native Windows model installation, shared corpus scoring, and automated Windows browser coverage are implemented. Qwen3 passed all eight corpus cases; Phi-4-mini passed four and was not faster, so Qwen3 remains the initial command model. See [`VOICE_COMPANION_CHECKPOINT_3.md`](VOICE_COMPANION_CHECKPOINT_3.md) and [`VOICE_COMPANION_CHECKPOINT_4.md`](VOICE_COMPANION_CHECKPOINT_4.md).

Deliver:

- Qwen3 4B command-model adapter.
- Strict schema-constrained generation.
- Deterministic prompt, sampling, and roster grounding.
- Multi-event proposal support.
- Confidence and warning policy.
- Phi-4-mini comparison on the same transcript corpus.
- Workbench transcript-only requests, mock roster editing, proposal display, raw response, and fixture replay.

Verification:

- The model cannot emit unsupported event types or enum values.
- Unknown players are warnings or failures, never invented IDs.
- Multi-event ordering is deterministic.
- Ambiguous commands return warnings or no proposal.
- Exact event-array accuracy meets the checkpoint threshold on the curated transcript corpus.
- The full transcript-to-proposal workflow can be exercised and diagnosed entirely in the workbench.

Exit gate:

- Choose the initial command model from measured accuracy, latency, resource use, licensing, and deployment complexity.

### Checkpoint 4: Standalone companion readiness

**Status: complete.** Explicit dual-model warmup, bounded hardware detection, profile recommendation, CPU/GPU placement reporting, workbench readiness feedback, corpus evaluation, redacted diagnostics, model comparison, cancellation, timeout, out-of-memory handling, recovery tests, and long-session validation are implemented. The gaming-PC CPU profile completed 56/56 exact commands with zero errors, 3.7-second median latency, and stable memory. CPU execution is the accepted initial baseline; CUDA acceleration is deferred as an optional optimization. See [`VOICE_COMPANION_CHECKPOINT_4.md`](VOICE_COMPANION_CHECKPOINT_4.md).

Deliver:

- Complete workbench recording-to-proposal workflow.
- Balanced, lightweight, and optional high-accuracy profiles.
- Hardware detection and user override.
- CPU/GPU placement configuration.
- Model warmup and readiness reporting.
- Local corpus runner with exact-match, warning, error, and latency summaries.
- Recovery from model crashes, cancellation, timeout, and out-of-memory failures.
- Long-session resource and thermal measurements.
- Redacted diagnostic export.

Verification:

- Supported commands can be recorded, transcribed, interpreted, inspected, and replayed without the stats application.
- The gaming PC and capable laptop satisfy the agreed standalone accuracy and usability targets.
- Profile changes do not change the HTTP response contract.
- Repeated commands do not leak audio files, memory, or worker processes.
- Every planned service error is reproducible and visible in the workbench.
- Model comparison results are recorded against the same evaluation corpus.

Exit gate:

- Do not begin stats integration until the companion is independently useful, diagnosable, and meets agreed transcription, interpretation, latency, privacy, and stability gates.

### Checkpoint 5: Stats recording and proposal preview

**Status: complete.** The tracker now has an optional loopback-only companion
client, connection and warmup status, microphone recording with recording-start
timestamps, cancellation and retry, strict browser-side proposal validation,
partial transcript recovery, and an editable non-persistent proposal preview.
Tracker tests cover companion and microphone failures, overlapping-recording
prevention, cancellation, invalid proposals, zero game writes, and removal of
the voice surface from Review mode. Explicit opt-in evaluation collection now
stores audio, original and corrected results, and diagnostics in the local
companion folder with tracker review, ZIP export, and deletion controls. The
tracker also supports explicit microphone selection, speech-oriented capture
constraints, higher-bitrate recording, and immediate playback so poor input can
be rejected before it enters the evaluation corpus. An optional persisted
recording mode
pauses active video playback to prevent game-audio contamination and resumes it
after capture only when it was previously playing; the default keeps playback
running for faster stat entry. Raw microphone capture is the default for audio
interfaces and headphones so browser echo cancellation does not muffle speech
against active video playback; processed speech remains available for laptop
microphones and speakers. The companion also detects audio-interface recordings
where the microphone occupies only one stereo channel, selects the active
channel before transcription, and reports the channel mode in diagnostics.
Microphone, processing, and playback-isolation controls live in an Audio
settings dialog with a live left/right channel preview. Channel handling
defaults to automatic detection and supports explicit left-only, right-only,
and mixed overrides for unusual audio-interface routing.

Deliver:

- Optional companion client.
- Connection and capability status.
- Microphone controls and recording state.
- Recording-start timestamp capture.
- Processing state and cancellation.
- Transcript and editable proposal preview.
- Retry, cancel, and replace-timestamp actions.

Verification:

- No game writes occur before confirmation.
- Losing the companion or microphone does not break manual tracking.
- Keyboard and pointer workflows are accessible.
- Recording cannot overlap or continue unnoticed.
- Tracker, Review, and shared modes initialize the correct surfaces.

### Checkpoint 6: Atomic timeline integration

**Status: complete.** Edited proposals can now be confirmed through the normal
tracker mutation boundary. The browser revalidates the active game, timestamp,
roster references, and lineup, converts every proposal item into a normal event with consecutive
sequence values, rebuilds lineup snapshots, and performs one IndexedDB save
before updating controller state. Validation and storage failures leave both
memory and storage unchanged. Newly added events are highlighted in the
timeline, and both the compact voice status and normal latest-event control undo
the complete batch while it remains the latest mutation. Switching games clears
pending commands, while unrelated writes in the same game remain valid.

Deliver:

- Conversion from proposals to normal game events.
- Browser-side roster and event validation.
- Stable ordering for shared timestamps.
- One-save atomic batch commit.
- Immediate full-batch undo.
- Timeline highlighting of newly added events.
- Explicit handling when the game changes during processing.

Verification:

- A valid multi-event command updates statistics exactly like equivalent manual events.
- No partial batch remains after validation or storage failure.
- Undo removes every event from the voice mutation and restores reports.
- Related events remain separate facts.
- The service still has no persistence access.

#### Compact queued tracker workflow

**Status: complete.** The initial integration proved the complete workflow but
dedicated too much permanent tracker space to connection, recording, proposal,
and evaluation controls. The production tracker workflow now uses one
microphone button in the event-entry header with a small adjacent settings
button.

The microphone is a start/stop toggle. After recording stops, the browser adds a
UI-only command row to the event timeline at the captured video timestamp. A
row moves through queued, processing, draft, error, and committing states.
Queued and processing rows show progress and cancellation. Draft rows expose
the transcript, editable proposed events, and explicit Add events, Retry, and
Discard actions. Confirmed rows become normal persisted game events with
temporary highlighting and full-batch undo. Temporary rows never enter game
data, IndexedDB, reports, backups, or shared links.

Recording remains available while earlier commands are pending. The browser
queues audio immediately and sends commands to the companion sequentially to
avoid competing local-model inference. Completed drafts may be confirmed,
edited, retried, or discarded independently.

Connection, token, warmup, microphone, processing, channel, playback-isolation,
diagnostic, and saved-evaluation controls move into the voice settings dialog.
Remembered settings auto-connect when possible. An unavailable microphone
control opens actionable settings instead of becoming an unexplained disabled
control.

Confirmation uses contextual revalidation instead of rejecting a command after
every unrelated game write. The active game must still match, referenced
players must still exist, the timestamp must remain valid, and team players
must belong to the derived lineup at that timestamp. Later unrelated manual or
voice events do not invalidate a queued command.

### Checkpoint 7: Integrated resilience and regression

Deliver:

- Recovery when the companion disconnects, restarts, changes profile, or becomes incompatible while the tracker is open.
- Safe handling when the game, lineup, roster, or video position changes during processing.
- Browser lifecycle handling for reload, navigation, backgrounding, and microphone permission changes.
- Complete tracker regression coverage with the companion absent, mocked, ready, processing, and failing.
- End-to-end comparison between workbench results and tracker proposals for identical requests.

Verification:

- Manual tracking remains responsive during loading and processing.
- Companion failures cannot partially modify the game.
- Workbench and tracker clients interpret the same service response consistently.
- Review, shared Review, backups, reports, and existing event entry remain unchanged.
- Long game sessions do not leak browser listeners, recordings, requests, or proposal state.

### Checkpoint 8: Windows packaging and release hardening

Deliver:

- Native Windows packaging or another agreed dependable launcher.
- Start, stop, restart, and model-management workflow.
- Local log and diagnostic collection without audio retention.
- Version compatibility messaging.
- GitHub Release artifacts and checksums.
- User installation, troubleshooting, privacy, and uninstall documentation.
- End-to-end release fixture and manual game workflow.

Verification:

- A clean Windows machine can install, pair, run, update, and uninstall the companion.
- GitHub Pages detects compatible and incompatible versions correctly.
- The packaged workbench remains available for diagnostics and model evaluation.
- No administrator privileges are required unless technically unavoidable and documented.
- Full browser regression tests pass with the companion integration disabled and mocked.
- A complete recorded-game workflow succeeds on both target machines.

## Stretch goals

### Deterministic fast path

Parse common grammar without a generative model:

```text
13 made two
7 assist
8 offensive rebound
opponent missed three
```

Use the LLM only for commands outside the deterministic grammar.

### Laya typed decisions

Evaluate Laya after collecting a representative transcript corpus.

Potential role:

- Classify event type, side, result, value, rebound kind, and shot tags.
- Provide calibrated confidence for each slot.
- Support a lower-power laptop profile.
- Reduce generative hallucination risk.

Laya does not remove the need for clause segmentation and entity extraction when a command contains a variable number of events. It should be adopted only if measured reliability or resource use improves over the selected baseline.

### High-confidence auto-confirm

Allow an explicitly enabled mode to save proposals automatically only when:

- Every field exceeds configured confidence.
- Every player resolves uniquely.
- Browser validation succeeds.
- The command contains only supported low-risk event types.
- A prominent batch undo remains available.

This is not part of the initial release.

### Additional command domains

Consider substitutions, period changes, timeouts, notes, or voice corrections only after the statistical-event workflow demonstrates sufficient accuracy and trust.

## Open decisions

- Final transcription runtime and model.
- Python service versus another production runtime.
- WSL prototype versus native Windows development from the first checkpoint.
- Push-to-talk versus tap-to-start/tap-to-stop default.
- Pairing-token exchange UX.
- Whether the video should continue playing during recording.
- Whether low-confidence fields are editable inline or require retry.
- Whether voice provenance should eventually be persisted in the game schema.
- Exact laptop and gaming-PC performance targets.
- Supported spoken languages for the first release.

These decisions should be resolved at the checkpoint where evidence becomes available rather than guessed in advance.

## Completion criteria

The initial local voice companion is complete when:

1. It runs entirely on the target Windows PC without cloud processing.
2. Its standalone workbench can record, transcribe, interpret, diagnose, and evaluate commands without the stats application.
3. The standalone readiness gate passes before stats integration begins.
4. The production GitHub Pages application connects securely over loopback.
5. The coach can record, review, and confirm supported commands.
6. Multi-event commands produce normal validated events at the captured start timestamp.
7. Invalid, ambiguous, or unsupported speech cannot silently modify the game.
8. Confirmed batches save atomically and can be undone as a batch.
9. Manual tracking remains fully functional without the companion.
10. Gaming-PC and laptop profiles meet agreed correctness and usability gates.
11. The companion can be installed and operated without development tooling.
12. Automated contract, workbench, browser, service, and regression tests pass.
