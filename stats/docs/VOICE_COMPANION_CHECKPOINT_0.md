# Voice Companion Checkpoint 0

## Status

Implementation scaffold complete; real-hardware transcription and deployed-origin measurements remain required before the checkpoint exit gate can pass.

The spike provides:

- Versioned request and response schemas.
- A native-Windows, loopback-only Python service.
- Token and origin validation.
- Private-network preflight handling.
- Bounded multipart audio requests.
- Explicit unconfigured and failed transcription responses.
- A pluggable local transcription-command adapter.
- A localhost microphone and audio-upload workbench.
- Recording-start timestamp capture.
- Automated service security and response tests.

It deliberately does not provide command interpretation, stats integration, model downloads, or fabricated performance results.

## Assumed hardware baselines

Measurements should be recorded for machines at least comparable to:

### Generic mid-tier gaming PC

- Windows 11
- 6-to-10-core modern desktop CPU
- NVIDIA RTX-class GPU with 8 GB dedicated VRAM
- 16-to-32 GB system RAM
- SSD storage

### High-tier productivity laptop

- Windows 11
- Modern 8-to-14-core mobile CPU
- 32 GB system RAM
- Fast SSD storage
- Integrated graphics or a modest professional/mobile GPU

These are planning baselines only. Actual processor, GPU, memory, power profile, and browser versions must be captured with every benchmark result.

## Threat model

The loopback service is reachable by software and web pages running on the same PC. Loopback binding alone is not authorization.

Checkpoint 0 mitigations:

- Bind only to `127.0.0.1`, `::1`, or `localhost`.
- Reject unapproved `Origin` values.
- Require `X-Bask-Voice-Token` for API requests.
- Compare tokens without ordinary string equality.
- Limit request and context sizes.
- Accept only enumerated audio MIME types.
- Require a supported protocol version.
- Return explicit non-success responses.
- Never execute model output.
- Delete temporary audio in a `finally` path.
- Do not retain transcripts or audio.

Remaining decisions:

- Production pairing-token exchange and rotation.
- Locally trusted HTTPS versus browser private-network permissions.
- Installer file permissions and local log redaction.
- Whether production health information should require authorization.

## Deployed-origin connectivity procedure

After publishing a branch:

1. Start the native Windows companion on loopback.
2. Open the deployed GitHub Pages branch in current Chrome.
3. Send authorized `GET /v1/health` and `GET /v1/capabilities` requests.
4. Confirm the browser performs and accepts the private-network preflight.
5. Repeat in current Edge.
6. Confirm an unapproved origin is rejected.
7. Record browser versions, response status, console errors, and whether a browser permission was required.

The checkpoint does not pass if the deployed HTTPS origin cannot reliably call the HTTP loopback endpoint. If browser policy blocks it, evaluate locally trusted HTTPS or a browser/native integration before proceeding.

## Transcription measurement procedure

Use short English commands covering:

- Jersey numbers with one and two digits.
- Player names.
- Made and missed shots.
- Assists, rebounds, turnovers, steals, blocks, and fouls.
- Single-event and multi-event phrases.
- Quiet-room and realistic background-noise recordings.

For every run capture:

- Machine and power profile.
- Transcription model and quantization.
- Runtime and compute device.
- Audio duration and format.
- Cold-start and warm latency.
- Peak RAM and VRAM.
- Exact transcript.
- Player-number and basketball-term errors.

Do not add private audio to the public repository. Store approved evaluation metadata without audio or personally identifying content.

## Exit gate

Checkpoint 0 passes only after:

- Native Windows workbench recording succeeds in Chrome and Edge.
- Production GitHub Pages-to-loopback connectivity succeeds securely.
- At least one fully local transcription runtime is measured on both hardware classes.
- Representative commands have acceptable player-number and basketball-term accuracy.
- Warm latency and resource use are acceptable for game use.
- Temporary audio cleanup is verified.
- Open security decisions have an agreed path.

Until those measurements exist, the implementation is ready for feasibility testing but Checkpoint 0 remains open.
