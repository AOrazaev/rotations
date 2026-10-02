# Voice Companion Checkpoint 1

## Status

Implementation complete. The companion now has a stable local service foundation for transcription work in Checkpoint 2.

## Delivered

- Installable Python package structure under `voice-companion/`.
- Versioned `GET /v1/health`, `GET /v1/capabilities`, and `POST /v1/voice-command` endpoints.
- Typed service settings and centralized limits.
- Loopback-only startup enforcement.
- Token authorization and origin validation.
- Explicit private-network preflight handling.
- Strict request-context validation:
  - Unknown top-level fields are rejected.
  - Unknown or missing roster fields are rejected.
  - Player IDs must be unique.
  - Current-lineup IDs must exist in the supplied roster.
  - Event types must be supported and unique.
  - Timestamps must be finite and non-negative.
  - Strings must be trimmed, bounded, and free of control characters.
- Enumerated audio MIME types and bounded context/audio requests.
- Pluggable transcription adapter interface.
- One active processing request by default with an explicit `429 service_busy` response.
- Processing-count and uptime health metadata.
- Capability metadata for limits, models, protocol, and security behavior.
- Workbench service, protocol, transcription, and interpretation status panels.
- Native service, contract, validation, concurrency, and browser workbench tests.

## API readiness behavior

The health endpoint reports:

- `ready` when a transcription adapter is configured.
- `configuration_required` when no transcription adapter is configured.
- Current protocol and service versions.
- Active profile.
- Whether transcription and command interpretation are ready.
- Current processing request count.
- Service uptime.

The capability endpoint reports:

- Supported audio types.
- Supported languages.
- Audio, context, duration, and concurrency limits.
- Active model identities.
- Whether event interpretation exists.
- Loopback, token, and origin security behavior.

## Validation boundary

The service validates transport and bounded request context. It does not yet interpret basketball commands or validate proposed events.

The browser will remain authoritative for:

- Current game and roster state.
- Event semantics.
- Event IDs and sequence values.
- Lineup snapshots.
- Persistence and undo.

## Processing boundary

Checkpoint 1 defaults to one active voice request. A second request receives:

```json
{
  "error": {
    "code": "service_busy",
    "message": "The voice companion is already processing a request."
  }
}
```

The slot is released after success, missing configuration, timeout, or transcription failure.

## Verification

Automated coverage includes:

- Contract fixtures.
- Authorization.
- Origin rejection.
- Private-network preflight.
- Health metadata.
- Multipart transcription response.
- Processing-slot bounds.
- Strict request validation.
- Workbench readiness and audio-file flow.

The normal stats and planner suites remain independent of the companion.

## Next checkpoint

Checkpoint 2 adds a real local speech-to-text adapter, audio normalization, model setup, cancellation and timeout behavior, evaluation tooling, and gaming-PC/laptop measurements.
